# BatchMatch Changelog

## Current Frontend Milestones

### Added

- Initial BatchMatch frontend shell with Dashboard, Matching, Results, and Settings.
- Authentication mock screens for login, register, forgot password, protected routes, and user workspace context.
- Matching wizard with 8 steps: Upload, Profiling, Mapping, Configure, Run, Review, Sync, Export.
- Results tabs: Overview, Matched, Possible Match, Unmatched, Statistics, Audit Trail, Export History.
- Settings sections for profile, matching defaults, theme, language, AI preferences, data privacy, and about.

### Improved

- UI Polish: simplified navigation, removed Pro Tip, aligned tables, refined stepper, improved mapping/configuration/review/results layouts.
- Synchronization Strategy: added Sync step and merge strategy controls for matched, unmatched, possible match, and conflict handling.
- Preferences: added light/dark/system theme, English/Bahasa Indonesia language switcher, localStorage preferences, and reusable preferences context.
- Frontend Finalization: added loading states, empty states, error states, toast notifications, and confirmation dialogs across Dashboard, Matching, Results, and Settings.

### Documentation

- Added initial architecture documentation for roadmap, architecture, database model, API modules, and changelog.

## Upcoming

- Architecture hardening and DX automation.
- Laravel REST API.
- Matching engine implementation.
- AI assistance integration.
- Export generation and audit trail persistence.
- Production deployment preparation.
