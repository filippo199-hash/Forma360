# Permit to Work — HSE expert review: disposition

Response to `permits-hse-expert-review.md` (four-practitioner review of
FreeHS module B3, 2 August 2026). Every finding was addressed in the
same release; each row links the fix to its enforcement point and its
test. Full design rationale in ADR 0012 (Amendment, 2026-08-02);
schema change is migration `0060_permits_hse_hardening` (backfills gas
limits onto already-seeded types in production).

| ID | Sev | Finding | Disposition | Enforced at | Test |
|----|-----|---------|-------------|-------------|------|
| PW-1 | High | Gas test counted, not evaluated | **Fixed.** Permit types carry per-gas acceptable ranges (`gasLimits`) + a freshness window (`gasTestMaxAgeMinutes`, 30 min for confined space). Every configured limit needs a fresh, in-range LATEST reading to issue; verdicts are snapshotted per reading (`withinLimits`) and shown in the UI and on the printed permit. Dangerous readings are still recorded — they are evidence — they just block. Seeded defaults: O₂ 19.5–23.5 %, LEL < 10 %, CO < 30 ppm. | `gasGateError` (shared) → `issue` | PW-E06, PW-E07, PW-E09, PW-E25 |
| PW-2 | High | Expired permit could be accepted | **Fixed.** Acceptance refuses once `validTo` has passed — the remedy is extension (re-authorisation), then accept. | `accept` | PW-E26 |
| PW-3 | High | One-click resume bypassed the confirmation | **Fixed twice over.** The UI now shows a real resume panel — suspension reason recap + required attestation checkbox — and sends the flag the user actually gave. Server-side, gas-testing types additionally require a fresh in-range reading taken AFTER the suspension (`takenAfter` cut): the pre-alarm atmosphere is not evidence the alarm's cause is gone. | permit page + `resume` | PW-E27 |
| PW-4 | Med | Extension could end in the past; SIMOPs not re-run | **Fixed.** `newValidTo` must be in the future; the SIMOPs check re-runs over the ADDED span and needs explicit acknowledgement (recorded in the event log). The extend panel shows the clashes before the button enables. | `extend` | PW-E28 |
| PW-5 | Med | Handover could make the authoriser the acceptor | **Fixed.** `acceptor-is-authoriser` refusal server-side; the handover dropdown filters the authoriser out. | `handover` | PW-E29 |
| PW-6 | Med | No printable / PDF permit | **Fixed.** `renderPermitPdf` (same chromium + R2 pipeline as risk assessments): HMAC-gated `/render/permit/[id]` print layout — header, signatures, precondition checklist with confirmations, gas verdicts against ranges, evidence, gang, entry/exit log, close-out, full timeline — downloadable from the permit page via `/api/exports/permit-pdf`. | render package + export route | typecheck + RA-pattern parity |
| PW-7 | Med | No RA / method-statement link | **Fixed.** Permits link a risk assessment and a method statement document (validated in-tenant, shown as links, on the PDF). Types gained `requiresRiskAssessment` — issue refuses without the linked RA. Seeded types default the flag off so tenants without RA content are not blocked; switch it on per type in the catalogue. | `create`/`update`/`issue` | PW-E32 |
| PW-8 | Med | One acceptor; no gang or entry/exit log | **Fixed.** `workers` (name, role, optional linked user) + an append-style entry/exit log. Entries only on ACTIVE permits; exits any time while open; **closure refuses while anyone is still inside**; "N inside now" shows on the permit and the live board. | `setWorkers`/`logEntry`/`logExit`/`close` | PW-E33 |
| PW-9 | Med | Only issuers could record checks / readings | **Fixed.** Recording (preconditions, gas readings, attachments, gang, entry log) is open to competent persons (`permits.create`), issuer authorities, and the permit's named acceptor. Issue remains the issuer's signature that they are satisfied. | `assertCanRecord` | PW-E30 |
| PW-10 | Med | Only post-expiry notification | **Fixed.** The expiry watch gained a warning pass: parties are emailed once when the window closes within 60 minutes (`expiry_warning_sent_at` stamp, `permit-expiry-warning` template), separately from the post-expiry escalation. Extension clears both stamps. | `permit-expiry-watch` | PW-J03 |
| PW-11 | Med | Overdue permits fully workable | **Fixed (block, not auto-suspend).** Overdue now blocks acceptance (PW-2) and handover; the sanctioned remedies remain extend (must end in the future), suspend, close, cancel. | `accept`/`handover` | PW-E26, PW-E29 |
| PW-12 | Med | Any issuer could act on any permit estate-wide | **Fixed.** Lifecycle authority is site-scoped: when the permit's site has a curated team (`site_members`), only that team (or admins) can authorise, issue, suspend, resume, extend, close, cancel or reassign it. Uncurated sites and site-less permits stay open so tenants that don't use site teams aren't locked out — scoping activates per site as the team is curated. | `assertSiteAuthority` | PW-E31 |
| PW-13 | Low | References "overflow" after PTW-9999 | **Verified safe, with proof.** `padStart` never truncates — the sequence continues PTW-9999 → PTW-10000 → … and lists order by creation time, not reference text. Covered by a test that drives the counter across the boundary. | `create` | PW-E34 |
| PW-14 | Low | Same-area flag was exact-text only | **Fixed.** Token-set matching: reordered wording ("Bay 4, tank farm" vs "tank farm bay 4") and subset wording ("bay 4" within "tank farm bay 4") both flag; empty text never matches. | `sameAreaMatch` | PW-E08, PW-E35 |
| PW-15 | Low | Competence is a self-tick | **Accepted as documented** (per the review's own register): a hard check against training records lands with the Training module (Phase 10). Until then the precondition line remains, and the record honestly shows who ticked it and when. | — | — |

**Not changed (deliberately):** acceptance before the window opens
remains allowed — an acceptor signing on at 07:55 for an 08:00 start is
normal practice, and the review itself marked pre-window refusal as
"arguably". The strict state machine, snapshot model, append-only event
log and warn-don't-block SIMOPs philosophy the reviewers praised are
untouched.
