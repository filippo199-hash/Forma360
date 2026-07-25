# UX audit — Actions

**Module:** Actions (corrective/preventive task tracker; nav "Actions"). Router `packages/api/src/routers/actions.ts`.
**Investigated:** 2026-07-25 · code map (list/board, new form, detail page + kanban slide-over panel, action-types settings, saved views) + prior live use during Inspections/Observations.
**Status:** ✅ High + key Medium fixed & deployed (main-loop, subagents were rate-limited): #1 panel error branch, #2 list error banner, #3 activity ULIDs→names (panel + page), #4 kanban mobile column height, #5 archive confirms (action + type, with in-use warning), #6 dates→app-locale (activity/comments/due), #7 On/Off + remove-filter i18n. **Deferred** (see below).
**Surfaces:** `app/[locale]/actions/{page,new,[actionId],settings,categories/[typeId]}`, `src/components/actions/{action-detail-panel,asset-field}.tsx`.

## Findings

**High**
1. **Kanban detail panel infinite-skeletons on error** — `action-detail-panel.tsx:78` destructures only `{data,isLoading}`, never `error`; a failed/deleted-card fetch spins forever (the full page handles it via `DetailNotFound`). `:124-132`.
2. **List treats fetch errors as "no actions"** — `page.tsx:416` never reads `error`; a failed `actions.list` renders the empty state, hiding an outage as a false-empty.
3. **Activity feed prints raw ULIDs** for assignee/site changes — router stores the id (`actions.ts:1053,1063`); UI shows `String(payload.to)` (`[actionId]/page.tsx:777-782`, panel `:766-770`). Every reassignment reads as a 26-char id.

**Medium**
4. **Kanban board is unusable on mobile** — 4 fixed `h-[calc(100vh-15rem)]` columns stacked `grid-cols-1` (`page.tsx:1158,1203`) → ~4-viewport-tall page; the list table has no mobile card fallback (`:991`).
5. **Archiving a type or a (recurring) action has no confirm / dependents warning** — type archive despite showing `activeActions` (`settings/page.tsx:214-224`); action archive with no confirm though it may have recurrence children (`[actionId]/page.tsx:302-315`).
6. **Dates ignore the app locale** — `toLocale*()` with no locale arg across list/board/detail/activity/comments (`page.tsx:1109,1387`; `[actionId]/page.tsx:490,894`; panel `:733,807`).
7. **Recurrence freq i18n key mismatch** — full page uses `t('freq.DAILY')` (upper), panel uses `t('freq.'+f.toLowerCase())` (lower) → one surface renders a missing key. Plus hardcoded `'On'/'Off'` filter chips (`page.tsx:899`).

**Low**
8. **Raw ULID tail shown as a reference** when `referenceNumber` is null — `id.slice(-6)` in list/board/detail (`page.tsx:1045,1352`; `[actionId]/page.tsx:141`).
9. **List rows are mouse-only** — `<tr onClick>` with no keyboard/role (`page.tsx:1034-1037`).
10. **Board has no empty-state CTA** (four empty columns, no "create first action") + several bare-line empties (`page.tsx:1217`, `settings/page.tsx:153`).

## Deferred (flagged, not fixed in this pass)
- **Heavier UI restructures (bounded because subagents were rate-limited and this ran in the main loop):** the list-view mobile **card layout** (still an `overflow-x-auto` table), the board **empty-state CTA**, list-row **keyboard a11y** (`<tr onClick>`), the raw **ULID-tail reference** fallback, the type-catalogue **empty-state CTA**, and the recurrence **end-date** locale. All low/medium polish; safe to pick up in a follow-up (ideal for the workflow fan-out once the limit resets).

## Larger items (flagged, out of a UX-polish pass)
- **No attachments/photo evidence anywhere in Actions** — absent from the schema (`packages/db/src/schema/actions.ts`). This is a **feature** (needs a migration + R2 upload + render), not a UX polish; deferring to keep the autonomous pass low-risk. Strong candidate for a dedicated follow-up.
- **Non-optimistic inline edits lag** (`actions.update` round-trips before UI updates) — attempted best-effort during the fix pass; skipped where a safe optimistic+rollback wasn't clean.
- **Duplicate/stale routes** — `/actions/settings` vs `/actions/categories` embed near-identical category tables; `settings/actions/[typeId]` is a stale copy missing the Labels card. Code-cleanliness, not UX; deferring the route consolidation.

_This module is solid where it counts (board drag is optimistic; asset field shows names; detail full-page reads `error` correctly). The fixes target the two silent-failure branches, the raw-ULID activity, mobile board, missing confirms, and date/i18n consistency._
