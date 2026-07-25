# UX audit — Observations

**Module:** Observations (nav "Observations"; **backend is `issues.*`** — router `packages/api/src/routers/issues.ts`, schema `packages/db/src/schema/issues.ts`, URL segment `[observationId]`, route args `issueId`)
**Investigated:** 2026-07-25 · live walkthrough on prod (Northwind tenant, Alice Admin — reported + inspected a real observation OBS-000005) + full code map
**Primary code:**
- List (+ detail Sheet): `apps/web/app/[locale]/observations/page.tsx`, `src/components/observations/observation-detail-panel.tsx`
- Report form: `apps/web/app/[locale]/observations/new/page.tsx`
- Detail page: `apps/web/app/[locale]/observations/[observationId]/page.tsx`
- Categories: `apps/web/app/[locale]/observations/categories/**` + `src/components/observations/custom-questions-editor.tsx`
- QR codes: `apps/web/app/[locale]/observations/qr-codes/**` + `src/components/observations/{create-qr-code-sheet,show-qr-code-dialog}.tsx`
- Public report: `apps/web/app/scan/[token]/page.tsx`

---

## How it works today

- **List** — a table (Reference / Title / Category / Site / Status / Created) with native-`<select>` filters (Status, Category, Site/Project) + "Show archived", "Manage categories", and "Report observation".
- **Report form** (`/observations/new`) — progressive: pick a **category** → reveals Title, Description (textarea), Site/Project (the terminology-aware selector), media, Location, Assets, and any category **custom questions**. Category can add custom questions (like action types).
- **Detail** — rich: big title + **status workflow** (Open → Investigation → Closed) dropdown, Assignee, Priority, Due date, Date occurred; tabs **Overview / Activity / Files / Inspections / Actions**; **+ Add** → *Add inspection* / *Add action*; Share (copy link); Files drag-drop. The same detail also opens as a right-hand **Sheet** from the list row.
- **Categories** — CRUD + per-category custom questions, notification rules, recipients, visibility rule.
- **QR codes** — generate revocable QR tokens; the public `/scan/[token]` page lets anyone report an observation.

**What's good:** the report form is category-driven with a real **`<textarea>` description**, **multi-file** media, and the **terminology-aware Site/Project selector**; the detail page is genuinely rich (status workflow, assignee, priority, files, cross-links); category settings has the module's best **inline validation**; and the public QR-scan report has the best-handled state machine (loading / invalid-token / inline submit-error / success-with-reference / "report another"). The issues below are mostly edges: a missing comment thread, a couple of silent failures, confirmation gaps, and i18n leaks in the activity log.

---

## Findings

### 1. [High] You cannot comment on an observation
The Activity tab renders `commented` events **read-only** and there is **no composer anywhere** to add one — verified live (Activity is a history feed; **+ Add** offers only *Add inspection* / *Add action*). Yet the backend mutation **`issues.comments.create` already exists** (`issues.ts:1315`) and sibling modules use it (`actions/action-detail-panel.tsx:823`, `heads-up/[headsUpId]/page.tsx:84`). So the capability is built but unreachable in Observations (`observation-detail-panel.tsx:623-672`, `[observationId]/page.tsx:824-873`).
**Suggestion:** add a comment composer to the Activity tab (reuse the Actions/Heads-Up pattern + `issues.comments.create`). This is the biggest gap for "track and resolve" — there's currently no way to record discussion or progress notes on an issue.

### 2. [High] New-observation attachments can be silently lost
On the report form, after the observation is created the attachments are attached in a post-create loop whose failure is **swallowed** (`catch {}` — "leave the blob orphaned", `new/page.tsx:210-214`) while the **success toast still fires** (`:214`). A user who attaches photos of a hazard can get "Observation reported" while the photos silently never attached.
**Suggestion:** surface attach failures (error toast + offer retry / keep the user on the form), and don't report unqualified success when any attachment failed.

### 3. [High] The list's detail **Sheet** shows an infinite skeleton on load error
`observation-detail-panel.tsx` calls `get.useQuery(...)` but **never destructures `error`** (`:96`); the guard is `if (isLoading || data === undefined) → <Skeleton/>` (`:150-158`). On a query error, `isLoading` becomes false but `data` stays `undefined`, so the panel skeletons **forever** (the same class of bug as the inspection B14 infinite-skeleton we fixed). The full detail page handles this correctly (`[observationId]/page.tsx:157-170`); the Sheet does not.
**Suggestion:** read `error` and render an error/not-found state (reuse `DetailNotFound`) with a retry.

### 4. [Medium] Archive is destructive but has **zero** confirmation
Both detail surfaces archive an observation **immediately** from the menu with no confirm and no dependents preview — the Sheet's icon button (`observation-detail-panel.tsx:266`) and the page "…" menu (`[observationId]/page.tsx:303-309`, then redirect to the list). This is inconsistent with category-delete and QR-revoke, which both confirm — and an observation can have linked actions/inspections that vanish from view with one stray click. (Verified live: archiving OBS-000005 fired instantly, no dialog.)
**Suggestion:** add a confirm dialog (ideally with the `admin.previewDependents` cascade preview the rest of the app uses).

### 5. [Medium] Category **Delete** fires with no confirm and no dependents preview
`categories/page.tsx:186-189` calls `remove.mutate` immediately. Deleting a category that still has observations attached is a heavy action with no guardrail.
**Suggestion:** confirm + show how many observations use the category before deleting.

### 6. [Medium] The Activity log leaks raw English enum values and placeholders
`describeActivity` for `status_changed` injects the **raw** `from`/`to` enum (`[observationId]/page.tsx:887-891`) — e.g. "open → closed" unlocalised (in Italian: "da open a closed"); `assignee_changed` injects the raw payload (`:898-902`); the actor falls back to a hardcoded `'System'` (`:846`, `observation-detail-panel.tsx:645`); there's a literal `<span>Observation</span>` source badge (`observation-detail-panel.tsx:891`); and activity dates use `toLocaleString()` with **no locale arg** (`:949`, `:1149`, `:1481`) so they follow the browser, not the app locale.
**Suggestion:** map statuses through the existing status i18n, localise the actor/badge, and pass the app locale to date formatting.

### 7. [Medium] Relative timestamps are hardcoded English
The list "Created" column and the QR page use a hand-rolled `formatRelative` returning `"3h ago" / "5m ago"` (`page.tsx:349-359`, `qr-codes/page.tsx:349-359`) — not locale-aware (verified live: "3h ago"). Same issue we just fixed in Approvals.
**Suggestion:** `Intl.RelativeTimeFormat(locale, { numeric: 'auto' })`.

### 8. [Medium] No mobile card layout — every table is a horizontal-scroll table
The observations list (`page.tsx:199`), categories (`categories/page.tsx:109`), QR codes (`qr-codes/page.tsx:155`), and the detail Linked-Actions tab (`[observationId]/page.tsx:1441`) are all `<table>` in `overflow-x-auto` with no stacked card view (DOM-confirmed: the list table is shown on mobile, no card container). Observations are often reported/triaged on a phone.
**Suggestion:** add a stacked card layout under `md` for the list (mirror the inspections-list card layout we just shipped); at least the primary observations list.

### 9. [Low] Hover-only attachment remove on the report form
The media thumbnail remove button is `opacity-0 … group-hover:opacity-100` (`new/page.tsx:347`) — invisible/unusable on touch (the reporting device). Same class as the inspection media-remove we just fixed.
**Suggestion:** always show it with a 44px hit area.

### 10. [Low] List rows have two conflicting click targets
The whole `<tr>` `onClick` opens the **Sheet** (`page.tsx:237`), but the reference and title are `<Link>`s (with `stopPropagation`) to the **full page** (`:240`, `:249`) — same row, two destinations, no visual cue which is which.
**Suggestion:** pick one primary target (row → full page is most predictable), or make the title visibly a link and the row not clickable.

### 11. [Low] Terminology + placeholder gaps in list/QR columns
The list filters respect the tenant Sites/Projects terminology (`usePlaceTerms`), but the **table column header** is a hardcoded `t('columns.site')` = "Site" (`page.tsx:206`). On the QR page the **Site column is always `—`** (never populated, `qr-codes/page.tsx:188`) and the Category is shown **twice** (name button + chip, `:182`,`:191`).
**Suggestion:** apply terminology to the column header; drop the dead QR Site column and the duplicate Category chip.

### 12. [Low] Category-settings recipient summaries hardcode English pluralization
Recipient summaries build `` `${n} group${n!==1?'s':''}` ``, `site`, `user` in English (`categories/[categoryId]/page.tsx:486-500,638-652`), and the auto visibility-rule name is a hardcoded `` `Category: ${name}` `` (`:1038`) that's user-visible.
**Suggestion:** ICU plurals via `t(...)`; localise the rule name (or mark it system-generated).

### 13. [Low] Report-form + copy papercuts
- **Serial uploads:** the media input is `multiple`, but files upload **one at a time** in an awaited loop (`new/page.tsx:155-159`) — slow for many photos.
- **Unmarked required Title:** Title has no `*` and Submit sits disabled with no hint why (verified live) (`new/page.tsx:269`).
- **Description counter** shows "0/30000" even when empty (noise; the cap is huge).
- **False-success copy:** the QR "copy link" shows a success toast even in the clipboard-failure `catch` path (`show-qr-code-dialog.tsx:85`; same on the observation Share copy).

---

## Summary

| # | Severity | Finding |
|---|---|---|
| 1 | High | No way to comment on an observation (backend exists, UI doesn't wire it) |
| 2 | High | New-observation attachments can be silently lost (swallowed error + success toast) |
| 3 | High | Detail **Sheet** infinite-skeletons on load error (no `error` branch) |
| 4 | Medium | Archive is destructive with zero confirmation / no dependents preview |
| 5 | Medium | Category Delete: no confirm, no dependents preview |
| 6 | Medium | Activity log leaks raw enum values + hardcoded 'System'/'Observation'/locale-less dates |
| 7 | Medium | Relative timestamps hardcoded English ("3h ago") |
| 8 | Medium | No mobile card layout — all tables horizontal-scroll |
| 9 | Low | Hover-only attachment remove (touch-hostile) |
| 10 | Low | List rows have two conflicting click targets, no cue |
| 11 | Low | "Site" column header ignores terminology; QR Site column always "—" + Category shown twice |
| 12 | Low | Category-settings recipient summaries hardcode English pluralization |
| 13 | Low | Papercuts: serial uploads, unmarked required Title, always-on counter, false-success copy toast |

**Recommended first pass:** #1 (comments — the real functional gap), #2 + #3 (the two silent-failure/data-integrity bugs), and #4/#5 (add the missing confirmations). #6–#8 are the next tier (activity-log i18n, relative time, mobile cards). #9–#13 are polish, several of which are the same one-line fixes we just made in Inspections (hover-remove, relative-time, terminology).

_The module is well-built where it counts (rich detail, category-driven form, terminology-aware selector, strong public-scan flow) — the gaps are a missing comment thread, two swallowed failures, and confirmation/i18n consistency with the rest of the app._
