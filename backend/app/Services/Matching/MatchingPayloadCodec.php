<?php

namespace App\Services\Matching;

/** Lossless encoding for payloads that are never filtered or aggregated in SQL. */
class MatchingPayloadCodec
{
    public static function encode(array $payload): string
    {
        $json = json_encode($payload, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION);
        if (strlen($json) < 512) return $json;
        $compressed = gzencode($json, 1);
        if ($compressed === false) return $json;
        $encoded = 'gz1:'.base64_encode($compressed);
        return strlen($encoded) < strlen($json) ? $encoded : $json;
    }

    public static function decode(string $payload): array
    {
        if (str_starts_with($payload, 'gz1:')) {
            $bytes = base64_decode(substr($payload, 4), true);
            $json = $bytes === false ? false : @gzdecode($bytes);
            if ($json === false) throw new \RuntimeException('Invalid compressed matching payload.');
            $payload = $json;
        }
        $decoded = json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($decoded)) throw new \RuntimeException('Invalid matching payload structure.');
        return $decoded;
    }
}
