# FreeHS — UXW-1, the first-run walkthrough

**Pass:** UXW-1 (playbook: `docs/ux-walkthrough-playbook.md`, Appendix A)
**Persona:** P5 — owner of a 12-person roofing contractor; client now requires
RAMS packs and proof of a live H&S system; never used safety software;
desktop 1440×900
**World:** W1 — real sign-up into an empty tenant (no sandbox)
**Date:** 21 August 2026
**Instrument:** `tools/ux-explorer` against a local production build
(`BRAND=freehs`), CI-recipe env
**Result:** the full day-script completed — sign-up → orientation → two
sites → two invites → RA-0001 published (Active v1, assessor-signed) →
"Weekly site walk — roofing" template published → Hazard QR created with a
resolving `/scan` link. **18 findings: 4×S2, 8×S3, 6×S4, 0×S1.**

The one-sentence verdict: **every register can be worked, and the corridors
between them are where the product loses people** — the first ten minutes
have no path, the doors between modules don't route, and two S2s put wrong
defaults or silent drops directly on the workflows a new firm touches first.

---

## Findings

| ID | Shape | Sev | Where | Finding |
| --- | --- | --- | --- | --- |
| UXW1-03 | E-flow | **S2** | `/[locale]/ai` (post-signup landing) | A brand-new workspace lands its owner in the AI chat, whose suggestion chips all assume lived-in data ("How many inspections do we have?" → zero). Marketing promises "Make it yours: add your sites, invite your team, shape the registers"; the app contains no counterpart — no checklist, no welcome, no pointer. The persona's twenty minutes started draining here. |
| UXW1-05 | E-words | **S2** | `/[locale]/ai` | When the assistant call fails, the chat renders the RAW provider error — `Error: 401 {"type":"error"…"invalid x-api-key"…request_id…}` — with a Copy button. The template AI chat fails correctly ("Something went wrong generating the template. Please try again."), so the right pattern already exists one screen away. BUG-17's class; `inline-error-render.test.ts` does not cover this page. *(Harness provoked the 401 with a fake key; the rendering is the defect — any provider outage shows this to every user.)* |
| UXW1-10 | E-act | **S2** | Settings → Users → Invite | **Permission set defaults to Administrator.** The path of least resistance grants `org.settings` to every invitee; a safety product whose own S-E02 guard treats admin count as precious hands admin out as the default. Expected: Standard default, or a forced choice. |
| UXW1-13 | E-act | **S2** | New risk assessment dialog | Site/project chosen in the picker, then "Create assessment" clicked (without the picker's "Done") → the record is created with **No site**; the explicit choice is silently dropped. Verified on the RA page that row-click + Done does select — the dialog's Create simply fires with uncommitted picker state, and the popover visually overlaps the Create button, inviting exactly this sequence. |
| UXW1-01 | E-words | S3 | `/` hero | Subline claims "Passwordless sign-in"; the sign-up form asks to "Choose a password" (ADR 0019). Stale claim, first-contact trust ding. |
| UXW1-02 | E-act | S3 | `/[locale]/sign-up` | "Already have an account? **Sign in**" links to `/en` (marketing home), not `/en/sign-in`. The nav's Sign in is correct; the under-form link forces a wrong click on every returning user. |
| UXW1-06 | E-flow | S3 | `/[locale]/my-work` | Empty state ("Nothing waiting on you — new work assigned to you appears here") speaks to the steady-state employee; the day-zero admin gets no "set the place up" variant. Compounds UXW1-03: no surface in the product answers "where do I start". |
| UXW1-09 | E-words | S3 | Settings → Users → Invite | Phone country code defaults to **+1 (US/CA)** with placeholder "555 000 0000" — on a product whose hero says "Built for UK practice". Same class as the `en`→`en-US` date lesson. |
| UXW1-11 | E-words | S3 | Settings → Users → Invite | The one security-relevant choice (Administrator / Manager / Standard) is a bare-label dropdown; nothing at the decision point says what each grants. The persona could not predict the consequence of the choice. |
| UXW1-12 | E-flow | S3 | Settings → Users → Invitations | Pending invitations offer Resend and Cancel only — **no copy-invite-link**. When the email lands in spam (small-firm reality), the admin's only tool re-sends into the same black hole; a link to WhatsApp-forward is the affordance the situation calls for. |
| UXW1-14 | E-words | S3 | RA editor | The editor autosaves — silently. No "Saving…/Saved" indicator exists anywhere on the page (verified: edits survive a hard reload). On the user's first legally significant document, "did it save?" is a real anxiety the page never answers. |
| UXW1-15 | E-words | S3 | RA editor, per hazard | Two parallel control surfaces: the structured controls list (hierarchy tier + status, pre-filled by the library) and the free-text "Existing controls" box. Nothing explains their relationship or which one downstream consumers (PDF, permits gate, RAMS binding) read; the persona duplicated content across both. |
| UXW1-16 | E-flow | S3 | `/[locale]/inspections` (zero templates) | "Start inspection" opens "Pick a template — No published templates are available yet" with a disabled Start and **no route to creating one**; the register's empty state names the concept ("from a published template") but links nothing. The path exists only via the sub-nav, unnamed. |
| UXW1-04 | E-words | S4 | `/[locale]/ai` | Subtitle: "…your inspections, **issues**, actions, assets, or documents" — "issues" is the router's internal name; the product word is Observations. The list also omits the FreeHS core (permits, incidents, RAMS…). |
| UXW1-07 | E-words | S4 | nav / `/[locale]/my-work` | Nav says "For me"; the page it opens is titled "My work". |
| UXW1-08 | E-words | S4 | Settings → Users; template Visibility step | "…manage the people in your **tenant**"; "Every user in your **tenant** can start…" — internal vocabulary in user copy (grep-able class). |
| UXW1-17 | E-words | S4 | Template editor | The "Publish" button does not publish — it enters a 3-step wizard (Build → Settings → Visibility) whose final step has the real Publish. Status stays "Draft", producing a did-it-work double-take (the walkthrough itself mis-read it first). Mitigated by the visible stepper. |
| UXW1-18 | E-words | S4 | Settings → Users | Self-deactivate on the sole admin is correctly refused, but the toast advises "Ask another administrator" — there isn't one, by definition of the case that triggered it. |

Proposed dispositions are deliberately absent from the table: every S2 needs
an owner decision (UXW1-03's shape especially — checklist vs. guided landing
vs. seeded first records is a product call). The obvious `fix` candidates
(02, 05, 08, 09, 18) are one-liners-to-small; 13 wants the picker to commit
on outside-click/Create rather than requiring Done; 05 should ride
`serverErrorMessage` and extend the `inline-error-render` guard's file list.

## What held up

Recorded so the fix pass doesn't churn what works, and because half of
first-run quality is already there:

- **Sign-up**: honest form, instant entry, no verification friction; the
  account button carries the real name immediately.
- **Sites & Projects**: the Site/Project split with plain-English
  descriptions fits a trade firm; created rows appear instantly (the
  MutationCache doctrine holding); site checkboxes appear right in the
  invite form.
- **Invitations tab**: invited-by attribution, 7-day expiry in house date
  format, Resend/Cancel.
- **The RA editor is the best screen in the first-run** — library hazards
  arrive with harm text, harmed-groups and initial rating pre-filled; the
  matrices enforce ADR 0011 governance *visibly* (residual cells above
  initial disabled with "controls cannot increase risk"); publish is gated
  on a real assessor attestation in MHSWR language ("suitable and
  sufficient"); a change log runs from minute one; autosave survives a hard
  reload.
- **Template creation chooser** (AI / scratch / import a PDF or Excel) is
  the right menu for this persona, and the template AI chat's failure
  message is the model the `/ai` page should copy. Settings defaults
  (`{date}`, `{counter:6}`) meant nothing to configure.
- **QR flow**: per-category codes, Copy link + Download PNG, and the
  encoded URL is the correct `/scan/<token>` — the observations audit's
  OB-Q07 is confirmed fixed from the user's seat; the link answers 200
  anonymously. `Good practice` appears among the seeded categories.
- **Guards fire with human messages** (last-admin: "Cannot deactivate
  yourself…"), and the empty inspections table, RA register and QR page all
  have written empty states.

## Harness notes (for triage, not findings)

- `ANTHROPIC_API_KEY` and Resend keys are fakes in this environment: AI
  *content* and email *delivery* were untestable; UXW1-05 documents the
  failure rendering only, and UXW1-12's severity partly derives from
  undeliverable mail being a real-world state.
- The browser ran with an `en-US` locale, so native date inputs showed
  `mm/dd/yyyy` placeholders (RA review schedule). Not logged as a finding —
  re-check on an `en-GB` browser; the explorer should grow a `locale`
  option pinned to the persona.
- Driver lessons applied mid-pass (committed): profile resume restores the
  last URL; dialog and wizard flows must run within a single invocation
  (client-only state does not survive the resume reload — one apparent
  "Templates link doesn't work" was this, retried clean, not logged).

## Route ledger (W1, this pass)

`/[locale]` (marketing, signed out) · `/[locale]/sign-up` · `/[locale]/ai` ·
`/[locale]/my-work` · `/[locale]/sites` · `/[locale]/settings/users` ·
`/[locale]/risk-assessments` · `/[locale]/risk-assessments/[assessmentId]` ·
`/[locale]/inspections` · `/[locale]/templates` ·
`/[locale]/templates/[templateId]` · `/[locale]/observations` ·
`/[locale]/observations/qr-codes` · `/scan/[token]` (anonymous, 200)

Controls deliberately not exercised: marketing nav (Modules/Docs/Pricing),
the sandbox CTAs (W1 forbids them), Export CSV buttons, the RA
print/download icons and Distribution & acknowledgement tab, template
Import-a-PDF, per-user detail pages. They are noted here so UXW-5/SWP passes
pick them up rather than assuming coverage.
