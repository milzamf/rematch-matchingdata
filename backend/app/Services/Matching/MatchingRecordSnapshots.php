<?php

namespace App\Services\Matching;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Immutable content-addressed reference rows. Existing inline evidence remains readable. */
final class MatchingRecordSnapshots
{
    private static array $cache = [];
    private static array $pending = [];
    private static int $pendingBytes = 0;

    public static function available(): bool
    {
        return Schema::hasTable('matching_record_snapshots');
    }

    public static function store(array $row): string
    {
        $json = json_encode($row, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION);
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
        DB::table('matching_record_snapshots')->insertOrIgnore(array_values(self::$pending));
        self::$pending = [];
        self::$pendingBytes = 0;
    }

    public static function load(string $id): array
    {
        if (! preg_match('/^[a-f0-9]{64}$/D', $id)) throw new \RuntimeException('Invalid result snapshot identifier.');
        $key = DB::connection()->getName().':'.$id;
        if (isset(self::$cache[$key])) return self::$cache[$key];
        $payload = DB::table('matching_record_snapshots')->where('id', $id)->value('payload');
        if ($payload === null) throw new \RuntimeException('Immutable reference snapshot is unavailable.');
        $row = MatchingPayloadCodec::decode($payload);
        if (hash('sha256', json_encode($row, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION)) !== $id) throw new \RuntimeException('Result snapshot integrity check failed.');
        self::remember($key, $row);
        return $row;
    }

    private static function remember(string $key, array $row): void
    {
        if (count(self::$cache) >= 128) array_shift(self::$cache);
        self::$cache[$key] = $row;
    }
}
