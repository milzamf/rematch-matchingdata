# RE-MATCH — Frontend Tahap 5B (2026-10-13)

## 1. Scope and readiness

Sharing/access/approval frontend implemented behind `VITE_WORKSPACE_SHARING_UI === "true"`, default **off**. No `.env`, Compose flag, backend code, database, migration, backfill, algorithm, or historical decision was changed in this stage. No primary database/UI writes were performed.

**Not a production cutover or proof of complete shared-workspace reader integration.** Stage 5A has authenticated, isolated mutation endpoints and scoped metadata inspection, but does not expose a full workspace snapshot, shared dataset preview, paginated versioned review-state reader, or owner-name DTO. The existing legacy reader does not supply current `review_states.version` / protection and still applies legacy ownership. It must not be combined with the new writer by guessing versions or bypassing ownership.

Consequently the flag-on Matching screen safely presents accessible metadata, access management and approvals. Versioned record-review controls accept an explicit read-model interface; this stage exercises them through a **development-only local fixture**, not an invented endpoint. Full shared data/candidate/progress rendering remains a reader-contract dependency before cutover. Flag-off Matching, workspace list, filtering and decision routes retain their existing behavior. No workspace is cloned.

## 2. Files and components

Added frontend:
- `src/lib/workspace-access.ts`: typed Stage 5A API client, build flag, decision/proposal labels and durable conflict errors.
- `src/components/workspace-access/use-workspace-access.ts`: actor-scoped permission query, periodic/focus refresh, fail-closed rendering.
- `access-feedback.tsx`: conflict/error details and explicit reload action.
- `access-management.tsx`: reusable modal/button, registered user search, versioned membership add/change/reactivate/revoke, confirmation, paginated members, safe lookup across revoked tombstones/all pages.
- `approval-inbox.tsx`: paginated status filters, old/new decision, actors, reference keys, reason/time, approve/reject dialog.
- `versioned-review.tsx`: proposal-required protection, decision/proposal/Undo actions consuming state versions and operation acknowledgements.
- `shared-workspaces.tsx`, `shared-matching.tsx`: gated same-ID workspace list and active workspace shell with effective permissions.
- `src/testing/stage5b-review-fixture.ts`: clearly marked dev-only local read model; excluded by production `DEV` branch.
- `playwright.stage5b.config.ts`, `playwright/stage5b/workspace-access.spec.ts`, `legacy.spec.ts`: isolated mock browser verification.

Modified frontend:
- `src/routes/matching.tsx`, `workspaces.tsx`: small outer flag branches; original page implementations retained.
- `src/routes/admin.tsx`: gated access button on mobile/desktop workspace rows; existing Open and owner reassignment stay separate.
- `src/lib/api.ts`: exports existing authenticated transport; its behavior is unchanged.
- `src/components/ui/searchable-select.tsx`: optional remote-search callback, same option/panel styling with visible descriptions; no new dependency.

Documentation: this report, SESSION, CHANGELOG, IMPLEMENTATION_STATUS, ARCHITECTURE and API notes. Other pre-existing dirty files are not changes attributed to Stage 5B.

## 3. Actual Stage 5A API integration

All requests use existing session/CSRF-aware transport and `/api/stage5a`. No alternate writer or new backend route.

| Endpoint | Frontend use |
| --- | --- |
| GET workspaces?page | Own/shared/global list, existing IDs, scalar metadata |
| GET workspaces/{id}/permissions | Exact read/review/propose/approve/members/configure/run/dataset_write/export_read flags |
| GET workspaces/{id}/members?page | Member names, roles, active/revoked status, CAS versions |
| GET workspaces/{id}/users?search | Registered app users only, debounced minimum two characters |
| POST workspaces/{id}/members | user_id, editor/viewer role, expected_version (0 only after absence checked) |
| DELETE workspaces/{id}/members/{user_id} | exact expected_version |
| GET jobs/{id}/proposals?status&page | Paginated proposals and previous/proposer/approver display attribution |
| POST jobs/{id}/proposals | exact input string key, expected state version, decision, candidate ID when needed, reason, idempotency key |
| POST jobs/{id}/proposals/{id}/resolve | expected request version, approve, reason, idempotency key |
| POST jobs/{id}/decisions | versioned items and idempotency key |
| POST jobs/{id}/undo | operation ID, acknowledged per-record versions and idempotency key |

Stage 5A `resources/{kind}/{resource}` was audited: scoped scalar metadata only; not used as a substitute for full dataset/review reading. Membership mutation responses contain only user_id/role/status/version, not a fabricated full member DTO. Actor IDs are never sent in mutation payloads. Opaque input keys are not trimmed/coerced (`001` preserved).

## 4. Permission rendering

Permissions come from the server, not the global app role or ownership guess. Auth actor is included in query keys. Refresh interval 10 seconds, window-focus refresh; errors fail closed and hide writable data/actions. An action already in flight still relies on server permission checks. Revocation removes controls when the next response/refetch arrives; no claim of real-time push revocation.

Owner/Admin membership/approval controls require `members` / `approve`. Editor initial/own review requires `review`; other-reviewer/unknown reviewer-owned or approved protection routes to `propose`. Viewer and Pimpinan have no write/revision/approval controls. Backend remains the enforcement boundary. Shared-reader gaps disable new record actions outside the explicit isolated fixture rather than fall back to legacy endpoints.

List shows own/shared/lateral access, status, effective role and owner. Where Stage 5A only supplies owner ID, it displays `Pengguna #ID` honestly. Actual owner name is used when available from the current actor or existing admin DTO. Resolving all owner names needs an approved scoped metadata contract expansion.

## 5. Flows and status compatibility

The same access modal serves Matching and Administrasi. Search is registered-user only; Editor/Viewer options use the same custom select without a search box. Revoke uses a separate confirmation. Grant/update/reactivation include the current member/tombstone version. A bounded sequential page lookup prevents treating a user outside the visible page as a new member.

Revision dialog includes current decision, previous reviewer when known, candidate/reference, proposed decision and mandatory reason. Successful proposal sets a pending notice but **does not replace effective state**. Owner/Admin inbox displays pending/approved/rejected/stale/conflicted/cancelled statuses from server responses. Approval/rejection never runs solely in frontend.

`reject_match` remains "Tolak Kandidat", distinct from `mark_unmatched`; historical effective categories are not reclassified. Undo uses the acknowledged operation/version. Existing bulk/Undo paths remain untouched with flag off. Stage 5A has no bulk approval endpoint; none invented.

## 6. Concurrency/error handling

AbortSignal cancels superseded read queries. No automatic mutation retry. State-version conflict, stale proposal version/snapshot, reference occupancy, input/reference integrity holds, membership CAS conflict, and permission loss have separate messages and an explicit read-reload option.

HTTP 409 resolution payload `{success:false,data:ack}` is preserved as a durable acknowledgement, including proposal status/conflict code. Ordinary `{success:false,code,details}` and 403/422/503 are handled separately. Partial decision acknowledgement with an unsuccessful item is not reported as success. Failed versioned writes stay blocked while awaiting a validated fresh read model; no guessed version increment or conflicting write replay.

Responsive dialogs use existing Radix portals, searchable/non-searchable cmdk panels, overflow bounds and focus restoration. Mobile member identity occupies a full row to avoid crushing names/email between controls.

## 7. Verification

- Chromium mock suite: **17 passed**, including member add Editor/Viewer, role/revoke, Owner/Admin management/open, Editor proposal, Viewer/Pimpinan read only, approve/reject, durable stale 409, reference/hold conflict without replay, permission revocation, acknowledged Undo, same-ID navigation, mobile bounds/keyboard/focus.
- Flag-off browser regression: **1 passed** — legacy list/open, review, similarity filtering and legacy decision POST; zero Stage 5A requests. This is not a full legacy bulk/Undo/export regression run.
- Node Stage 1 compatibility regression: **3 passed**.
- TypeScript `npx tsc --noEmit`: passed. Focused ESLint on new frontend/test files and modified select: passed (no errors/warnings after final fixes).
- Production `npm run build`: passed with default flag off. Dev fixture text/module excluded from production output.
- Repository-wide `npm run lint` did not complete in the broad repository scan and was stopped. Bounded `npx eslint src` ran and failed: **25,150 errors / 21 warnings**, predominantly existing formatting (25,124 auto-fixable errors). No mass-formatting of existing files was attempted. Do not describe global lint as clean.
- Visual mobile snapshots inspected at `review/screenshots/stage5b-sharing-mobile.png`, `stage5b-select-mobile.png`, `stage5b-approval-mobile.png`; targeted responsive rerun after the final mobile spacing adjustment: **2 passed**.

Browser server uses only loopback port 5177 with per-process flags; API proxy points to unused loopback port 9, all API responses/writes intercepted in each isolated browser context. Unknown API requests fail instead of reaching the primary backend. Mock assertions verify exact mutation payloads and no write replay. These successes **are not real Stage 5A backend integration tests**. No new MySQL/backend test was run in this frontend-only stage; prior Stage 5A results remain in its own report.

Development Vite source-tag hydration warnings were observed on pre-existing root-shell source locations; browser functional checks still passed. Production build success alone does not prove production hydration/e2e behavior.

## 8. Memory/performance and rollback

Lists/members/proposals retain bounded 50-row pages. Search returns at most 25 users. Permission polling deduplicates through query cache. Membership lookup/workspace metadata lookup walk pages sequentially and retain only one page at a time, but may take multiple requests with many members/workspaces. No JSON dataset scan, similarity re-run, schema change, or primary cache invalidation. This is not a 300k-input UI/load benchmark.

Flags stay off; rollback is leaving the UI flag false and rebuilding. There are no database effects to roll back. No cutover flag or live backend endpoint was opened. Each write sends a fresh operation idempotency key; uncertain transport outcomes require reading latest server state, not automatically generating a replacement write.

## 9. Remaining integration risks

1. Full shared workspace/dataset/review-state readers with actual current version/protection/actors and scoped candidates must be designed/approved and tested. Current metadata/legacy readers cannot meet this requirement.
2. Owner-name metadata is unavailable in Stage 5A list DTO; ID fallback is intentional.
3. Real backend/browser approval-to-effective-row refresh, protected ownership after approval, dataset/export reads, bulk/Undo and permission changes during long sessions require a complete isolated reader/writer integration test.
4. Production SSR/a11y/load testing and repository-wide lint baseline remain outstanding. No notifications/push channel introduced.
5. Do not enable the main UI flag: the backend fixed-test guard still blocks main Stage 5A routes, and main DB has no stage schema/backfill/cutover.

## 10. Preparation for the next approved stage

First finalize missing reader/metadata contracts, preserving exact keys and separating effective state/version/protection/actor identities. Connect the existing read-model component interface only to those approved scoped readers. Test actual Laravel sessions/CSRF + MySQL in isolation, including read refresh after decisions/approval/Undo, protected proposer permissions and concurrent revocation. Re-run legacy navigation/filter/bulk/export suites and full-dataset UI/performance checks. Main migration/backfill/reconciliation readiness and runtime cutover remain separate approval gates. Stop at this stage; no activation performed.
