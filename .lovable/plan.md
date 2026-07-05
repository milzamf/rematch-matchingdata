# BatchMatch Refinement Plan

Refine the existing frontend without redesigning. Keep visual identity, sidebar (Dashboard / Matching / Results / Settings), typography, cards, spacing.

## 1. Dashboard (`/`) — action-oriented top section

Restructure into two zones:

**Zone A — Action Hero (new top section)**
- Welcome message: "Welcome back, {name}"
- 3-column action grid:
  - **Continue Last Job** card — shows last in-progress job name + step, primary CTA "Resume"
  - **New Matching** card — icon + CTA button routing to `/matching`
  - **Pending Manual Reviews** card — count badge + CTA "Review now" routing to `/results?tab=possible`
- Empty state when no last job → replace card with "No jobs yet — start your first match"

**Zone B — Existing content (kept, reordered below)**
- KPI cards row
- Recent Matching Jobs
- Data Quality
- Matching Insights

## 2. Matching (`/matching`) — continuous horizontal stepper

- Replace current step navigation with a single horizontal stepper across the top: Upload → Profiling → Mapping → Configuration → Run → Manual Review → Export
- Sticky stepper header; each step: number circle + label + connector line; states: done (check), active (filled), upcoming (muted)
- Body renders the active step content; footer with "Back" / "Next" always visible
- Adds:
  - **Upload validation**: file type (.csv/.xlsx), max size, required columns → inline errors
  - **Loading state** on Run step (progress bar + phase text)
  - **Failed job state** on Run step (error card + Retry / Back to config)
  - **Empty state** on Manual Review step when no ambiguous rows

## 3. Results (`/results`) — completed-jobs workspace

Reorder tabs to: **Overview** · Matched · Possible Match · Unmatched · Statistics · Audit Trail · Export
- New **Overview** tab: job summary card (name, dataset, timestamp, duration), quick stats, and shortcuts to other tabs
- New **Export** tab: format picker (CSV/XLSX/JSON), scope (all/matched/possible/unmatched), download button, recent exports list
- Move existing "Matching History" out of Results (Overview replaces the entry point); keep history accessible via Dashboard's Recent Jobs
- Add empty state ("No completed jobs yet") when user has no results
- Loading skeletons on tab switches

## 4. Authentication (new)

New public routes outside sidebar layout:
- `/login` — Username + Password, link to Register + Forgot Password
- `/register` — Full Name, Username, Email, Password
- `/forgot-password` — Email + success confirmation state

Frontend-only auth simulation (localStorage-based mock user + workspace scope):
- `useAuth` hook exposing current user
- App layout redirects to `/login` if no session
- Dummy data filtered by `user.id` so each user only sees their own datasets/jobs/exports/reviews/audit

Topbar: show user avatar + dropdown with Sign out.

## 5. Cross-cutting polish

- Reusable components: `EmptyState`, `LoadingState` (skeleton), `ErrorState`, `Stepper`, `ActionCard`
- Loading skeletons on Dashboard cards, Results tables, Matching profiling
- Consistent empty-state illustration/text pattern across pages
- Upload validation utility shared between Matching upload step and any future upload

## Technical Notes

- Stack: TanStack Start + Tailwind (no changes)
- Auth is **frontend-only mock** (no backend / Lovable Cloud) — session in `localStorage`, users stored client-side; note this is UI scaffolding only, not real security
- New files:
  - `src/routes/login.tsx`, `src/routes/register.tsx`, `src/routes/forgot-password.tsx`
  - `src/routes/_authenticated.tsx` (pathless layout wrapping current app routes) — move `index.tsx`, `matching.tsx`, `results.tsx`, `settings.tsx` under `_authenticated/`
  - `src/lib/auth.ts` (mock auth + user scope helper)
  - `src/components/empty-state.tsx`, `src/components/stepper.tsx`, `src/components/action-card.tsx`
- Modified: dashboard, matching, results, topbar, dummy-data (add `userId` field + filter helpers)
- No backend, no database, no real password handling
