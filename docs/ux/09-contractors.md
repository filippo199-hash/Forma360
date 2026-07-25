# UX audit — Contractors

**Module:** Contractors (directory, compliance docs, visits + calendar, gate config + public kiosk, contractor↔asset links, portal users). Router `contractors.ts`.
**Investigated:** 2026-07-25 · full code map.
**Surfaces:** `app/[locale]/contractors/{page,[contractorId],calendar,gate}`, `app/[locale]/gate/[token]`, `src/components/contractors/{contractor-visits,contractor-users,contractor-assets}.tsx`.

## Fixed (Workflow fan-out, 6 slices + adversarial verify)
- **Visits:** the **visit-detail dialog no longer blanks on load error** (now shows loading + an inline error); the visits section gets loading/error states; the check-in override reason is multi-line; visit titles get tooltips; the Site field respects tenant terminology; cancel/no-show confirm.
- **Calendar:** a **mobile agenda list** (the fixed 7-column grid was unusable on phones); the per-day "add visit" button is always visible (was hover-only); load-error + loading states.
- **Portal users:** **cancel-invite confirms** (was one-click revoke); loading/error states; name/email tooltips; remove/cancel disabled while pending.
- **Directory:** list load-error state (was a false-empty); mobile card layout; on-site-board name tooltips; empty-state "New contractor" CTA.
- **Contractor detail:** compliance-override reason multi-line; requirement **reject reason** moved off `window.prompt` into a styled textarea flow; doc-filename tooltip; verify/reject disabled while pending.
- **Gate config:** config/fields load-error states (were masked as "no link / no fields"); remove-field confirm + pending state.

**Good (left as-is):** the contractor **detail page** already reads `error` → DetailNotFound; the public **kiosk** handles error + has large touch targets; the **contractor-assets** component was already brought up to standard in the Assets pass (error/loading, tooltips, unlink confirm).

## Deferred (flagged)
- Non-optimistic edits across the module (verify/reject/toggle/link all round-trip + full invalidate → visible lag). Same class deferred elsewhere.
- Calendar "+N more" day overflow isn't expandable (no day-detail view).
- Several bare empty states (visits/requirements) still lack CTAs (directory one added).
