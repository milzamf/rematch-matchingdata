<?php

namespace App\Services\Matching;

class SimilarityScorer
{
    public function __construct(private readonly ValueNormalizer $normalizer)
    {
    }

    public function score(string $algorithm, string $left, string $right): float
    {
        if ($left === '' || $right === '') {
            return 0.0;
        }

        return round(match ($this->normalizeAlgorithm($algorithm)) {
            'Exact' => $left === $right ? 100.0 : 0.0,
            'Case-Insensitive Exact' => mb_strtolower($left) === mb_strtolower($right) ? 100.0 : 0.0,
            'Normalized Exact', 'Numeric Exact', 'Date Exact' => $left === $right ? 100.0 : 0.0,
            'Jaro-Winkler' => $this->jaroWinkler($left, $right) * 100,
            'Levenshtein' => $this->levenshteinRatio($left, $right) * 100,
            'Damerau-Levenshtein' => $this->damerauLevenshteinRatio($left, $right) * 100,
            'Jaccard Similarity', 'Jaccard' => $this->jaccard($left, $right) * 100,
            'Cosine Similarity' => $this->cosine($left, $right) * 100,
            'Sørensen-Dice', 'Sorensen-Dice' => $this->sorensenDice($left, $right) * 100,
            'Ratcliff-Obershelp' => $this->ratcliffObershelp($left, $right) * 100,
            'Monge-Elkan' => $this->mongeElkan($left, $right) * 100,
            'Smith-Waterman' => $this->smithWaterman($left, $right) * 100,
            'Token Sort Ratio' => $this->tokenSortRatio($left, $right) * 100,
            'Token Set Ratio' => $this->tokenSetRatio($left, $right) * 100,
            'Partial Ratio' => $this->partialRatio($left, $right) * 100,
            'Partial Token Sort' => $this->partialRatio($this->sortTokens($left), $this->sortTokens($right)) * 100,
            'Partial Token Set' => $this->partialRatio($this->tokenSetText($left), $this->tokenSetText($right)) * 100,
            default => $this->levenshteinRatio($left, $right) * 100,
        }, 2);
    }

    private function normalizeAlgorithm(string $algorithm): string
    {
        $cleaned = trim($algorithm);

        return match ($cleaned) {
            'Token Sort' => 'Token Sort Ratio',
            'Token Set' => 'Token Set Ratio',
            'Partial Token' => 'Partial Token Set',
            default => $cleaned,
        };
    }

    private function levenshteinRatio(string $left, string $right): float
    {
        $max = max(mb_strlen($left), mb_strlen($right));

        if ($max === 0) {
            return 1.0;
        }

        return max(0.0, 1 - (levenshtein($left, $right) / $max));
    }

    private function damerauLevenshteinRatio(string $left, string $right): float
    {
        $distance = $this->damerauLevenshtein($left, $right);
        $max = max(mb_strlen($left), mb_strlen($right));

        return $max === 0 ? 1.0 : max(0.0, 1 - ($distance / $max));
    }

    private function damerauLevenshtein(string $left, string $right): int
    {
        $a = mb_str_split($left);
        $b = mb_str_split($right);
        $rows = count($a);
        $cols = count($b);
        $matrix = [];

        for ($i = 0; $i <= $rows; $i++) {
            $matrix[$i][0] = $i;
        }

        for ($j = 0; $j <= $cols; $j++) {
            $matrix[0][$j] = $j;
        }

        for ($i = 1; $i <= $rows; $i++) {
            for ($j = 1; $j <= $cols; $j++) {
                $cost = $a[$i - 1] === $b[$j - 1] ? 0 : 1;
                $matrix[$i][$j] = min(
                    $matrix[$i - 1][$j] + 1,
                    $matrix[$i][$j - 1] + 1,
                    $matrix[$i - 1][$j - 1] + $cost,
                );

                if ($i > 1 && $j > 1 && $a[$i - 1] === $b[$j - 2] && $a[$i - 2] === $b[$j - 1]) {
                    $matrix[$i][$j] = min($matrix[$i][$j], $matrix[$i - 2][$j - 2] + 1);
                }
            }
        }

        return $matrix[$rows][$cols];
    }

    private function jaroWinkler(string $left, string $right): float
    {
        $jaro = $this->jaro($left, $right);
        $prefix = 0;
        $maxPrefix = min(4, mb_strlen($left), mb_strlen($right));

        for ($i = 0; $i < $maxPrefix; $i++) {
            if (mb_substr($left, $i, 1) !== mb_substr($right, $i, 1)) {
                break;
            }
            $prefix++;
        }

        return $jaro + ($prefix * 0.1 * (1 - $jaro));
    }

    private function jaro(string $left, string $right): float
    {
        $leftLength = mb_strlen($left);
        $rightLength = mb_strlen($right);

        if ($leftLength === 0 && $rightLength === 0) {
            return 1.0;
        }

        $matchDistance = max($leftLength, $rightLength) / 2 - 1;
        $leftMatches = array_fill(0, $leftLength, false);
        $rightMatches = array_fill(0, $rightLength, false);
        $matches = 0;

        for ($i = 0; $i < $leftLength; $i++) {
            $start = max(0, (int) floor($i - $matchDistance));
            $end = min($i + (int) floor($matchDistance) + 1, $rightLength);

            for ($j = $start; $j < $end; $j++) {
                if ($rightMatches[$j] || mb_substr($left, $i, 1) !== mb_substr($right, $j, 1)) {
                    continue;
                }

                $leftMatches[$i] = true;
                $rightMatches[$j] = true;
                $matches++;
                break;
            }
        }

        if ($matches === 0) {
            return 0.0;
        }

        $transpositions = 0;
        $k = 0;

        for ($i = 0; $i < $leftLength; $i++) {
            if (! $leftMatches[$i]) {
                continue;
            }

            while (! $rightMatches[$k]) {
                $k++;
            }

            if (mb_substr($left, $i, 1) !== mb_substr($right, $k, 1)) {
                $transpositions++;
            }

            $k++;
        }

        return (($matches / $leftLength) + ($matches / $rightLength) + (($matches - ($transpositions / 2)) / $matches)) / 3;
    }

    private function jaccard(string $left, string $right): float
    {
        $leftTokens = $this->normalizer->tokens($left);
        $rightTokens = $this->normalizer->tokens($right);
        $union = array_unique([...$leftTokens, ...$rightTokens]);

        if ($union === []) {
            return 0.0;
        }

        return count(array_intersect($leftTokens, $rightTokens)) / count($union);
    }

    private function cosine(string $left, string $right): float
    {
        $leftCounts = array_count_values($this->normalizer->tokens($left));
        $rightCounts = array_count_values($this->normalizer->tokens($right));
        $allTokens = array_unique([...array_keys($leftCounts), ...array_keys($rightCounts)]);
        $dot = 0;
        $leftNorm = 0;
        $rightNorm = 0;

        foreach ($allTokens as $token) {
            $a = $leftCounts[$token] ?? 0;
            $b = $rightCounts[$token] ?? 0;
            $dot += $a * $b;
            $leftNorm += $a * $a;
            $rightNorm += $b * $b;
        }

        if ($leftNorm === 0 || $rightNorm === 0) {
            return 0.0;
        }

        return $dot / (sqrt($leftNorm) * sqrt($rightNorm));
    }

    private function sorensenDice(string $left, string $right): float
    {
        $leftTokens = $this->normalizer->tokens($left);
        $rightTokens = $this->normalizer->tokens($right);
        $total = count($leftTokens) + count($rightTokens);

        return $total === 0 ? 0.0 : (2 * count(array_intersect($leftTokens, $rightTokens))) / $total;
    }

    private function ratcliffObershelp(string $left, string $right): float
    {
        similar_text($left, $right, $percent);

        return $percent / 100;
    }

    private function mongeElkan(string $left, string $right): float
    {
        $leftTokens = $this->normalizer->tokens($left);
        $rightTokens = $this->normalizer->tokens($right);

        if ($leftTokens === [] || $rightTokens === []) {
            return 0.0;
        }

        $sum = 0.0;

        foreach ($leftTokens as $leftToken) {
            $best = 0.0;

            foreach ($rightTokens as $rightToken) {
                $best = max($best, $this->jaroWinkler($leftToken, $rightToken));
            }

            $sum += $best;
        }

        return $sum / count($leftTokens);
    }

    private function smithWaterman(string $left, string $right): float
    {
        $a = mb_str_split($left);
        $b = mb_str_split($right);
        $best = 0;
        $matrix = [];

        for ($i = 0; $i <= count($a); $i++) {
            $matrix[$i] = array_fill(0, count($b) + 1, 0);
        }

        for ($i = 1; $i <= count($a); $i++) {
            for ($j = 1; $j <= count($b); $j++) {
                $match = $a[$i - 1] === $b[$j - 1] ? 2 : -1;
                $matrix[$i][$j] = max(
                    0,
                    $matrix[$i - 1][$j - 1] + $match,
                    $matrix[$i - 1][$j] - 1,
                    $matrix[$i][$j - 1] - 1,
                );
                $best = max($best, $matrix[$i][$j]);
            }
        }

        $max = 2 * min(count($a), count($b));

        return $max === 0 ? 0.0 : min(1.0, $best / $max);
    }

    private function tokenSortRatio(string $left, string $right): float
    {
        return $this->levenshteinRatio($this->sortTokens($left), $this->sortTokens($right));
    }

    private function tokenSetRatio(string $left, string $right): float
    {
        return max(
            $this->levenshteinRatio($this->tokenSetText($left), $this->tokenSetText($right)),
            $this->jaccard($left, $right),
        );
    }

    private function partialRatio(string $left, string $right): float
    {
        if (mb_strlen($left) > mb_strlen($right)) {
            [$left, $right] = [$right, $left];
        }

        $length = mb_strlen($left);
        $best = 0.0;

        for ($i = 0; $i <= mb_strlen($right) - $length; $i++) {
            $best = max($best, $this->levenshteinRatio($left, mb_substr($right, $i, $length)));
        }

        return $best;
    }

    private function sortTokens(string $value): string
    {
        $tokens = $this->normalizer->tokens($value);
        sort($tokens);

        return implode(' ', $tokens);
    }

    private function tokenSetText(string $value): string
    {
        $tokens = $this->normalizer->tokens($value);
        sort($tokens);

        return implode(' ', array_unique($tokens));
    }
}
