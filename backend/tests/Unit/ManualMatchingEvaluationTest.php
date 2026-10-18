<?php

namespace Tests\Unit;

use App\Services\Matching\ManualMatchingEvaluation;
use Tests\TestCase;

class ManualMatchingEvaluationTest extends TestCase
{
    private function row(string $input, string $label = '', string $status = 'matched'): array
    {
        return ['Key input' => $input, 'Key acuan' => 'ref', 'Status sistem' => $status, 'Label petugas' => $label, 'Similarity (%)' => 98];
    }

    public function test_empty_labels_never_become_ground_truth(): void
    {
        $report = (new ManualMatchingEvaluation)->evaluate([$this->row('001'), $this->row('1', 'Belum pasti')]);
        $this->assertSame(0, $report['counts']['labelled']);
        $this->assertNull($report['auto_match_precision_on_labelled_sample']);
        $this->assertFalse($report['ready_for_calibration_review']);
        $this->assertNull($report['candidate_recall']);
    }

    public function test_metrics_use_explicit_labels_and_keep_manual_decisions_separate(): void
    {
        $manual = $this->row('manual', 'Tidak cocok'); $manual['Keputusan sistem'] = 'accept_match';
        $report = (new ManualMatchingEvaluation)->evaluate([$this->row('001', 'Cocok'), $this->row('1', 'Tidak cocok'), $this->row('pending', 'Cocok', 'possible_match'), $manual]);
        $this->assertSame(0.5, $report['auto_match_precision_on_labelled_sample']);
        $this->assertSame(2, $report['counts']['auto_matched']);
        $this->assertSame(4, $report['counts']['labelled']);
        $this->assertSame(2, $report['score_threshold_diagnostics_only'][98]['incorrect']);
        $this->assertSame(0, $report['score_threshold_diagnostics_only'][99]['labelled']);
    }

    public function test_duplicate_pairs_are_rejected_instead_of_double_counted(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        (new ManualMatchingEvaluation)->evaluate([$this->row('001', 'Cocok'), $this->row('001', 'Tidak cocok')]);
    }
}
