# UX audit — Assets & Maintenance

**Module:** Assets & Maintenance (nav "Assets"). Routers `assets`, `assetTypes`, `maintenancePrograms`, `maintenance-actions`.
**Investigated:** 2026-07-25 · full code map.
**Surfaces:** `app/[locale]/assets/{page,new,[assetId],settings,settings/programs/[programId]}`, `src/components/assets/maintenance-programs-manager.tsx`, `src/components/contractors/contractor-assets.tsx`.

## Findings (ranked)
1. **[High] Program detail infinite-skeletons on error** — `assets/settings/programs/[programId]/page.tsx:38` never reads `error`; guard `:163` skeletons forever on a bad/forbidden program id.
2. **[High] 5000-char category description in a single-line `<Input>`** — `assets/settings/page.tsx:301-311` (edit) + `:524-533` (create); a long description clips. Should be a `<Textarea>`.
3. **[High] Destructive actions with no confirmation** — asset archive/restore (`[assetId]/page.tsx:286-289`), program **detach asset** (`programs/[programId]/page.tsx:389`) + **remove trigger** (`:267`), contractor↔asset **unlink** (`contractor-assets.tsx:97,239`). Inconsistent with the good confirm dialogs elsewhere (`[assetId]:936`).
4. **[Medium] Errors swallowed → misleading empty state** — queries never read `error`: `assets/page.tsx:45`, manager `:33`, categories `:405`, contractor sections, maintenance tab (`[assetId]:85`).
5. **[Medium] Raw enum statuses untranslated** on detail tables — `[assetId]/page.tsx:684,810,864,920` (`status.replace(/_/g,' ')`/`capitalize`) vs proper `tStatus` in the reused sheet.
6. **[Medium] Dates formatted with no locale** — `assets/page.tsx:144`; `[assetId]/page.tsx:528,689,813,867,923`.
7. **[Medium] Hardcoded English strings** — categories page (`settings/page.tsx:49-54,183,195,203,228,234,238,258,282-283,330`); new-asset required-field error (`new/page.tsx:117`).
8. **[Low] Raw ULID fragments** — parent link `.slice(-8)` (`[assetId]:411`), attached-asset id fallback (`programs:381`).
9. **[Low] Hover-only photo remove** — `[assetId]/page.tsx:749-757`.
10. **[Low] No mobile card layout** — all tables horizontal-scroll (`assets/page.tsx:231`, detail tabs, `settings/assets`).
11. **[Low] Truncation + a11y** — contractor-asset names/notes truncate (`contractor-assets.tsx:87-89`), collapsed category desc truncate+hidden, `tabIndex={-1}` on new-category link (`new/page.tsx:214`), Site column ignores terminology (`assets/page.tsx:238`), bare empty states with no CTA on detail Actions/Inspections/Observations tabs.

**Good:** the asset **detail** page reads `error` → DetailNotFound correctly; the reused maintenance-action sheet localises status + dates properly; program-detach + delete-program have confirm dialogs. Fixes bring the rest of the module up to that bar.

_Fixed via a Workflow fan-out (6 disjoint slices + adversarial verify). Heavy detail-table mobile-card layouts deferred (many small tables); the assets **list** gets mobile cards._
