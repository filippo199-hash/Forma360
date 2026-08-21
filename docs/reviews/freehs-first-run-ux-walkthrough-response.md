# UXW-1 first-run walkthrough — response & fix record

**Findings doc:** `freehs-first-run-ux-walkthrough.md` (18 findings)
**Adjudication:** product owner, 21 Aug 2026 — *fix all eighteen*
**Fix pass:** this branch. Every disposition below is `fix`; the notes
record the shape each fix took and where it lives, so nobody re-litigates
the choices.

| ID | Fix | Where |
| --- | --- | --- |
| UXW1-01 | Hero claim "Passwordless sign-in" replaced with "Set up in minutes" (true — UXW-1 measured it) on both brands' heroes. | `apps/web/src/content/site.ts` |
| UXW1-02 | Both "Sign in" links on the sign-up card now target `/sign-in` (the under-form link and the email-in-use inline link). | `sign-up-card.tsx` |
| UXW1-03 | Two-part fix. (a) Post-signup landing moved from `/ai` to `/my-work` (invite acceptance too). (b) New admin-only "Set up your workspace" checklist on My work — five steps (sites, team, first RA, inspection template, QR poster), each **derived from the real registers** via `onboarding.status`, never stamped, so it cannot disagree with the data (the sandbox seed-coherence lesson applied to real tenants). Dismissible (stamps `settings.onboardingDismissedAt`); hidden on unclaimed sandboxes — the sandbox is already the guided experience. | `packages/api/src/routers/onboarding.ts` (+`.test.ts`), `getting-started-card.tsx`, `my-work/page.tsx`, `sign-up-card.tsx`, `invite-accept-card.tsx` |
| UXW1-04 | Assistant subtitle now uses product vocabulary ("…inspections, observations, actions, assets, or documents") in all 10 locales. | `packages/i18n/messages/*` (`ai.emptySubtitle`) |
| UXW1-05 | The stream-`error` event now renders the translated `ai.streamError` copy (which already existed — the template chat's pattern) instead of `Error: ${event.message}` with the provider's status code and request id. Pinned by a new scraped check in `inline-error-render.test.ts` (raw `${event.message}` interpolation banned in `ai-chat.tsx`). | `ai-chat.tsx`, `inline-error-render.test.ts` |
| UXW1-06 | Covered by the UXW1-03 checklist — the day-zero admin now has a "set the place up" surface above the queue; the employee-facing empty state is unchanged (it was right for employees). | see UXW1-03 |
| UXW1-07 | Nav label unified with the page: `nav.forMe` now carries each locale's own `myWork.title` ("My work" in en), copied bundle-by-bundle so the two can never drift per-locale. | `packages/i18n/messages/*` |
| UXW1-08 | "tenant" removed from user-facing copy: users subtitle → "…people in your organisation"; template publish/visibility "Everyone" descriptions → "…in your organisation…", all locales. | `packages/i18n/messages/*` |
| UXW1-09 | Invite phone defaults to **+44 (UK)**, listed first; placeholder is the Ofcom-reserved `07700 900000`. | `settings/users/page.tsx`, bundles |
| UXW1-10 | Invite permission set defaults to the seeded **Standard** set (falls back to the first set only if no set named Standard exists). Least privilege is now the path of least resistance. | `settings/users/page.tsx` |
| UXW1-11 | The seeded sets already carry descriptions in the database ("Full control: users, groups, sites, billing…" etc.) — the invite form now shows the selected set's description under the dropdown, so the choice explains itself; custom sets show theirs too. | `settings/users/page.tsx` |
| UXW1-12 | New `users.getInviteLink` (same `users.invite` permission; refuses expired/accepted/foreign rows — router tests added) + a **Copy link** button on each pending invitation. Discloses only what the invite email already carries. | `packages/api/src/routers/users.ts` (+`.test.ts`), `settings/users/page.tsx` |
| UXW1-13 | `SiteSelector` semantics fixed at the component, so every caller inherits it: **single-select commits on row-click and closes** (picking IS the decision); multi-select commits the draft on *any* close (outside click, Escape) instead of discarding it — Done just closes. Draft mirrored in a ref so the close-path commit can never read a stale closure (BUG-12 class). | `site-selector.tsx` |
| UXW1-14 | `RaSaveStatus` beside the RA status chips: "Saving…" while any riskAssessments mutation is in flight (via `useIsMutating`, so every autosave call site is covered), "All changes saved" once settled. | `risk-assessments/[assessmentId]/page.tsx`, bundles |
| UXW1-15 | The two control surfaces now explain their relationship at the point of use: a hint under "Existing controls" ("A written summary… prints on the assessment alongside the itemised controls below") and the itemised-controls hint extended to point back. Verified against the print layout first — `ra-print-layout.tsx` genuinely renders both. | `hazard-card.tsx`, bundles |
| UXW1-16 | Both dead ends routed: the "Pick a template" dialog's zero-state offers **Create a template** to `templates.manage` holders and "Ask an administrator to publish a template first." to everyone else; the inspections register's empty state gained a **Go to templates** link (table and mobile-card views). | `template-picker-dialog.tsx`, `inspections/page.tsx`, bundles |
| UXW1-17 | The Build-step header button is now **"Review & publish"** in all locales — a label that promises the wizard it opens. The step-3 button keeps "Publish template". | bundles (`templates.editor.publishButton`) |
| UXW1-18 | The self-deactivation guard now checks whether the caller is the last admin (via `wouldDropBelowMinAdmins`) and says so: "You can't deactivate your own account while you're the only administrator." — the ask-a-peer advice only appears when a peer exists. Both branches router-tested. | `packages/api/src/routers/users.ts` (+`.test.ts`) |

## Drive-by (not in the findings table)

- `settings/users/page.tsx` `exportCsv` hand-rolled the revoke-after-click
  blob download — the exact BUG-21 class the fix pass banned — and now goes
  through `downloadCsvFile`.

## Verification

- `pnpm typecheck` and `pnpm lint` green across all 10 packages; full
  `pnpm test` run on this branch (includes the new `onboarding.test.ts`,
  the `getInviteLink` / deactivation-message cases, the extended
  inline-error guard, and K01 over the new keys in all 10 bundles).
- Explorer re-verification (UXW-1's own instrument, fresh tenant, world
  W1): sign-up lands on My work with the checklist; checklist steps tick
  from real data; sign-in links resolve; invite defaults show Standard/+44
  with the description line; Copy link present; RA dialog site choice
  survives an immediate Create; save status appears; picker/register dead
  ends route to templates.
