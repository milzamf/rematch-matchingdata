<?php

namespace App\Services\Matching;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\ConnectionInterface;

/** Immutable content-addressed reference rows. Existing inline evidence remains readable. */
final class MatchingRecordSnapshots
{
    private static array $pending = [];
    private static int $pendingBytes = 0;
    private static ?ConnectionInterface $pendingConnection = null;

    public static function available(): bool
    {
        return Schema::hasTable('matching_record_snapshots');
    }

    public static function store(array $row): string
    {
        $db = DB::connection();
        if (self::$pendingConnection !== null && self::$pendingConnection !== $db && self::$pending) {
            throw new \RuntimeException('Flush snapshot evidence before switching database connections.');
        }
        self::$pendingConnection = $db;
        $json = json_encode($row, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION);
        if (strlen($json) > 2097152) throw new \RuntimeException('Reference row exceeds the snapshot budget.');
        $id = hash('sha256', $json);
        if (! isset(self::$pending[$id])) {
            $payload = MatchingPayloadCodec::encode($row);
            self::$pending[$id] = ['id' => $id, 'payload' => $payload];
            self::$pendingBytes += strlen($payload);
            if (count(self::$pending) >= 250 || self::$pendingBytes >= 2097152) self::flush();
        }
        return $id;
    }

    public static function flush(): void
    {
        if (! self::$pending) return;
        self::$pendingConnection->table('matching_record_snapshots')->insertOrIgnore(array_values(self::$pending));
        self::$pending = [];
        self::$pendingBytes = 0;
        self::$pendingConnection = null;
    }

    public static function load(string $id, ?ConnectionInterface $db = null): array
    {
        return self::loadMany([$id], $db)[$id];
    }

    /** Page-local hydration: no cache can leak rows across connections or rolled-back transactions. */
    public static function loadMany(array $ids, ?ConnectionInterface $db = null): array
    {
        $ids = array_values(array_unique($ids));
        foreach ($ids as $id) {
            if (! is_string($id) || ! preg_match('/^[a-f0-9]{64}$/D', $id)) throw new \RuntimeException('Invalid result snapshot identifier.');
        }
        $rows = [];
        $bytes = 0;
        foreach (array_chunk($ids, 100) as $chunk) {
            foreach (($db ?? DB::connection())->table('matching_record_snapshots')->whereIn('id', $chunk)->get(['id', 'payload']) as $record) {
                $row = MatchingPayloadCodec::decode($record->payload, 2097152);
                $json = json_encode($row, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION);
                $bytes += strlen($json);
                if ($bytes > 16777216) throw new \RuntimeException('Snapshot page exceeds the hydration budget.');
                if (! hash_equals($record->id, hash('sha256', $json))) throw new \RuntimeException('Result snapshot integrity check failed.');
                $rows[$record->id] = $row;
            }
        }
        if (count($rows) !== count($ids)) throw new \RuntimeException('Immutable reference snapshot is unavailable.');
        return $rows;
    }

    /** Validate checkpoint dependencies before publishing any restored results. */
    public static function assertReferences(array $results): void
    {
        $ids = [];
        foreach ($results as $result) {
            $meta = json_decode($result['candidate_metadata'] ?? '{}', true, 512, JSON_THROW_ON_ERROR);
            if (isset($meta['_reference_snapshot'])) $ids[] = $meta['_reference_snapshot'];
            if (isset($meta['_input_primary']) && ((int) $result['candidate_rank'] === 1 || (string) $meta['_input_primary'] !== (string) $result['input_record_key'])) throw new \RuntimeException('Checkpoint input snapshot identity mismatch.');
        }
        $ids = array_values(array_unique($ids));
        foreach (array_chunk($ids, 100) as $chunk) {
            foreach ($chunk as $id) if (! is_string($id) || ! preg_match('/^[a-f0-9]{64}$/D', $id)) throw new \RuntimeException('Invalid checkpoint snapshot identifier.');
            if (DB::table('matching_record_snapshots')->whereIn('id', $chunk)->count() !== count($chunk)) throw new \RuntimeException('Checkpoint reference evidence is unavailable; restore refused.');
        }
    }
}
