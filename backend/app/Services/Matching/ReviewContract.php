<?php

namespace App\Services\Matching;

use App\Models\ReviewDecision;
use InvalidArgumentException;

/** Compatibility only: no entity resolution or concurrency guarantees. */
final class ReviewContract
{
    public const VERSION = 1;

    public static function resultType(string $decision): string
    {
        return match ($decision) {
            'accept_match', 'select_candidate' => 'matched',
            'reject_match' => 'possible_match',
            'mark_unmatched' => 'unmatched',
            default => throw new InvalidArgumentException('Unsupported review decision.'),
        };
    }

    public static function actors(ReviewDecision $decision): array
    {
        $reviewer = $decision->reviewer_user_id;
        return [
            'reviewer_user_id' => $reviewer,
            'proposed_by_user_id' => null,
            'approved_by_user_id' => null,
            'last_modified_by_user_id' => $decision->undone_at !== null
                ? data_get($decision->metadata, 'undone_by_user_id') : $reviewer,
            'attribution' => $reviewer === null ? 'unknown_legacy' : 'authenticated',
        ];
    }

    public static function accounting(array $counts, int $matchedInputRecords): array
    {
        // Legacy fallbacks are not evidence of source lineage or verified corporate identity.
        return [
            'source_row_count' => isset($counts['total_raw_input']) ? (int) $counts['total_raw_input'] : null,
            'unique_input_record_count' => isset($counts['total_unique_input']) ? (int) $counts['total_unique_input'] : null,
            'deduplicated_input_row_count' => isset($counts['total_duplicates']) ? (int) $counts['total_duplicates'] : null,
            'matched_input_record_count' => $matchedInputRecords,
            'verified_duplicate_entity_count' => null,
            'matched_entity_count' => null,
            'lineage_status' => 'unverified',
        ];
    }
}
