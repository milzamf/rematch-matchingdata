<?php

namespace App\Support\Auth;

class PermissionRegistry
{
    public const DASHBOARD_VIEW = 'dashboard.view';
    public const WORKSPACE_VIEW = 'workspace.view';
    public const WORKSPACE_CREATE = 'workspace.create';
    public const WORKSPACE_UPDATE = 'workspace.update';
    public const WORKSPACE_DELETE = 'workspace.delete';
    public const MATCHING_VIEW = 'matching.view';
    public const MATCHING_CREATE = 'matching.create';
    public const MATCHING_CONFIGURE = 'matching.configure';
    public const MATCHING_RUN = 'matching.run';
    public const REVIEW_VIEW = 'review.view';
    public const REVIEW_DECIDE = 'review.decide';
    public const SYNC_VIEW = 'sync.view';
    public const SYNC_EXECUTE = 'sync.execute';
    public const EXPORT_VIEW = 'export.view';
    public const EXPORT_EXECUTE = 'export.execute';
    public const MONITORING_VIEW = 'monitoring.view';
    public const ADMIN_ACCESS = 'admin.access';

    /**
     * @return list<string>
     */
    public static function all(): array
    {
        return [
            self::DASHBOARD_VIEW,
            self::WORKSPACE_VIEW,
            self::WORKSPACE_CREATE,
            self::WORKSPACE_UPDATE,
            self::WORKSPACE_DELETE,
            self::MATCHING_VIEW,
            self::MATCHING_CREATE,
            self::MATCHING_CONFIGURE,
            self::MATCHING_RUN,
            self::REVIEW_VIEW,
            self::REVIEW_DECIDE,
            self::SYNC_VIEW,
            self::SYNC_EXECUTE,
            self::EXPORT_VIEW,
            self::EXPORT_EXECUTE,
            self::MONITORING_VIEW,
            self::ADMIN_ACCESS,
        ];
    }

    /**
     * @return list<string>
     */
    public static function forRole(UserRole|string|null $role): array
    {
        $resolvedRole = $role instanceof UserRole
            ? $role
            : UserRole::tryFrom((string) $role) ?? UserRole::User;

        return match ($resolvedRole) {
            UserRole::Admin => self::all(),
            UserRole::Pimpinan => [
                self::DASHBOARD_VIEW,
                self::WORKSPACE_VIEW,
                self::MATCHING_VIEW,
                self::REVIEW_VIEW,
                self::SYNC_VIEW,
                self::EXPORT_VIEW,
                self::MONITORING_VIEW,
            ],
            UserRole::User => [
                self::DASHBOARD_VIEW,
                self::WORKSPACE_VIEW,
                self::WORKSPACE_CREATE,
                self::WORKSPACE_UPDATE,
                self::WORKSPACE_DELETE,
                self::MATCHING_VIEW,
                self::MATCHING_CREATE,
                self::MATCHING_CONFIGURE,
                self::MATCHING_RUN,
                self::REVIEW_VIEW,
                self::REVIEW_DECIDE,
                self::SYNC_VIEW,
                self::SYNC_EXECUTE,
                self::EXPORT_VIEW,
                self::EXPORT_EXECUTE,
            ],
        };
    }
}
