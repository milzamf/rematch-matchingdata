# BatchMatch Architecture

## 1. Overview

Workspace access and approval Tahap 5A (2026-10-13): isolated WorkspaceAccessService derives owner from workspaces.user_id and checks application role plus membership. WorkspaceMembershipService uses versioned row locks for grants/revocation; review holds a shared membership lock through commit. Proposal/approval reuse the Stage 4 executor, CAS, holds, unique assignments and append-only audit; approved state remains protected. Twelve guarded /api/stage5a routes are inactive on main. No new schema or legacy writer/reader cutover. See [REVIEW_ACCESS_APPROVAL_STAGE5A.md](REVIEW_ACCESS_APPROVAL_STAGE5A.md).

Review transactions Tahap 4 (2026-10-13) are implemented and tested only in an isolated MySQL 8 database. The new service uses version CAS, idempotent operations, bounded resource locks, unique assignments and append-only Undo. Existing API readers/writers remain on the legacy path; no main migration or cutover is performed. The disabled flag alone cannot activate the service. See [REVIEW_TRANSACTIONS_STAGE4.md](REVIEW_TRANSACTIONS_STAGE4.md) for transaction flow, constraints, tests and activation prerequisites.

Review performance stabilization (2026-10-11): full-job per-column aggregates are computed in MySQL and cached independently of paginated table reads. Immutable case membership is cached separately from current decisions and audit history. Individual decisions lock only targeted results and return a lightweight snapshot after commit. Docker shares Composer dependencies through native volume `rematch_backend_vendor`, while application source remains bind-mounted for development.

BatchMatch uses a separated architecture:

- Frontend: React + Tailwind CSS
- Backend: Laravel REST API
- Authentication: Laravel Sanctum session/cookie auth
- Authorization: backend role/permission map plus direct workflow ownership returned through `/api/me`
- Database: MySQL or PostgreSQL
- Matching Engine: Laravel Service Layer, with optional Python/RapidFuzz service later
- AI Assistance: External AI API through backend only
- Export Engine: Backend service for Excel, CSV, JSON, and audit output

Frontend must never access database, AI token, or file storage directly. It authenticates through Laravel Sanctum session cookies and reads the current user plus permissions from `/api/me`.
Frontend auth bootstrap should run once per application load, while persisted workspace hydration should remain a separate backend-first flow keyed by `workspace` and validated `step` search params.
Direct resource scoping now lives in the backend: `user` sees only owned workflow resources, `admin` can manage all, and `pimpinan` gets read-only cross-workspace visibility.

---

## 2. High-Level Architecture

```mermaid
flowchart LR
    U[User] --> FE[React Frontend]
    FE --> API[Laravel REST API]
    API --> DB[(Database)]
    API --> FS[File Storage]
    API --> ME[Matching Engine]
    API --> AI[AI Assistance Service]
    API --> EX[Export Engine]
    ME --> DB
    AI --> DB
    EX --> FS

## 3. Main Workflow
flowchart TD
    A[Upload] --> B[Profiling]
    B --> C[Mapping]
    C --> D[Configure]
    D --> E[Run Matching]
    E --> F[Review]
    F --> G[Sync]
    G --> H[Export]
    H --> I[Audit Trail]

## 4. Backend Layering
Laravel should use service-oriented structure.

Controller
↓
Form Request
↓
Action / Service
↓
Repository
↓
Model
↓
Database

Controllers must stay thin. Business logic belongs in Services or Actions.

Recommended folders:
app/
├── Actions/
├── DTO/
├── Enums/
├── Http/
├── Jobs/
├── Models/
├── Policies/
├── Repositories/
├── Services/
├── Support/
└── ValueObjects/

## 5. Core Backend Services
### AuthService
Handles login, current session lookup, logout, CSRF flow, role payload, and protected API access.

### Authorization Layer
Maps roles (`admin`, `user`, `pimpinan`) to permissions in the backend. Frontend permission awareness must follow backend-returned permissions and must not become the source of truth.

### Ownership Layer
Direct ownership is stored on `workspaces`, `datasets`, and `matching_jobs` through `user_id`. Backend controllers and services must scope reads and writes through this ownership layer before touching workflow resources.

### DatasetService
Handles uploaded datasets, metadata, storage, parser selection, and dataset ownership.

### ProfilingService
Generates column statistics, missing values, unique values, duplicate rate, and suggested key columns.

### MappingService
Stores and validates reference/input column mappings.

### MatchingConfigurationService
Stores preset, strategy, thresholds, normalization, Search Optimization, candidate count, output configuration, and advanced settings.

### MatchingEngineService
Runs the matching pipeline.

Pipeline:
Parser
→ Profiler
→ Normalizer
→ Search Optimization
→ Candidate Generator
→ Field Scorer
→ Composite Scorer
→ Decision Engine
→ Review Queue

### ReviewService
Handles accept, reject, skip, reviewer notes, and candidate decisions.

### SyncService
Applies merge strategy:
skip/drop matched duplicates
append unmatched records
update reference records
resolve conflicts

### ExportService
Generates downloadable outputs and audit sheets.

### AIRecommendationService
Provides AI suggestions for profiling, mapping, configuration, review explanation, and tuning.
AI tokens must only exist in backend environment variables.

### AuditTrailService
Records important user actions, configuration changes, AI suggestions, review decisions, sync decisions, and export activity.

## 6. Main Entities
Initial entities:
users
workspaces
datasets
dataset_columns
matching_jobs
column_mappings
matching_configurations
matching_results
review_decisions
sync_plans
exports
audit_logs
ai_recommendations

Current implementation supports authenticated identity, role/permission awareness, and direct per-user workflow ownership. Multi-user workspace membership/collaboration remains a separate milestone.

## 7. API Modules
Planned REST API groups:
/api/auth
/api/user
/api/workspaces
/api/datasets
/api/profiling
/api/matching-jobs
/api/mappings
/api/configurations
/api/results
/api/reviews
/api/sync
/api/exports
/api/ai
/api/audit-logs 

## 8. File Handling
Uploaded files are stored through Laravel storage.
Rules:

original files must never be modified
parsed output should be stored separately
temporary files should expire
file access must require authenticated user/session
sensitive content must not be logged

## 9. AI Integration
AI is optional.
Frontend calls Laravel API. Laravel calls AI provider.

flowchart LR
    FE[Frontend] --> API[Laravel API]
    API --> REDACT[Masking / Redaction]
    REDACT --> AI[AI Provider]
    AI --> API
    API --> DB[(Store Recommendation)]
    API --> FE

Rules:
never expose AI token to frontend
mask sensitive fields before AI request
AI suggestions are optional
user must confirm before applying suggestions
applied/ignored AI suggestions are stored in audit trail

## 10. Export Architecture
Export output may include:
Summary
Matched
Possible Match
Unmatched
Mapping
Config
Score Detail
Review Decisions
Sync Summary
Audit Trail

Export generation should run in backend service or queue job.

## 11. Queue Jobs
Long-running operations should use jobs:
ParseDatasetJob
ProfileDatasetJob
RunMatchingJob
GenerateExportJob
GenerateAIRecommendationJob
CleanupTemporaryFilesJob

## 12. Security Principles
- use Laravel Sanctum for authentication
- hash passwords securely
- validate uploaded files
- restrict file access by user/workspace
- store AI tokens in .env
- mask sensitive data before AI calls
- never log raw sensitive data
- record audit trail for important actions

## 13. Frontend Responsibility

Frontend handles:
UI state
workflow navigation
form input
table display
review interaction
preferences
API calls

Frontend must not handle:
file parsing
matching calculation
AI token
database logic
export generation

## 14. Backend Responsibility

Backend handles:
authentication
authorization
file storage
parsing
profiling
matching
AI integration
export generation
audit logging

## 15. Future Scalability
Potential future improvements:
- Python matching microservice
- queue workers
- Redis cache
- object storage
- role-based access control
- scheduled matching
- active learning from review decisions
- probabilistic linkage engine
- enterprise deployment with Docker

## Frontend Stage 5B isolation boundary (2026-10-13)

`VITE_WORKSPACE_SHARING_UI` defaults off. Flag-off Matching/workspace pages use their retained legacy implementations. Flag-on components in `src/components/workspace-access` use only authenticated Stage 5A membership/review/approval APIs, effective backend capabilities, CAS versions, exact keys and operation acknowledgements. Administrator access management reuses the same modal while existing owner reassignment remains separate. No new backend route/security bypass.

Stage 5A resource metadata is not a shared dataset or current review-state reader. The new record UI accepts an explicit versioned read-model interface; its only current demonstration binding is a dev-only local fixture. Production does not infer versions, combine new writers with old ownership readers, or switch historical status sources. Full readers, owner metadata and genuine isolated browser/backend integration require a separately approved contract before cutover. See REVIEW_FRONTEND_STAGE5B.md for capabilities, tests and limits.
## Tahap 5C read model boundary (2026-10-13)

`SharedWorkspaceReader` reuses Stage 5A scope/permission and isolated guard, reads effective decisions solely from ready schema-1 review_states, and batches page candidates/actors/canonical pointers. Matching results remain immutable snapshot/score evidence; no similarity rerun or legacy-history fallback. Workspace metadata distinguishes current workspace datasets from actual active-job datasets. Source file preview is streamed and reauthorized after I/O; unavailable file yields explicit partial preview. Legacy active readers/frontends are untouched. See [REVIEW_READERS_STAGE5C.md](REVIEW_READERS_STAGE5C.md) for contracts, isolation, tests and remaining dynamic-score/search performance risks. No schema/main migration/backfill/cutover/feature activation.

## Integrated shared reader and score projection (2026-10-14)

Blocker hardening adds an inactive deployment fence in global API middleware plus direct review writer and matching/region queue admission. A shared freeze marker is checked dynamically to avoid relying solely on cached flags. Business reads are also stopped during freeze because legacy GETs can enqueue work/build caches. Existing requests/workers must be drained before snapshots; no runtime production guard is relaxed. Recovery sidecars now retain preexisting state versions/operation IDs and fail closed for missing/changed proof or changed source/history, without altering main schema or historical decisions.

The flag-on frontend now reads actual Stage 5C state/candidate/dataset APIs and uses Stage 4/5A versioned review, membership and approval services. Additive derived score projection enables indexed sorting without changing historical scores or decisions; unprepared jobs retain join fallback. CSV export reauthorizes each keyset chunk and now materializes on temporary disk before successful download headers, with a final authorization check and cleanup on generation failure. Chunks are not a single global snapshot; process crashes require temporary-file cleanup. Legacy decision/Undo writes are fenced when either new backend flag is enabled; other deployment writers still need coordinated fencing. Feature flags and the main database remain unchanged. See SHARED_WORKSPACE_INTEGRATION_QA.md for proof and rollout limits.
