<?php

namespace App\Services\Matching\Transactions;

use Illuminate\Database\ConnectionInterface;

final class ReviewDeploymentFence
{
    public static function productionMode(): bool
    {
        return \Illuminate\Container\Container::getInstance()->bound('config') && config('review_deployment.mode', 'isolated') === 'production';
    }
    public static function assertConnection(ConnectionInterface $db, bool $enabled, string $disabled): void
    {
        if (! $enabled || $db->getDriverName() !== 'mysql') throw new ReviewWriteConflict($disabled, [], 503);
        $mode = config('review_deployment.mode', 'isolated');
        if ($mode === 'isolated' && $db->getDatabaseName() === 'rematch_stage4_test' && getenv('REMATCH_REVIEW_TEST') === 'isolated-stage4') return;
        if ($mode !== 'production' || ! self::productionApproved($db->getDatabaseName())) {
            throw new ReviewWriteConflict('review_deployment_not_approved', [], 503);
        }
    }

    private static function productionApproved(string $database, bool $maintenance = false): bool
    {
        $expected = config('review_deployment.database');
        $release = config('review_deployment.release');
        $file = config('review_deployment.approval_file');
        $hash = config('review_deployment.approval_sha256');
        if (! is_string($expected) || $expected === '' || $database !== $expected || ! is_string($release) || $release === ''
            || (bool) config('workspace_access.enabled', false) !== ! $maintenance || (bool) config('review_transactions.enabled', false) !== ! $maintenance
            || ! is_string($file) || ! is_file($file) || ! is_readable($file)
            || ! is_string($hash) || ! preg_match('/^[a-f0-9]{64}$/D', $hash)) return false;
        // Bounded operator-owned evidence; pin bytes to deployment config, never to a request.
        $bytes = file_get_contents($file, false, null, 0, 16385);
        if ($bytes === false || strlen($bytes) > 16384 || ! hash_equals($hash, hash('sha256', $bytes))) return false;
        $proof = json_decode($bytes, true);
        if (! is_array($proof)) return false;
        return ($proof['database'] ?? null) === $expected && ($proof['release'] ?? null) === $release
            && ($proof['contract_version'] ?? null) === 1 && ($proof['schema_version'] ?? null) === 1
            && ($proof['backup_restore_verified'] ?? null) === true && ($proof['post_write_recovery_verified'] ?? null) === true
            && ($proof['writer_drain_verified'] ?? null) === true && ($proof['recovery_policy'] ?? null) === 'forward_only'
            && is_string($proof['backup_sha256'] ?? null) && preg_match('/^[a-f0-9]{64}$/D', $proof['backup_sha256']) === 1;
    }

    /** Production instances must use the same pre-created lock inode on a flock-capable shared volume. */
    public static function withAdmission(callable $work): mixed
    {
        if (! self::productionMode()) return $work();
        return self::locked(LOCK_SH, $work);
    }

    public static function withMaintenance(ConnectionInterface $db, callable $work): mixed
    {
        if (! self::productionMode()) {
            if ($db->getDriverName() === 'mysql' && $db->getDatabaseName() === 'rematch_stage3_test' && getenv('REMATCH_BACKFILL_TEST') === 'isolated-stage3') return $work();
            throw new ReviewWriteConflict('review_maintenance_not_approved', [], 503);
        }
        if ($db->getDriverName() !== 'mysql' || ! self::frozen() || ! self::productionApproved($db->getDatabaseName(), true)) {
            throw new ReviewWriteConflict('review_maintenance_not_approved', [], 503);
        }
        return self::locked(LOCK_EX, function () use ($work) {
            if (! self::frozen()) throw new ReviewWriteConflict('review_maintenance_not_approved', [], 503);
            return $work();
        });
    }

    private static function locked(int $kind, callable $work): mixed
    {
        $path = config('review_deployment.admission_lock_file');
        if (! is_string($path) || $path === '' || ! is_file($path) || ($file = fopen($path, 'r+b')) === false) {
            throw new ReviewWriteConflict('review_admission_lock_unavailable', [], 503);
        }
        try {
            if (! flock($file, $kind | LOCK_NB)) throw new ReviewWriteConflict('review_deployment_busy', [], 503);
            return $work();
        } finally {
            flock($file, LOCK_UN);
            fclose($file);
        }
    }

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
