<?php

namespace App\Services\Matching;

class ValueNormalizer
{
    public function normalize(mixed $value, string $preset = 'Basic'): string
    {
        if ($value === null) {
            return '';
        }

        $text = trim((string) $value);

        if ($text === '') {
            return '';
        }

        $text = mb_strtolower($text);
        $text = preg_replace('/\s+/', ' ', $text) ?? $text;

        if (in_array($preset, ['Text Standardization', 'Entity Name', 'Address'], true)) {
            $text = preg_replace('/[^\pL\pN\s]+/u', ' ', $text) ?? $text;
            $text = preg_replace('/\s+/', ' ', $text) ?? $text;
        }

        if ($preset === 'Entity Name') {
            $text = preg_replace('/\b(pt|cv|tbk|ltd|inc|llc|co|corp|persero)\b/u', ' ', $text) ?? $text;
            $text = preg_replace('/\s+/', ' ', $text) ?? $text;
        }

        if ($preset === 'Address') {
            $text = preg_replace('/\bjl\b/u', 'jalan', $text) ?? $text;
            $text = preg_replace('/\bno\b/u', 'nomor', $text) ?? $text;
            $text = preg_replace('/\s+/', ' ', $text) ?? $text;
        }

        if ($preset === 'Identifier Strict') {
            $text = preg_replace('/\s+/', '', $text) ?? $text;
        }

        return trim($text);
    }

    /**
     * @return array<int, string>
     */
    public function tokens(string $value): array
    {
        $tokens = preg_split('/\s+/', $value, -1, PREG_SPLIT_NO_EMPTY) ?: [];

        return array_values(array_unique(array_filter($tokens, fn (string $token) => mb_strlen($token) >= 2)));
    }
}
