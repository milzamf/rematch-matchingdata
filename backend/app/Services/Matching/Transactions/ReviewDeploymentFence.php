<?php

namespace App\Services\Matching\Transactions;

final class ReviewDeploymentFence
{
    public static function frozen(): bool
    {
        $path = config('review_deployment.freeze_file');
        if (is_string($path) && $path !== '') {
            clearstatcache(true, $path);
            if (file_exists($path)) return true;
        }
        return (bool) config('review_deployment.write_frozen', false);
    }

    public static function legacyBlocked(): bool
    {
        return self::frozen() || config('workspace_access.enabled', false) || config('review_transactions.enabled', false);
    }

    public static function assertWritable(bool $legacy = false): void
    {
        if (self::frozen()) throw new ReviewWriteConflict('review_deployment_frozen', [], 503);
        if ($legacy && self::legacyBlocked()) throw new ReviewWriteConflict('legacy_workspace_write_disabled');
    }
}
