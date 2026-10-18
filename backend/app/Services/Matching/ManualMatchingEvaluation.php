<?php

namespace App\Services\Matching;

/** Offline diagnostic evaluation. Human labels are mandatory; never changes decisions or thresholds. */
final class ManualMatchingEvaluation
{
    public function evaluate(iterable $rows): array
    {
        $counts = ['pairs' => 0, 'labelled' => 0, 'unlabelled' => 0, 'uncertain' => 0, 'correct_pairs' => 0,
            'auto_matched' => 0, 'auto_labelled' => 0, 'auto_correct' => 0, 'auto_incorrect' => 0];
        $thresholds = array_fill_keys([90, 95, 98, 99, 100], ['labelled' => 0, 'correct' => 0, 'incorrect' => 0]);
        $categories = []; $seen = [];
        foreach ($rows as $row) {
            if (++$counts['pairs'] > 50) throw new \InvalidArgumentException('Maksimal 50 pasangan untuk sampel diagnostik.');
            foreach (['Key input', 'Key acuan', 'Status sistem', 'Label petugas', 'Similarity (%)'] as $column) {
                if (! array_key_exists($column, $row)) throw new \InvalidArgumentException('Kolom sampel tidak lengkap: '.$column);
            }
            $input = (string) $row['Key input']; $reference = (string) $row['Key acuan'];
            $pair = json_encode([$input, $reference], JSON_THROW_ON_ERROR);
            if ($input === '' || $reference === '' || isset($seen[$pair])) throw new \InvalidArgumentException('Key kosong atau pasangan berulang; evaluasi dibatalkan.');
            $seen[$pair] = true;
            $label = mb_strtolower(trim((string) $row['Label petugas']));
            if (! in_array($label, ['', 'cocok', 'tidak cocok', 'belum pasti'], true)) throw new \InvalidArgumentException('Label harus Cocok, Tidak cocok, Belum pasti, atau kosong.');
            $score = $row['Similarity (%)'];
            if ($score !== null && $score !== '' && (! is_numeric($score) || (float) $score < 0 || (float) $score > 100)) throw new \InvalidArgumentException('Similarity harus 0–100 atau kosong.');
            $category = (string) ($row['Kategori sampel'] ?? 'Tanpa kategori');
            $categories[$category] ??= ['pairs' => 0, 'labelled' => 0, 'correct' => 0];
            $categories[$category]['pairs']++;
            $auto = in_array($row['Status sistem'], ['matched', 'auto_matched'], true) && empty($row['Keputusan sistem']);
            if ($auto) $counts['auto_matched']++;
            if ($label === '') { $counts['unlabelled']++; continue; }
            if ($label === 'belum pasti') { $counts['uncertain']++; continue; }
            $correct = $label === 'cocok';
            $counts['labelled']++; $counts['correct_pairs'] += (int) $correct;
            $categories[$category]['labelled']++; $categories[$category]['correct'] += (int) $correct;
            if ($auto) {
                $counts['auto_labelled']++;
                $counts[$correct ? 'auto_correct' : 'auto_incorrect']++;
            }
            if ($score === null || $score === '') continue;
            foreach ($thresholds as $threshold => &$bucket) {
                if ((float) $score < $threshold) continue;
                $bucket['labelled']++; $bucket[$correct ? 'correct' : 'incorrect']++;
            }
            unset($bucket);
        }
        $precision = $counts['auto_labelled'] ? $counts['auto_correct'] / $counts['auto_labelled'] : null;
        return ['scope' => 'Sampel diagnostik purposif; bukan estimasi akurasi populasi. Tidak ada perubahan database atau threshold.',
            'counts' => $counts, 'auto_match_precision_on_labelled_sample' => $precision, 'categories' => $categories,
            'score_threshold_diagnostics_only' => $thresholds, 'candidate_recall' => null,
            'limitations' => ['Recall pencarian tidak dapat dihitung dari pasangan yang sudah tersimpan; perlu pasangan benar termasuk yang tidak masuk kandidat.',
                'Bucket skor bukan rekomendasi aktivasi otomatis; guardrail, konflik dan label independen tetap diperlukan.'],
            'ready_for_calibration_review' => $counts['labelled'] > 0 && $counts['unlabelled'] === 0 && $counts['uncertain'] === 0];
    }
}
