# BatchMatch API Draft

Status: Initial REST API module outline. No implementation yet.

## API Principles

- Backend target: Laravel REST API.
- Frontend target: React + Vite consuming JSON APIs.
- Authentication protects each user's workspace, jobs, uploads, exports, review history, and audit trail.
- API responses should support loading, empty, error, and validation states in the frontend.

## Endpoint Groups

### Auth

- Login with username and password.
- Register a user and create or join a workspace.
- Request password reset by email.
- Logout and session/token invalidation.

### User

- Read current user profile.
- Update profile fields such as full name, email, organization, and role.
- Read and update user preferences for theme, language, matching defaults, AI preferences, and privacy settings.

### Dataset Upload

- Upload reference and input datasets.
- Validate file type, size, parser support, and basic file integrity.
- List uploaded datasets within a workspace.
- Read dataset metadata, sheets/tables, schema, and parse warnings.

### Profiling

- Generate profile summaries for uploaded datasets.
- Return column type detection, missing values, uniqueness, duplicate risk, frequent values, and pattern hints.
- Return optional AI profiling suggestions when AI is enabled.

### Matching Job

- Create a matching job from selected reference and input datasets.
- Save mapping, configuration, threshold, normalization, candidate strategy, sync strategy, and output settings.
- Start, retry, cancel, and inspect job status.

### Results

- Read job summary and result counts.
- List matched, possible match, and unmatched records.
- Read statistics, synchronization summary, audit trail, and export history.

### Review

- List possible matches requiring manual review.
- Approve, reject, skip, or force match a candidate.
- Record reviewer decisions and confidence notes.

### Sync

- Save selected merge strategy.
- Preview estimated dropped, appended, updated, conflict, and final reference counts.
- Apply sync strategy after matching and review decisions are complete.

### Export

- Create export requests for selected result scope and file format.
- Download generated files.
- List export history and export metadata.

### AI Suggestions

- Request profiling suggestions.
- Request column mapping suggestions.
- Request matching configuration recommendations.
- Request review explanations and tuning recommendations.
- Record accepted, ignored, or modified AI recommendations for auditability.

## Not Included Yet

- Concrete routes, controllers, request schemas, response schemas, policies, queues, and migrations.
