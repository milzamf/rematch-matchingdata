# BatchMatch Project Rules

## Source of Truth

- `PRD.md` is the single source of truth for features and business rules.

## UI Standard

- Keep the existing BatchMatch UI clean, soft, minimalist, and enterprise SaaS.
- Do not redesign the application unless explicitly requested.
- Keep the main navigation:
  - Dashboard
  - Matching
  - Results
  - Settings
- Keep the main workflow:
  Upload -> Profiling -> Mapping -> Configure -> Run -> Review -> Sync -> Export

## Coding Rules

- Only modify files related to the requested task.
- Prefer reusable components and avoid duplicated code.
- Do not introduce unnecessary dependencies.

## Quality Gate

Before finishing every task:

- Run the project build.
- Review changed files.
- Compare implementation with `PRD.md`.
- Identify regressions.

## Final Report

Every implementation task must end with a report containing:

1. What changed
2. Files changed
3. PRD alignment
4. Potential issues
5. Recommended improvements
6. Whether the changes are safe to commit
