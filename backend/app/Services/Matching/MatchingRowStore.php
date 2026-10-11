<?php

namespace App\Services\Matching;

use ArrayAccess;
use Countable;
use IteratorAggregate;
use PDO;
use PDOStatement;
use Traversable;

/** Job-local spill storage: PHP memory contains one row/batch, not both datasets. */
class MatchingRowStore implements ArrayAccess, Countable, IteratorAggregate
{
    private ?PDO $pdo = null;
    private string $path;
    private int $ownerPid;
    private int $count = 0;
    private int $pendingWrites = 0;
    private bool $deleteOnDestruct;
    private ?PDOStatement $appendStatement = null;
    private ?PDOStatement $setKeysStatement = null;

    public function __construct(?string $path = null, bool $deleteOnDestruct = true)
    {
        $this->deleteOnDestruct = $deleteOnDestruct;
        if ($path === null) {
            // Keep job-local spill files on the container's local temp filesystem.
            $dir = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.'rematch-matching-temp';
            if (!is_dir($dir)) mkdir($dir, 0755, true);
            $path = tempnam($dir, 'rows_');
        } else {
            $dir = dirname($path);
            if (!is_dir($dir)) mkdir($dir, 0755, true);
        }
        $this->path = $path;
        $this->ownerPid = getmypid();
        $pdo = $this->connection();
        $pdo->exec('CREATE TABLE IF NOT EXISTS rows (id INTEGER PRIMARY KEY, payload TEXT NOT NULL, signature TEXT UNIQUE, occurrences INTEGER NOT NULL DEFAULT 1, first_row INTEGER, mandatory_key TEXT, composite_key TEXT)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS rematch_cache_meta (cache_key TEXT PRIMARY KEY, cache_value TEXT NOT NULL)');
        $this->count = (int) $pdo->query('SELECT COUNT(*) FROM rows')->fetchColumn();
    }

    private function connection(): PDO
    {
        if ($this->pdo === null) {
            $this->pdo = new PDO('sqlite:'.$this->path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $this->pdo->exec('PRAGMA cache_size=-8192; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=FILE');
        }
        return $this->pdo;
    }

    public function append(array $row, ?string $signature = null, ?int $firstRow = null): bool
    {
        $this->beginBatchIfNeeded();
        $this->appendStatement ??= $this->connection()->prepare('INSERT INTO rows (id,payload,signature,first_row) VALUES (?,?,?,?) ON CONFLICT(signature) DO UPDATE SET occurrences=occurrences+1');
        $this->appendStatement->execute([$this->count + 1, json_encode($row, JSON_THROW_ON_ERROR), $signature, $firstRow]);
        $this->recordWrite();
        // SQLite last_insert_rowid stays unchanged on an update, so use the
        // signature's original row to distinguish a duplicate deterministically.
        if ($signature !== null) {
            $check = $this->connection()->prepare('SELECT first_row FROM rows WHERE signature=?');
            $check->execute([$signature]);
            if ((int) $check->fetchColumn() !== $firstRow) return false;
        }
        $this->count++;
        return true;
    }

    public function duplicateDetails(): array
    {
        $this->flush();
        $rows = $this->connection()->query('SELECT payload,first_row,occurrences FROM rows WHERE occurrences>1 ORDER BY occurrences DESC,id LIMIT 100')->fetchAll(PDO::FETCH_ASSOC);
        return array_map(static fn ($r) => [
            'sample_row' => json_decode($r['payload'], true, 512, JSON_THROW_ON_ERROR),
            'first_row_index' => (int) $r['first_row'],
            'duplicate_count' => (int) $r['occurrences'] - 1,
            'total_occurrences' => (int) $r['occurrences'],
        ], $rows);
    }

    public function setExactKeys(int $id, ?string $mandatory, ?string $composite): void
    {
        $this->beginBatchIfNeeded();
        $this->setKeysStatement ??= $this->connection()->prepare('UPDATE rows SET mandatory_key=?, composite_key=? WHERE id=?');
        $this->setKeysStatement->execute([$mandatory, $composite, $id]);
        $this->recordWrite();
    }

    public function buildLookupIndexes(): void
    {
        $this->flush();
        $this->connection()->exec('CREATE INDEX IF NOT EXISTS mandatory_lookup ON rows(mandatory_key)');
        $this->connection()->exec('CREATE INDEX IF NOT EXISTS composite_lookup ON rows(composite_key)');
    }

    public function markCacheReady(string $signature): void
    {
        $this->flush();
        $stmt = $this->connection()->prepare('INSERT OR REPLACE INTO rematch_cache_meta(cache_key, cache_value) VALUES (?, ?)');
        $stmt->execute(['signature', $signature]);
        $this->connection()->exec('PRAGMA journal_mode=DELETE');
        $this->disconnect();
    }

    public static function isValidCache(string $path, string $signature): bool
    {
        if (!is_file($path) || filesize($path) < 512) return false;
        try {
            $pdo = new PDO('sqlite:'.$path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $stmt = $pdo->prepare('SELECT cache_value FROM rematch_cache_meta WHERE cache_key = ?');
            $stmt->execute(['signature']);
            if ($stmt->fetchColumn() !== $signature) return false;
            $count = (int) $pdo->query('SELECT COUNT(*) FROM rows')->fetchColumn();
            $indexes = $pdo->query("SELECT name FROM sqlite_master WHERE type='index'")->fetchAll(PDO::FETCH_COLUMN);
            return $count > 0 && in_array('mandatory_lookup', $indexes, true) && in_array('composite_lookup', $indexes, true);
        } catch (\Throwable) {
            return false;
        }
    }

    public function promoteCache(string $destination): void
    {
        $this->flush();
        $this->disconnect();
        if (is_file($destination) && !unlink($destination)) {
            throw new \RuntimeException('Could not replace an outdated reference cache.');
        }
        if (!rename($this->path, $destination)) {
            throw new \RuntimeException('Could not publish the completed reference cache.');
        }
        $this->path = $destination;
        $this->deleteOnDestruct = false;
    }

    public function path(): string { return $this->path; }

    public function exactMatches(string $kind, string $key): Traversable
    {
        $this->flush();
        $column = $kind === 'mandatory' ? 'mandatory_key' : 'composite_key';
        $stmt = $this->connection()->prepare("SELECT payload FROM rows WHERE {$column}=? ORDER BY id");
        $stmt->execute([$key]);
        while (($payload = $stmt->fetchColumn()) !== false) yield json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
    }

    /** @param list<string|int> $ids @return array<string, array<string, mixed>> */
    public function getMany(array $ids): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids), static fn ($id) => $id > 0)));
        if ($ids === []) return [];
        $this->flush();
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $this->connection()->prepare("SELECT id, payload FROM rows WHERE id IN ({$placeholders})");
        $stmt->execute($ids);
        $records = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $records[(string) $row['id']] = json_decode($row['payload'], true, 512, JSON_THROW_ON_ERROR);
        }
        return $records;
    }

    public function chunk(int $index, int $size): array
    {
        $this->flush();
        $stmt = $this->connection()->prepare('SELECT payload FROM rows WHERE id>? AND id<=? ORDER BY id');
        $stmt->execute([$index * $size, ($index + 1) * $size]);
        return array_map(static fn ($r) => json_decode($r, true, 512, JSON_THROW_ON_ERROR), $stmt->fetchAll(PDO::FETCH_COLUMN));
    }

    /** Map payloads in bounded batches without creating a second full row store. */
    public function mapPayloads(callable $mapper, int $batchSize = 500): void
    {
        $this->flush();
        $lastId = 0;
        $select = $this->connection()->prepare('SELECT id, payload FROM rows WHERE id > ? ORDER BY id LIMIT ?');
        $update = $this->connection()->prepare('UPDATE rows SET payload = ? WHERE id = ?');
        do {
            $select->execute([$lastId, max(1, $batchSize)]);
            $rows = $select->fetchAll(PDO::FETCH_ASSOC);
            if ($rows === []) break;
            $this->connection()->beginTransaction();
            try {
                foreach ($rows as $row) {
                    $lastId = (int) $row['id'];
                    $payload = json_decode($row['payload'], true, 512, JSON_THROW_ON_ERROR);
                    $mapped = $mapper($payload, $lastId);
                    $update->execute([json_encode($mapped, JSON_THROW_ON_ERROR), $lastId]);
                }
                $this->connection()->commit();
            } catch (\Throwable $e) {
                if ($this->connection()->inTransaction()) $this->connection()->rollBack();
                throw $e;
            }
        } while (count($rows) === max(1, $batchSize));
    }

    public function getIterator(): Traversable
    {
        $this->flush();
        $stmt = $this->connection()->query('SELECT payload FROM rows ORDER BY id');
        while (($payload = $stmt->fetchColumn()) !== false) yield json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
    }

    public function count(): int { return $this->count; }
    public function offsetExists(mixed $offset): bool { return ctype_digit((string) $offset) && (int) $offset > 0 && (int) $offset <= $this->count; }
    public function offsetGet(mixed $offset): ?array
    {
        $this->flush();
        $stmt = $this->connection()->prepare('SELECT payload FROM rows WHERE id=?');
        $stmt->execute([(int) $offset]);
        $payload = $stmt->fetchColumn();
        return $payload === false ? null : json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
    }
    public function offsetSet(mixed $offset, mixed $value): void { throw new \LogicException('Use append'); }
    public function offsetUnset(mixed $offset): void { throw new \LogicException('Rows are immutable'); }
    private function beginBatchIfNeeded(): void
    {
        $pdo = $this->connection();
        if (!$pdo->inTransaction()) $pdo->beginTransaction();
    }

    private function recordWrite(): void
    {
        $this->pendingWrites++;
        if ($this->pendingWrites >= 5000) $this->flush();
    }

    private function flush(): void
    {
        if ($this->pdo?->inTransaction()) $this->pdo->commit();
        $this->pendingWrites = 0;
    }

    public function disconnect(): void
    {
        $this->flush();
        $this->appendStatement = null;
        $this->setKeysStatement = null;
        $this->pdo = null;
    }
    public function __destruct()
    {
        $this->disconnect();
        if ($this->deleteOnDestruct && getmypid() === $this->ownerPid && is_file($this->path)) unlink($this->path);
    }
}
