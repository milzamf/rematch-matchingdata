export const ROLES = ["admin", "user", "pimpinan"] as const;

export type UserRole = (typeof ROLES)[number];

export const PERMISSIONS = {
  DASHBOARD_VIEW: "dashboard.view",
  WORKSPACE_VIEW: "workspace.view",
  WORKSPACE_CREATE: "workspace.create",
  WORKSPACE_UPDATE: "workspace.update",
  WORKSPACE_DELETE: "workspace.delete",
  MATCHING_VIEW: "matching.view",
  MATCHING_CREATE: "matching.create",
  MATCHING_CONFIGURE: "matching.configure",
  MATCHING_RUN: "matching.run",
  REVIEW_VIEW: "review.view",
  REVIEW_DECIDE: "review.decide",
  SYNC_VIEW: "sync.view",
  SYNC_EXECUTE: "sync.execute",
  EXPORT_VIEW: "export.view",
  EXPORT_EXECUTE: "export.execute",
  MONITORING_VIEW: "monitoring.view",
  ADMIN_ACCESS: "admin.access",
} as const;

export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export function defaultRouteForRole(role: UserRole | null) {
  if (role === "pimpinan") {
    return "/monitoring" as const;
  }

  return "/" as const;
}

export function hasPermission(
  permissions: readonly string[],
  permission: PermissionName | string,
) {
  return permissions.includes(permission);
}
