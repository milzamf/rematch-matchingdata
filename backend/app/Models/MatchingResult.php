<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Services\Matching\MatchingPayloadCodec;

class MatchingResult extends Model
{
    private array $snapshotRows = [];
    use HasFactory, HasUuids;

    protected $fillable = [
        'matching_job_id',
        'input_record_key',
        'reference_record_key',
        'result_type',
        'review_status',
        'review_decision',
        'reviewed_at',
        'overall_score',
        'candidate_rank',
        'field_scores',
        'candidate_metadata',
        'decision_reason',
        'verification_evidence',
        'input_province_code',
        'input_regency_code',
        'input_region_indexed',
    ];

    protected function casts(): array
    {
        return [
            'overall_score' => 'float',
            'candidate_rank' => 'integer',
            'field_scores' => 'array',
            'candidate_metadata' => 'array',
            'verification_evidence' => 'array',
            'reviewed_at' => 'datetime',
        ];
    }

    public function job(): BelongsTo
    {
        return $this->belongsTo(MatchingJob::class, 'matching_job_id');
    }

    public function reviewDecisions(): HasMany
    {
        return $this->hasMany(ReviewDecision::class, 'matching_result_id');
    }

    public function getCandidateMetadataAttribute(mixed $value): ?array
    {
        if ($value === null) return null;
        $metadata = is_array($value) ? $value : json_decode($value, true, 512, JSON_THROW_ON_ERROR);
        if (isset($metadata['_reference_snapshot'])) {
            $id = $metadata['_reference_snapshot'];
            $metadata['reference_record'] = $this->snapshotRows[$id] ??= \App\Services\Matching\MatchingRecordSnapshots::load($id, $this->getConnection());
            $metadata['reference_record'] += $metadata['_reference_generated'] ?? [];
        }
        if (isset($metadata['_input_primary'])) {
            if ((string) $metadata['_input_primary'] !== (string) $this->input_record_key) throw new \RuntimeException('Input snapshot identity mismatch.');
            $key = 'input:'.$this->matching_job_id.':key:'.$metadata['_input_primary'];
            if (! array_key_exists($key, $this->snapshotRows)) self::preloadSnapshots(collect([$this]));
            if (! array_key_exists($key, $this->snapshotRows)) throw new \RuntimeException('Immutable input snapshot is unavailable.');
            $metadata['input_record'] = $this->snapshotRows[$key];
        }
        return $metadata;
    }

    /** Batch only the displayed page/chunk, without changing persisted result metadata. */
    public static function preloadSnapshots(\Illuminate\Support\Collection $models): void
    {
        foreach ($models->groupBy(fn ($model) => spl_object_id($model->getConnection())) as $group) {
            $db = $group->first()->getConnection();
            $metadata = $group->map(fn ($model) => json_decode($model->getAttributes()['candidate_metadata'] ?? '{}', true, 512, JSON_THROW_ON_ERROR));
            $references = \App\Services\Matching\MatchingRecordSnapshots::loadMany($metadata->pluck('_reference_snapshot')->filter()->all(), $db);
            $inputs = [];
            foreach ($group->groupBy('matching_job_id') as $job => $jobModels) {
                $keys = [];
                foreach ($jobModels as $model) {
                    $meta = json_decode($model->getAttributes()['candidate_metadata'] ?? '{}', true, 512, JSON_THROW_ON_ERROR);
                    if (isset($meta['_input_primary'])) {
                        if ((string) $meta['_input_primary'] !== (string) $model->input_record_key) throw new \RuntimeException('Input snapshot identity mismatch.');
                        $keys[] = (string) $meta['_input_primary'];
                    }
                    if ((int) $model->candidate_rank === 1 && isset($meta['input_record'])) $inputs['input:'.$job.':key:'.$model->input_record_key] = $meta['input_record'];
                }
                $keys = array_values(array_unique(array_filter($keys, fn ($key) => ! array_key_exists('input:'.$job.':key:'.$key, $inputs))));
                foreach (array_chunk($keys, 100) as $chunk) {
                    foreach ($db->table('matching_results')->where('matching_job_id', $job)->where('candidate_rank', 1)->whereIn('input_record_key', $chunk)->get(['input_record_key', 'candidate_metadata']) as $primary) {
                        $meta = json_decode($primary->candidate_metadata ?? '{}', true, 512, JSON_THROW_ON_ERROR);
                        if (in_array((string) $primary->input_record_key, $chunk, true) && isset($meta['input_record']) && ! isset($meta['_input_primary'])) $inputs['input:'.$job.':key:'.$primary->input_record_key] = $meta['input_record'];
                    }
                }
            }
            foreach ($group as $model) {
                $meta = json_decode($model->getAttributes()['candidate_metadata'] ?? '{}', true, 512, JSON_THROW_ON_ERROR);
                if (isset($meta['_reference_snapshot'])) $model->snapshotRows[$meta['_reference_snapshot']] = $references[$meta['_reference_snapshot']];
                $key = 'input:'.$model->matching_job_id.':key:'.$model->input_record_key;
                if (isset($inputs[$key])) $model->snapshotRows[$key] = $inputs[$key];
            }
        }
    }

    /** Read historical JSON columns and lossless evidence stored with new metadata. */
    public function getVerificationEvidenceAttribute(mixed $value): ?array
    {
        if ($value !== null) return is_array($value) ? $value : MatchingPayloadCodec::decode($value);
        $packed = ($this->candidate_metadata ?? [])['_verification_evidence'] ?? null;
        return is_string($packed) ? MatchingPayloadCodec::decode($packed) : null;
    }

    public function getFieldScoresAttribute(mixed $value): ?array
    {
        $packed = ($this->candidate_metadata ?? [])['_field_scores'] ?? null;
        if (is_string($packed)) return MatchingPayloadCodec::decode($packed);
        return $value === null ? null : (is_array($value) ? $value : MatchingPayloadCodec::decode($value));
    }
}
