# PrimeOS — Video Analysis & Implementation Handoff (for Codex)

## 1. Executive Summary & Objective
This handoff defines the complete implementation specification derived from the E2E analysis of **"תוצרים · PrimeOS.mp4"** (Duration: 19:46).
The scope includes UI/UX cleanups, removal of clutter/redundant text, navigation and workflow simplifications, 3 key feature implementations (Multi-Slide Carousel, Real-time Reactive Post Counter, Full-Screen Content Approval Feed), and 1 critical bug fix in the Annual Planner.

- **Total Tasks**: 19 tasks
- **Total Estimated Work Time**: **12 hours and 10 minutes** (730 minutes)
- **Target Working Branch**: `main` (commit and push directly to `main`, no branches/PRs, no AI attribution)

---

## 2. Persistent Assets & Local Reference Files

| Asset | Local File Path | Description |
| :--- | :--- | :--- |
| **Interactive RTL HTML Report** | [docs/primeos_video_tasks.html](docs/primeos_video_tasks.html) | Standalone visual report with all screenshots, Hebrew quotes & tasks table |
| **HTML Report (Downloads)** |  | Synced copy in user's Downloads folder |
| **Full Transcript (JSON)** | [docs/video_analysis/transcript.json](docs/video_analysis/transcript.json) | Full Whisper Hebrew transcript with start/end seconds |
| **Formatted Transcript (Text)** | [docs/video_analysis/transcript_formatted.txt](docs/video_analysis/transcript_formatted.txt) | Clean Hebrew transcript with timestamps `[MM:SS]` |
| **Screenshots Directory** | [docs/video_analysis/screenshots/](docs/video_analysis/screenshots/) | 20 high-resolution frame captures for each task |
| **Source Video** | `/Users/itaykarkason/Downloads/תוצרים · PrimeOS.mp4` | Original 19:46 mp4 recording |

---

## 3. Technology Stack & Key Code Locations

- **Stack**: React 18 + Vite + TypeScript + Tailwind CSS + Lucide Icons + Supabase (PostgreSQL, Auth, Edge Functions).
- **Core File Mappings**:
  - `src/pages/admin/ProductionPage.tsx` — Creation tiles (header), prompt input, output left edit sidebar.
  - `src/pages/admin/FilesPage.tsx` — Output files archive (to be made strictly Read-Only: Preview & Download only).
  - `src/pages/admin/HolidaysCalendarPage.tsx` — Calendar & post management (single hub for editing scheduled posts).
  - `src/pages/admin/AnnualPlannerPage.tsx` — Annual content planning, source material dropzone, steps wizard & generation.
  - `src/pages/admin/BrandingPage.tsx` / `src/pages/OnboardingPage.tsx` — Brand settings, brand documents & onboarding flow.
  - `src/components/` — Modals (UserContentUploadModal, SocialScheduleSection, etc.).

---

## 4. Master Task Inventory (19 Tasks — Total: 12h 10m)

| ID | Component / Area | Video Timestamp | Work Time | Summary of Required Changes |
| :--- | :--- | :--- | :--- | :--- |
| **TASK-01** | `ProductionPage` (Header) | `00:08 - 00:31` | 40 min | Make creation tiles horizontal & compact (label beside icon), subtle green highlight on input, reduce tile height to save vertical space. |
| **TASK-02** | `ProductionPage` | `00:31 - 00:45` | 0 min | Temporarily hide/remove unready product types ('presentation' and 'document' / 'pdf') from `PRODUCT_TYPES`. |
| **TASK-03** | `ProductionPage` | `00:46 - 00:53` | 0 min | Remove redundant descriptive sub-sentences underneath product type buttons. |
| **TASK-04** | `Upload` / `ProductionPage` | `00:53 - 01:30` | 30 min | Fix file upload `accept` filters to properly allow images (PNG, JPG, WebP) and documents (PDF, DOCX, TXT) per context. |
| **TASK-05** | `Outputs` / `FilesPage` | `01:53 - 02:32` | 60 min | Restrict Outputs Archive to Read-Only: only 2 actions — Preview & Download (remove edit, reschedule & upload buttons). |
| **TASK-06** | `Onboarding` / `BrandingPage` | `02:54 - 04:40` | 120 min (2h) | Allow direct access to brand settings without stepping through wizard; move brand documents to the top of the page. |
| **TASK-07** | `Calendar` vs `Archive` | `05:36 - 06:35` | 45 min | Centralize all post edits/rescheduling in Calendar only (click on post in Calendar to edit text, image, date, channels). |
| **TASK-08** | Output Left Sidebar | `05:16-05:40 & 07:25-08:38` | 45 min | Elevate action buttons, remove long confusing explanations, clean title `עריכת פוסט`, add tabs `[שנה טקסט \| שנה תמונה]`. |
| **TASK-09** | Text Edit Panel | `08:41 - 09:24` | 20 min | Clean text editing: clear label `ניתן לשנות ידנית` above textarea + compact AI prompt `שנה עם AI` below. |
| **TASK-10** | Image Edit / Carousel | `09:28 - 10:49` | 90 min (1.5h) | **New Feature**: Carousel creation workflow — support adding multiple slides (`הוסף שקופית` / `העלה תמונה קיימת`). |
| **TASK-11** | Social Schedule Modal | `11:10 - 12:38` | 30 min | Auto-fill post name default, remove redundant AI writing tools from schedule modal, focus only on platforms, date & time. |
| **TASK-12** | `AnnualPlannerPage` | `12:46 - 14:13` | 0 min | Update H1: `תכנון תוכן שנתי`, Subtitle: `תכנן עם AI תוכן לכל השנה לפי חגים, מועדים ואירועים`, and remove redundant brand box "את עובדת עם [מותג]". |
| **TASK-13** | `AnnualPlannerPage` (Upload) | `14:15 - 14:53` | 20 min | Shrink giant upload area into compact row: `[הורדת Template]` + `[העלה קובץ תכנון שנתי]` + subtext "אם יש לך תוכן מוכן, העלה כאן" + small single-line textarea. |
| **TASK-14** | `AnnualPlannerPage` | `14:53 - 15:10` | 0 min | Compact single-row radio for plan basis: `גם רעיונות שלי` vs `רק חגים ומועדים`. |
| **TASK-15** | `AnnualPlannerPage` | `15:13 - 16:54` | 60 min | **New Feature**: Real-time reactive post counter displaying exact total posts `(weeks * postsPerWeek)` updating dynamically. |
| **TASK-16** | `AnnualPlannerPage` | `16:55 - 17:18` | 20 min | Modular numbered 1-2-3 step layout (1. Basis, 2. Range, 3. Frequency) leading directly to the generate button. |
| **TASK-17** | `AnnualPlannerPage` (Review) | `17:56 - 18:35` | 120 min (2h) | **New Feature**: Dedicated Full-Screen modal/page for `עיון ואישור תכנים` presenting a clean chronological feed. |
| **TASK-18** | `AnnualPlannerPage` (Card) | `18:35 - 19:10` | 30 min | Post card layout: preview thumbnail, status badge (`לתזמון / מיידי` vs `טיוטה`), display existing auto-generated hashtags, quick schedule button. |
| **TASK-19** | `AnnualPlannerPage` (API) | `19:11 - 19:47` | 60 min | **Critical Bug Fix**: Fix silent failure on `יצירת תוכנית אוטומטית` (add loading state, fix Edge Function/API payload & validation). |

---

## 5. Implementation Guide & Execution Steps

### Step 1: Production & Archive Polish (TASK-01 to TASK-07)
1. In `ProductionPage.tsx`:
   - Reorganize `PRODUCT_TYPES` into horizontal compact pills/buttons with `flex-row` and icon beside label.
   - Filter out items where `id === 'presentation' || id === 'pdf'`.
   - Remove subtitle paragraphs.
   - Add subtle emerald/teal border highlight to main prompt textarea.
2. In `FilesPage.tsx` / Outputs:
   - Remove "תזמן לפייסבוק" and inline edit tools from output cards.
   - Keep only Preview modal and Download action.
3. In `BrandingPage.tsx`:
   - Provide direct navigation links to brand details instead of enforcing step-by-step wizard.
   - Elevate brand documents dropzone to top.

### Step 2: Output Panel, Carousel & Scheduling (TASK-08 to TASK-11)
1. In `ProductionPage.tsx` (Left Sidebar after creation):
   - Move action buttons section to the top.
   - Title: `עריכת פוסט`.
   - Add tab control: `[ שנה טקסט ]` \| `[ שנה תמונה ]`.
   - In Text tab: Label `ניתן לשנות ידנית` + short prompt input + button `שנה עם AI`.
   - In Image tab: Add multi-image slide array state for Carousel (`הוסף שקופית` / `העלה תמונה קיימת`).
   - Move Share and Email buttons to the bottom.
2. In `SocialScheduleSection.tsx`:
   - Remove AI rewrite block.
   - Pre-populate default post title automatically.

### Step 3: Annual Content Planner Form & Calculation (TASK-12 to TASK-16)
1. In `AnnualPlannerPage.tsx`:
   - Update header H1 to `תכנון תוכן שנתי` and subtitle to `תכנן עם AI תוכן לכל השנה לפי חגים, מועדים ואירועים`.
   - Remove brand status banner ("את עובדת עם [מותג]").
   - Replace large dropzone and textarea with a compact row: `[הורדת Template]`, `[העלה קובץ תכנון שנתי]`, subtext, and a compact single-line input.
   - Make basis option a clean single-row radio.
   - Implement live reactive counter `useMemo(() => calculateTotalPosts(monthsRange, frequency), [monthsRange, frequency])` and display in a prominent counter card.
   - Wrap sections into numbered blocks: 1. Basis, 2. Range, 3. Frequency.

### Step 4: Full-Screen Content Review, Card UI & Bug Fix (TASK-17 to TASK-19)
1. In `AnnualPlannerPage.tsx`:
   - Create full-screen modal/view triggered by button `עיון ואישור תכנים`.
   - In post card: Display thumbnail, title, text, existing hashtags, status badge (`לתזמון` / `טיוטה`), and direct schedule button.
2. Bug Fix (`TASK-19`):
   - Check `generate-annual-plan` API / Edge Function call.
   - Inspect request payload, brand ID, prompt parameters, and error handlers.
   - Add clear loading spinner / progress feedback during generation.
   - Ensure created posts are correctly saved to database and state.

---

## 6. Verification Checklist
- [ ] TypeScript check: `npx tsc --noEmit` passes without errors.
- [ ] Build check: `npm run build` completes successfully.
- [ ] Visual verification of `ProductionPage`, `FilesPage`, and `AnnualPlannerPage` in the browser.
- [ ] All commits made directly to `main` with clean commit messages (no AI attribution).
