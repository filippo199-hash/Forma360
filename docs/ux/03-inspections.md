# UX audit — Inspections

**Module:** Inspections (list, conduct, status/report, signatures, approvals)
**Investigated:** 2026-07-25 · live walkthrough on prod (Northwind tenant, Alice Admin — started + conducted a real "Clothing Shop – Morning Opening Walkthrough" inspection) + full code map
**Primary code:**
- List: `apps/web/app/[locale]/inspections/page.tsx`, `inspections/template-picker-dialog.tsx`
- Conduct: `apps/web/app/[locale]/inspections/[inspectionId]/page.tsx`, `src/components/inspections/conduct-shell.tsx`, `conduct-state.ts`, `response-input.tsx`, `evidence-uploader.tsx`, `signature-pad.tsx`
- Status/report: `.../[inspectionId]/status/page.tsx`, `.../report/page.tsx`
- Signatures: `.../[inspectionId]/signatures/[slotIndex]/page.tsx`
- Approvals: `apps/web/app/[locale]/approvals/page.tsx`, `.../[inspectionId]/page.tsx`, `src/components/inspections/inspection-review.tsx`
- Routers: `packages/api/src/routers/{inspections,signatures,approvals,inspectionsExport,exports}.ts`

---

## How it works today

- **List** — grouped-by-date table (checkbox / Inspection / Conducted by / Actions / Conducted / Completed / action link + ⋯). Search + "Add filter" (status / template / conductedBy / conducted-on range), "Show archived", "Export CSV", "Start inspection". In-progress rows show **Continue**, completed rows **View report**.
- **Start** — "Pick a template" dialog lists published templates (radio + Start).
- **Conduct** — a per-page wizard (tab strip across the top + Previous/Next). Answers **autosave** (debounced ~1.5 s, `Saved HH:MM:SS` in the header) with optimistic concurrency + a localStorage retry queue + `beforeunload` flush — genuinely robust. Flagged options show a red **!**; a flagged/evidence option reveals an inline **"Evidence required (0 of 1) · Attach file"** block; every question has a **Raise action** link. Required items gate submit.
- **Submit** → confirm dialog → routes to `/report` (if completed) or `/status` (if it needs signatures/approval).
- **Status** — per-state view (in-progress / awaiting signatures / awaiting approval / completed / rejected) with the inline report, PDF/DOCX links, and share links.
- **Signatures** — focused single-slot signer (canvas + name/role).
- **Approvals** — queue → detail with a read-only review + Approve/Reject (reject comment required).

**What's good:** autosave is robust (survives reload/offline); the conduct free-text answer path is **not** single-line-clipped — `TextInput` honours the template's `multiline` flag and renders a real `<Textarea>` (`response-input.tsx:256-304`); flag → evidence-required reveal works live; archive dialogs show a **dependents cascade preview**; the report is rich (flagged-at-top callout, files grid, signatures). The problems are around edges: conflict recovery, the submit gate, approver evidence, and small papercuts.

---

## Findings

### 1. [High] A save-conflict silently discards the inspector's unsaved answers
Autosave uses `expectedUpdatedAt` optimistic concurrency. On a `CONFLICT` (same inspection edited elsewhere / second tab), the recovery UI's **only** action is a button that calls `window.location.reload()` (`conduct-shell.tsx:433-443`), and `MARK_CONFLICT` halts autosave. A reload throws away everything typed since the last successful save — with no merge and no "copy your answers first" escape. On the mobile conduct device this is real, recoverable-looking work lost silently.
**Suggestion:** before reload, snapshot the in-memory responses (they're already mirrored to localStorage) and offer "Reload & keep my answers" that re-applies them onto the fresh version, or at minimum a "Copy my answers" affordance + a warning that reloading discards them.

### 2. [High] Nothing tells the inspector *which* required question is blocking submit
Submit is disabled until `missing.length===0 && evidenceMissing===0` (`conduct-shell.tsx:302`). When blocked, the only feedback is a **hover `title` tooltip** (invisible on touch — the primary device, `:400`) plus one count line (`:407-413`). The page tab-strip shows active/skipped state but **no per-page "incomplete required" indicator** (`:504-535`), and there's no "jump to first unanswered". On an 8-page template (verified live) the inspector has to hunt page-by-page. The hint is also exclusive — it shows *missing answers* first and only surfaces the *evidence* shortfall once every answer is filled (`:409-412`).
**Suggestion:** mark incomplete pages in the tab strip (dot/count badge), turn the blocked-submit hint into a clickable list that scrolls to each unanswered/evidence-missing question, and show answer- and evidence-shortfalls together.

### 3. [High] The "Pick a template" picker lists templates you cannot start
Confirmed live: as Alice Admin, all three published templates (T-B1-Regression, T-South, T-North) are offered in the dialog, but **each one errors on Start** with *"You do not satisfy this template's access rule."* The dialog lists every published template without checking the current user's access, so the user only discovers the dead end after selecting + clicking Start — and if every template is gated (as here) the picker is entirely non-functional with no explanation.
**Root cause:** `template-picker-dialog` lists published templates without running `resolveAccessRule(rule, userSnapshot)` per template.
**Suggestion:** filter the list to templates the user can actually start, or show gated ones disabled with a "you don't have access" note — don't surface a happy-path option that always fails.

### 4. [High] An approver can't see the photo evidence they're approving
In the approval **review** panel, media answers render as raw R2 storage keys — `<li className="truncate font-mono text-xs">{k}</li>` (`inspection-review.tsx:218-230`) — not thumbnails or links. So the approver deciding approve/reject sees strings like `tenant/…/173_photo.jpg` and **cannot open the evidence** (the report page *does* show thumbnails; the approval screen doesn't). site / asset / company / location / annotation answers likewise fall through to a generic `stubNotice` "coming soon" (`:257-263`), so the approver can't see the selected site/asset either.
**Suggestion:** reuse the report page's files-grid/thumbnail rendering in `InspectionReview`, and render site/asset/location values instead of the stub, so approvals are made on the actual content.

### 5. [Medium] Rejected inspections are a dead end
On the status page the rejected branch shows the reason and a **permanently disabled "Reopen" button** with a TODO (`status/page.tsx:261-264`); conduct is read-only for rejected. So a rejected inspection is stuck — the conductor can't act on the feedback and re-submit.
**Suggestion:** implement Reopen (return to `in_progress` for the conductor, preserving answers + the rejection note), or clearly state the intended path (start a new one) rather than a dead disabled control.

### 6. [Medium] Multi-photo / evidence upload is one-file-per-tap
Neither the media-answer input nor the evidence uploader sets `multiple`, and each `onChange` reads `files?.[0]` only (`response-input.tsx:573-579`, `evidence-uploader.tsx:52-58`); the input is also disabled while each single upload is in flight (`:602`, `:88`). A "photos of the defect (up to 10)" question is therefore ten separate tap→pick→wait cycles on the phone.
**Suggestion:** add `multiple` and iterate the `FileList`; keep the input enabled and queue uploads with per-file progress.

### 7. [Medium] Free-text "notes / comments" answers default to single-line
Confirmed live: the "Additional comments / handover notes" question renders as a single-line input — a long handover note scrolls so only its tail is visible (the same "can't see what I typed" problem we just fixed in Templates). The conduct renderer is actually *correct* (it honours `item.multiline`); the field is single-line because the **AI generator created this notes question with `multiline: false`**. A 2000-char counter on a single-line box is also noisy (`response-input.tsx:286`).
**Suggestion:** default free-text questions whose prompt reads like *notes / comments / description / details* to `multiline: true` in the AI generator (and the manual editor's "add text question" default); consider auto-growing single-line text answers too; show the char counter only near the limit.

### 8. [Medium] Raw user ULIDs are shown as "Approved by"
The completed status page (`status/page.tsx:235`), report meta (`report/page.tsx:198`), and report approvals list (`:552`) print the approver's 26-char `approverUserId` verbatim instead of their name.
**Suggestion:** resolve `approverUserId` → user's full name (the same lookup used elsewhere) at these three sites.

### 9. [Medium] The inspection list has no mobile layout
The list is an 8-column table in a single `overflow-x-auto` wrapper with fixed column widths (`page.tsx:480-499`) — phones get a horizontal-scroll table, no card layout — and the **CSV export button is hidden below `sm`** (`:323`). Conduct is mobile-first, but the list that leads into it isn't.
**Suggestion:** a stacked card layout under `md` (title + template + status + conducted-by + date), and move Export into the "⋯"/filter area on mobile rather than hiding it.

### 10. [Low] Out-of-range number answers still submit
Number inputs show an inline red min/max hint (`response-input.tsx:343-348`) but the submit gate checks **presence only** (`conduct-state.ts:256-276`), so a required number outside its range submits with just a (dismissable) hint.
**Suggestion:** include range validity in the submit gate for required numbers.

### 11. [Low] "Raise action" appears on instruction blocks and is easy to miss on questions
Live: the non-question **INSTRUCTION** block on page 2 shows a "Raise action" link — meaningless there. On real questions the link is a muted `text-xs` control top-right (`conduct-shell.tsx:939-945`) repeated on every question — simultaneously cluttered (one per row) and low-affordance.
**Suggestion:** hide "Raise action" on instruction items; give it a small icon+label so it reads as an action without adding text noise per row.

### 12. [Low] Untranslated / raw-enum strings across the module
Hardcoded English `title="Skipped by an answer above"` (`conduct-shell.tsx:520`); the approvals queue relative time `"5m ago" / "3h ago"` is a hardcoded English formatter (`approvals/page.tsx:11-20`); the linked-action label is `status.replace(/_/g,' ')` → lowercased "in progress" (`conduct-shell.tsx:697`); the approval "not awaiting" message interpolates the raw status enum (`approvals/[inspectionId]/page.tsx:197`); report signature `aria-label` is hardcoded English (`report/page.tsx:534`).
**Suggestion:** route these through `next-intl` (relative-time via `Intl.RelativeTimeFormat`, status via the existing `actionStatus.*` / status keys).

### 13. [Low] Touch-hostile hover-only control on the mobile surface
The media-answer remove button is `opacity-0 … group-hover:opacity-100` (`response-input.tsx:617`) — invisible without a mouse, on the primary conduct device.
**Suggestion:** always show it (or show on focus/tap) with a 44px hit area.

### 14. [Low] Assorted papercuts
- The row "⋯" menu offers **"View report" for an in-progress inspection** (no report exists yet) — verified live.
- Inspection titles default to just `{date}`, so the list shows non-distinctive rows (three identical "2026-07-24 / T-Open") — disambiguated only by the template subtitle. Consider a richer default title format (`{templateName} · {date}` or `{site}`).
- Share-link **Revoke has no confirmation** (`share-link-dialog.tsx:192`).
- The "Add filter" popover isn't Escape-/keyboard-closable (`page.tsx:201-209`); bare empty states have no CTA (`page.tsx:513`, `approvals/page.tsx:59`); the `awaiting_signature_workflow` status isn't selectable in the list filter (`page.tsx:60-75`).

---

## Summary

| # | Severity | Finding | Surface |
|---|---|---|---|
| 1 | High | Save-conflict recovery discards unsaved answers (reload-only) | Conduct |
| 2 | High | Can't locate the required question blocking submit | Conduct |
| 3 | High | Picker lists templates the user can't start (all error on Start) | Start |
| 4 | High | Approver can't see the photo evidence / site / asset being approved | Approvals |
| 5 | Medium | Rejected inspections are a dead end (disabled Reopen) | Status |
| 6 | Medium | Multi-photo / evidence upload is one-file-per-tap | Conduct |
| 7 | Medium | Notes/comments free-text defaults to single-line (long text clipped) | Conduct + AI gen |
| 8 | Medium | Raw user ULIDs shown as "Approved by" | Status/Report |
| 9 | Medium | Inspection list has no mobile layout; Export hidden on phones | List |
| 10 | Low | Out-of-range numbers still submit | Conduct |
| 11 | Low | "Raise action" on instructions; low-affordance on questions | Conduct |
| 12 | Low | Untranslated / raw-enum strings (skip reason, "5m ago", statuses) | Multiple |
| 13 | Low | Hover-only media remove on mobile | Conduct |
| 14 | Low | Papercuts (View-report on in-progress, {date}-only titles, revoke no-confirm, filter a11y) | Multiple |

**Recommended first pass:** #1–#4 — the conduct-flow integrity trio (don't lose work #1, help me submit #2, don't offer dead templates #3) plus the approval-blindness fix #4. #5–#9 are the next tier (dead-end rejects, mobile evidence capture, single-line notes, real names, mobile list). #10–#14 are polish.

_Reassurance on your recurring concern: the conduct **answer** typing path is already multi-line-safe (honours the template flag) — the one single-line "handover notes" clip I hit (#7) comes from the AI generator's default, not the conduct renderer. The autosave is robust; the risks are the conflict edge (#1) and the submit-gate hunt (#2)._
