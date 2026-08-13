<?php

namespace App\Support\Auth;

use App\Models\Dataset;
use App\Models\MatchingJob;
use App\Models\MatchingResult;
use App\Models\ReviewDecision;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Database\Eloquent\Builder;

class ResourceOwnership
{
    public function canViewAll(User $user): bool
    {
        return in_array($user->roleEnum(), [UserRole::Admin, UserRole::Pimpinan], true);
    }

    public function canManageAll(User $user): bool
    {
        return $user->roleEnum() === UserRole::Admin;
    }

    public function scopeWorkspaces(Builder $query, User $user): Builder
    {
        return $this->canViewAll($user)
            ? $query
            : $query->where('user_id', $user->getKey());
    }

    public function scopeDatasets(Builder $query, User $user): Builder
    {
        return $this->canViewAll($user)
            ? $query
            : $query->where(function (Builder $scopedQuery) use ($user) {
                $scopedQuery
                    ->whereIn(
                        'workspace_id',
                        Workspace::query()
                            ->where('user_id', $user->getKey())
                            ->select('id'),
                    )
                    ->orWhere(function (Builder $legacyQuery) use ($user) {
                        $legacyQuery
                            ->whereNull('workspace_id')
                            ->where(function (Builder $legacyWorkspaceQuery) use ($user) {
                                $legacyWorkspaceQuery
                                    ->whereIn(
                                        'id',
                                        Workspace::query()
                                            ->where('user_id', $user->getKey())
                                            ->select('reference_dataset_id')
                                            ->whereNotNull('reference_dataset_id'),
                                    )
                                    ->orWhereIn(
                                        'id',
                                        Workspace::query()
                                            ->where('user_id', $user->getKey())
                                            ->select('input_dataset_id')
                                            ->whereNotNull('input_dataset_id'),
                                    );
                            });
                    });
            });
    }

    public function scopeMatchingJobs(Builder $query, User $user): Builder
    {
        return $this->canViewAll($user)
            ? $query
            : $query->where(function (Builder $scopedQuery) use ($user) {
                $scopedQuery
                    ->whereIn(
                        'workspace_id',
                        Workspace::query()
                            ->where('user_id', $user->getKey())
                            ->select('id'),
                    )
                    ->orWhere(function (Builder $legacyQuery) use ($user) {
                        $legacyQuery
                            ->whereNull('workspace_id')
                            ->whereIn(
                                'id',
                                Workspace::query()
                                    ->where('user_id', $user->getKey())
                                    ->select('matching_job_id')
                                    ->whereNotNull('matching_job_id'),
                            );
                    });
            });
    }

    public function findWorkspace(User $user, string $workspaceId): Workspace
    {
        return $this->scopeWorkspaces(Workspace::query(), $user)->findOrFail($workspaceId);
    }

    public function findDataset(User $user, string $datasetId): Dataset
    {
        return $this->scopeDatasets(Dataset::query(), $user)->findOrFail($datasetId);
    }

    public function findMatchingJob(User $user, string $jobId): MatchingJob
    {
        return $this->scopeMatchingJobs(MatchingJob::query(), $user)->findOrFail($jobId);
    }

    public function scopeMatchingResults(Builder $query, User $user): Builder
    {
        return $this->canViewAll($user)
            ? $query
            : $query->whereHas('job', function (Builder $jobQuery) use ($user) {
                $jobQuery->where(function (Builder $scopedJobQuery) use ($user) {
                    $scopedJobQuery
                        ->whereIn(
                            'workspace_id',
                            Workspace::query()
                                ->where('user_id', $user->getKey())
                                ->select('id'),
                        )
                        ->orWhere(function (Builder $legacyQuery) use ($user) {
                            $legacyQuery
                                ->whereNull('workspace_id')
                                ->whereIn(
                                    'id',
                                    Workspace::query()
                                        ->where('user_id', $user->getKey())
                                        ->select('matching_job_id')
                                        ->whereNotNull('matching_job_id'),
                                );
                        });
                });
            });
    }

    public function findMatchingResult(User $user, string $resultId): MatchingResult
    {
        return $this->scopeMatchingResults(MatchingResult::query(), $user)->findOrFail($resultId);
    }

    public function scopeReviewDecisions(Builder $query, User $user): Builder
    {
        return $this->canViewAll($user)
            ? $query
            : $query->where(function (Builder $scopedQuery) use ($user) {
                $scopedQuery
                    ->whereHas('job', function (Builder $jobQuery) use ($user) {
                        $jobQuery->where(function (Builder $scopedJobQuery) use ($user) {
                            $scopedJobQuery
                                ->whereIn(
                                    'workspace_id',
                                    Workspace::query()
                                        ->where('user_id', $user->getKey())
                                        ->select('id'),
                                )
                                ->orWhere(function (Builder $legacyQuery) use ($user) {
                                    $legacyQuery
                                        ->whereNull('workspace_id')
                                        ->whereIn(
                                            'id',
                                            Workspace::query()
                                                ->where('user_id', $user->getKey())
                                                ->select('matching_job_id')
                                                ->whereNotNull('matching_job_id'),
                                        );
                                });
                        });
                    })
                    ->orWhereHas('result.job', function (Builder $jobQuery) use ($user) {
                        $jobQuery->where(function (Builder $scopedJobQuery) use ($user) {
                            $scopedJobQuery
                                ->whereIn(
                                    'workspace_id',
                                    Workspace::query()
                                        ->where('user_id', $user->getKey())
                                        ->select('id'),
                                )
                                ->orWhere(function (Builder $legacyQuery) use ($user) {
                                    $legacyQuery
                                        ->whereNull('workspace_id')
                                        ->whereIn(
                                            'id',
                                            Workspace::query()
                                                ->where('user_id', $user->getKey())
                                                ->select('matching_job_id')
                                                ->whereNotNull('matching_job_id'),
                                        );
                                });
                        });
                    });
            });
    }

    public function findReviewDecision(User $user, string $decisionId): ReviewDecision
    {
        return $this->scopeReviewDecisions(ReviewDecision::query(), $user)->findOrFail($decisionId);
    }
}
