# RE-MATCH Design System & Responsive Specification

Dokumentasi sistem desain, token UI, aturan tipografi responsif, dan panduan layout multi-device (Desktop, Tablet, Mobile) untuk aplikasi **RE-MATCH (Sistem Matching Data)**.

---

## 1. Brand Tokens & Identity

### 1.1 Color Tokens
- **Brand Primary**: `hsl(var(--brand))` / `#0284c7` (Sky-600)
- **Brand Foreground**: `hsl(var(--brand-foreground))` / `#ffffff`
- **Background**:
  - Light: `#ffffff` (`hsl(0, 0%, 100%)`)
  - Dark: `#09090b` (`hsl(240, 10%, 3.9%)`)
- **Card / Surface**:
  - Light: `#ffffff` / Border `#e4e4e7`
  - Dark: `#18181b` / Border `#27272a`
- **Text Hierarchy**:
  - Foreground (Primary): `hsl(var(--foreground))`
  - Muted Foreground (Secondary): `hsl(var(--muted-foreground))`
- **Semantic Status**:
  - Exact / Match: Green (`#16a34a`)
  - High Confidence / Review: Amber (`#d97706`)
  - Low / Non-Match: Red / Zinc (`#dc2626` / `#71717a`)

### 1.2 Identity & Typography
- **Primary Font**: Inter, system-ui, sans-serif
- **Brand Logo Typography**:
  - Format: `RE-` + `<span class="text-brand">MATCH</span>`
  - **Single-Line Non-Breaking Guarantee**: Always rendered with `inline-block whitespace-nowrap` and non-breaking hyphen `&#8209;` to prevent orphan line wrapping.
- **Organization Unit**:
  - **Full Name**: "Direktorat Statistik Sumber Daya Mineral dan Konstruksi"
  - **Strict Constraint**: Must fit on a **single line (`sebaris`)** without wrapping words like "Konstruksi" to the next line.

---

## 2. Responsive Breakpoint & Typography Scale

| Viewport Category | Screen Width (`px`) | Typography Adjustment | Layout Behavior |
|---|---|---|---|
| **Mobile Compact** | `< 375px` | `text-[10px]` - `text-xs` | Single column, drawer sidebar, touch targets $\ge 44\text{px}$ |
| **Mobile Standard** | `375px - 639px` | `text-[11px]` - `text-sm` | Single column, stacked controls, full width cards |
| **Tablet** | `640px - 1023px` | `text-xs` - `text-base` | Collapsible sidebar, flexible 2-column grids |
| **Desktop** | `\ge 1024px` | `text-xs` - `text-base` | Fixed sidebar, multi-column dashboard, persistent controls |

### 2.1 Responsive Typography Rules
1. **Header Unit Organization**:
   - Class: `text-[10px] min-[360px]:text-[11px] sm:text-xs md:text-[13px] font-medium text-muted-foreground tracking-tight whitespace-nowrap select-none max-w-full text-center`
   - Keeps 57 characters in one neat row across all viewports down to 360px without text overflow or clipping.
2. **Card Subtitles**:
   - Class: `text-xs sm:text-sm text-muted-foreground leading-normal`
   - Explicit inline wrapping for `RE&#8209;MATCH` ensures cleanly balanced text blocks.
3. **Table Headers & Data Cells**:
   - Header: `text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground`
   - Data: `text-xs sm:text-sm text-foreground`

---

## 3. Component Hierarchy & Layout Specifications

### 3.1 Authentication Shell (`AuthShell`)
- **Container**: `w-full max-w-md sm:max-w-lg mx-auto`
- **Padding**: `px-4 py-8 sm:py-12`
- **Form Constraints**:
  - Always uses `noValidate` to suppress intrusive native browser constraint validation popups.
  - Input field label: `Email/Username` (accepts both username and full email addresses).
  - Explicit input attributes: `type="text"`, `inputMode="text"`, `autoComplete="username"`.

### 3.2 Responsive Navigation
- **Desktop ($\ge 1024\text{px}$)**:
  - Sidebar fixed at `w-64` (collapsed: `w-18`), scroll-locked with native overflow-y inside the navigation container.
- **Mobile & Tablet ($< 1024\text{px}$)**:
  - Sidebar converts into an accessible off-canvas drawer (`Sheet` / overlay).
  - Header displays a toggle hamburger button with touch target $\ge 44\times 44\text{px}$.

### 3.3 Data Normalization & Stepper Flow
- Multi-step workflow (`Upload`, `Column Mapping`, `Matching Config`, `Execution`, `Review`, `Export`):
  - Stepper labels truncate gracefully on mobile, switching to circular step indicators with tooltips.
  - Dropdowns and selects use scrollable containers with bounded heights (`max-h-60 overflow-y-auto`) to ensure seamless touchpad and touch interactions.

---

## 4. Performance & Database Query Guarantees

In accordance with Supabase Postgres and MySQL performance best practices:
1. **Foreign Key Indexing**: All foreign key relationships (`workspaces.reference_dataset_id`, `workspaces.input_dataset_id`, `workspaces.matching_job_id`, `review_decisions.matching_result_id`, `review_decisions.reviewer_user_id`, `datasets.user_id`) possess direct b-tree indexes to prevent table scans on joins and cascades.
2. **Composite Sorting Indexes**:
   - `['user_id', 'updated_at']` on `workspaces` for $O(\log n)$ dashboard workspace retrieval.
   - `['matching_job_id', 'candidate_rank', 'overall_score']` on `matching_results` for prioritized candidate retrieval.
   - `['matching_job_id', 'created_at']` and `['matching_job_id', 'undone_at']` on `review_decisions` for audit trails and undo logs.

---

## 5. Security & Defensive Architecture

In accordance with autonomous security testing standards:
1. **Brute-Force Rate Limiting**: Authentication endpoints enforce IP and account-scoped throttling (max 5 attempts per minute with exponential backoff).
2. **Strict Resource Ownership**: Scopes dataset and workspace queries strictly to the authenticated user's workspace domain or administrative role, eliminating IDOR risks.
3. **Input Sanitization & Type Validation**: Strict request validation using FormRequests with string normalization and trimmed credentials.
