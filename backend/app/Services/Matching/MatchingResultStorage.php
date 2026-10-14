<?php

namespace App\Services\Matching;

class MatchingResultStorage
{
    /** Keep SQL aggregates readable, pack the complete score explanation losslessly. */
    public static function pack(array $metadata, array $fields, ?array $evidence): array
    {
        unset($metadata['_field_scores'], $metadata['_verification_evidence']);
        $projection = array_map(static fn ($field) => array_intersect_key($field,
            array_flip(['reference_column', 'input_column', 'score'])), $fields);
        if ($evidence !== null) $metadata['_verification_evidence'] = MatchingPayloadCodec::encode($evidence);
        $jsonOptions = JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION;
        $fullFields = json_encode($fields, $jsonOptions);
        $fullMetadata = json_encode($metadata, $jsonOptions);
        $metadata['_field_scores'] = MatchingPayloadCodec::encode($fields);
        $compactFields = json_encode($projection, $jsonOptions);
        $compactMetadata = json_encode($metadata, $jsonOptions);
        // Short explanations need no envelope: never grow a record just to compress it.
        $useCompact = strlen($compactFields) + strlen($compactMetadata) < strlen($fullFields) + strlen($fullMetadata);
        return [
            'field_scores' => $useCompact ? $compactFields : $fullFields,
            'candidate_metadata' => $useCompact ? $compactMetadata : $fullMetadata,
            'verification_evidence' => null,
        ];
    }
}
