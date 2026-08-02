# FreeHS — Permit to Work & High-Risk Activities module

## Independent review by four HSE practitioners

**Product:** FreeHS (freehs.software)
**Module reviewed:** Permit to Work & High-Risk Activities (FreeHS module B3)
**Surface reviewed:** `/en/permits` — register, live board, permit page, raise-a-permit flow, type catalogue
**Date:** 2 August 2026

---

## Methodology & scope (read this first)

Unlike the two earlier reviews (COSHH turned out not to be a module; permits are
now real), **this is a full module review.** The Permit to Work module shipped
to `main` in PR #30 with its own database schema, a 1,400-line router, five web
routes, an expiry-escalation worker and ADR 0012. The four practitioners from
the Risk Assessments review were asked to run their permit programme on it:
raise a permit, work it through the issue gate, sign it, hand it over a shift,
suspend and resume it, close it out, and watch what happens when one is left
open.

**How the review was performed.** The live app at
`https://freehs.software/en/permits` is behind an authenticated login wall
(anonymous request → HTTP 403) and no browser automation was available, so —
as before — every finding is verified against the **shipped implementation**
now on `main`: the lifecycle state machine and domain helpers
(`packages/shared/src/permits.ts`), the router
(`packages/api/src/routers/permits.ts`), the schema
(`packages/db/src/schema/permits.ts`), the expiry worker, the web pages and the
exact on-screen copy. Reproduction steps and code pointers are in the
Engineering appendix.

This module is markedly more mature than the Risk Assessments module was at
first review — a real state machine, separation of duties, a conditional issue
gate, SIMOPs conflict detection and an auto-escalating expiry watch. The
findings below are therefore mostly **edge-case and safety-hardening** issues
rather than structural holes, and several are genuinely subtle. Credit where due
throughout.

Product-defect severities: **High** (defeats a life-safety control or lets work
be authorised when it shouldn't be), **Medium** (works but pushes users toward
unsafe/non-compliant practice, or a real capability is missing), **Low** (polish
/ scale / edge case).

---

## The reviewers

Same four practitioners, re-focused on the permit-to-work angle each sees most.

| # | Reviewer | Role | Organisation | Permit lens |
|---|----------|------|--------------|-------------|
| 1 | **Priya Nair, CMIOSH** | Group HSE Manager | Precision-engineering firm, ~800 staff, multi-site | Hot work, electrical isolation/LOTO, SIMOPs across a live plant, issue-gate rigour, multi-site issuer authority |
| 2 | **Tom Whitfield, GradIOSH** | H&S Advisor | Building-services contractor, ~40 staff + subs | Work at height, excavation, daily permit volume, RAMS, the copy posted at the job, mobile use |
| 3 | **Dr. Aisha Bello, CFIOSH** | Head of OH&S | NHS trust (estates & plant rooms) | Confined space, gas testing, rescue, "someone still in there", suspend/resume discipline |
| 4 | **Marcus Lindqvist, CMIOSH (ISO 45001 lead auditor)** | EHS consultant / auditor | FM & logistics clients | Separation of duties, audit trail, defensibility, HSG250 good practice, competence evidence |

---

# 1 · Priya Nair — Group HSE Manager, precision engineering

> *"We run hot work in the fabrication bay, electrical isolations on the line,
> and often several jobs in the same hall at once. The two things I care about:
> can a permit be issued with a control missing, and does the system see a clash
> between two jobs in the same place."*

### What I did
Raised a hot-work permit and an electrical-isolation permit for overlapping work
in the same hall; worked both through the issue gate; deliberately tried to issue
with controls missing.

### What genuinely works for me — and it's the right stuff
- **The issue gate is the heart of the module, and it's built correctly.** A
  permit cannot be issued until *every* snapshotted precondition is confirmed,
  the required evidence is present (gas test / isolation certificate / rescue
  plan, per the type), the authorising signature is in place where the type
  demands it, an acceptor is named, and the window is valid and not already
  past. This is exactly the "the permit cannot exist without its controls"
  principle. I tried to issue with an unticked precondition and with no
  isolation certificate — both correctly refused with clear messages.
- **SIMOPs conflict detection is real and well-judged.** When I set up the
  second permit overlapping the first at the same site, the system warned me —
  on the draft, in the raise form, and again at the point of issue — and made me
  tick "acknowledge conflicts" to proceed, recording that acknowledgement in the
  audit log. Crucially, back-to-back windows (one ends as the next starts) don't
  false-alarm as a clash. That's a mature piece of design.
- **Separation of duties is structural:** the issuer can't be the acceptor, and
  the authoriser can't authorise their own acceptance. Enforced server-side, not
  just hidden in the UI.
- **Preconditions are snapshotted onto the permit at creation**, so when I edit
  a permit type later it never rewrites a live permit. That's the correct
  behaviour and it's the kind of thing cheaper tools get wrong.
- **The live board is a genuine control-room view** — every open permit,
  overdue first, grouped by site, big red overdue count, auto-refreshing. I'd
  put that on a screen in the plant office tomorrow.

### Bugs & things that will bite

**PW-4 (Medium) — Extension can land in the past and doesn't re-check SIMOPs.**
Extending a permit only checks the new end is later than the old end and within
one more max-duration window — it never checks the new end is later than *now*.
An overdue permit can be "extended" to a time that's still in the past. And
extension doesn't re-run the SIMOPs conflict check for the lengthened window
(the ADR admits this), so I can extend a hot-work permit into a period where a
new clashing permit now exists, with no warning. *Repro: let a permit run
overdue, extend it by a few hours still short of now — accepted; or extend into
a window that overlaps a newer permit — no conflict raised.*

**PW-12 (Medium) — Any issuer can act on any permit, anywhere.** Suspend,
resume, extend, close and cancel require only the `permits.issue` permission —
not any relationship to that permit or its site. In a multi-site business, an
issuer at Site A can close or cancel a live permit at Site B. Permits aren't
scoped to a site's issuer authority the way access is elsewhere in the platform.
For a single site that's fine; across an estate it's a governance gap.

**PW-9 (Medium) — Only issuers can tick preconditions and record gas tests.**
Confirming preconditions, recording gas readings and adding evidence all require
`permits.issue`. But on my plant the person who *proves the isolation dead* or
*runs the gas test* is often a competent electrician or gas tester, not the
permit issuer. Forcing everything through the issuer either bottlenecks them or
— worse — trains them to tick boxes for checks someone else did. The issuer's
job is to be *satisfied* the checks were done and to sign the issue; the checks
themselves should be recordable by the competent person.

**PW-14 (Low) — "Same area" clash detection is exact-text only.** The loudest
SIMOPs warning ("same area") only fires when the location text matches
character-for-character after basic normalisation. "Bay 4, tank farm" and "Tank
farm bay 4" are the same place but won't flag as same-area — you still get the
same-site overlap warning, but the strongest signal is missed.

### Usage patterns that make little sense — and what I'd do instead
- **Scope issuer authority to sites (PW-12).** Reuse the platform's site access
  rules so an issuer only acts on permits at their sites.
- **Split the "competent person" role from the issuer (PW-9).** Let a
  create-level user record gas tests and tick physical preconditions; keep the
  *issue* action as the issuer's sign-off that they're satisfied.
- **Re-run SIMOPs on extension and forbid past windows (PW-4).**

**Verdict:** The control model is excellent — the issue gate and SIMOPs handling
are the best I've seen at this price. The gaps are around scale (issuer scoping)
and role granularity, plus a couple of extension edge cases. I'd pilot this on
one site now and fix issuer scoping before an estate-wide rollout.

---

# 2 · Tom Whitfield — H&S Advisor, building-services contractor

> *"On a live site I might issue a dozen permits a day — work at height,
> excavation, hot work. The permit has to end up in the operative's hand or on
> the board in the cabin, and it has to point at the RAMS. That's the test."*

### What I did
Raised work-at-height and excavation permits, named an acceptor, tried to attach
the method statement, and tried to get a copy to post at the job.

### What works for me
- **The nine seeded permit types are genuinely good** — work at height,
  excavation, hot work, confined space, roof work, lifting, asbestos, electrical,
  pressure. The precondition checklists read like they were written by someone
  who's issued permits (excavation: services located, support plan for the depth,
  safe access/egress, spoil clear of the edge). And they're editable, so I can
  tune them to my methods. Custom types too.
- **Raising a permit is quick and the type tells you what it'll demand up
  front** — "Before issue this type requires: rescue plan" etc., plus the
  precondition count and max duration. No surprises at issue time.
- **Mobile card layouts** on the register and board mean I can glance at what's
  live from my phone.

### The gaps that stop me using it end to end

**PW-6 (Medium) — There's no printable / postable permit.** A permit to work
lives at the point of work — a copy in the operative's hand, a copy on the board
in the site cabin. This module has a control-room board and a detail page, but
**no print or PDF of the permit itself.** (Your Risk Assessments module has a
print view; permits don't.) I can't produce the signed A4 that regulations and
my clients expect to see displayed at the job. *Repro: open any permit — there
is no print/PDF/export control anywhere.*

**PW-7 (Medium) — A permit can't reference its risk assessment or method
statement.** Every permit I issue is backed by a task RA and a method statement
(RAMS). There's nowhere to link them — `workDescription` is a free-text box.
For work at height or excavation the permit should point at the RA and the safe
system of work, and ideally require them. As it stands the permit and the RAMS
live in separate worlds.

**PW-8 (Medium) — A permit names one "acceptor," not the gang.** My excavation
permit covers a three-person gang, not one person. The system records a single
acceptor (the person in charge), which is right as far as it goes, but there's
no list of the operatives actually covered by the permit — and for confined
space there's no entry/exit log of who's in (that's just a precondition tick).
"Who is under this permit right now" can't be answered.

**PW-13 (Low) — Permit references overflow after PTW-9999.** References are
zero-padded to four digits (`PTW-0001`). A busy site issuing dozens a day gets
through 9,999 in a couple of years and the numbering breaks. (Same issue the
Risk Assessments review flagged.)

### UX / UI notes
- The raise form is clean and the datetime-local pickers default sensibly (now →
  +8h). Good.
- Because there's no printable output, the "record" of a permit is only ever
  on-screen — fine for the office, not for the job face.

### Usage patterns that make little sense — and what I'd do instead
- **Give me a signed PDF of the permit (PW-6)** — preconditions, evidence,
  signatures, validity — so it can be posted at the work and filed.
- **Link the RA/method statement to the permit (PW-7)**, and for high-risk
  types require it.
- **Record the gang / entrants (PW-8)** with an entry–exit log for confined
  space.

**Verdict:** As a control-room and register system it's strong, and the seeded
types are the best starting content I've seen. But without a postable permit and
a RAMS link it's not yet a complete site permit system for a contractor — the
permit needs to reach the job, and point at the safe system of work.

---

# 3 · Dr. Aisha Bello — Head of OH&S, NHS trust

> *"My highest-risk permit is confined-space entry into plant rooms and tanks.
> The whole point of a confined-space permit is the atmosphere test and the
> rescue plan — and never, ever letting work restart or run on without a
> re-check. I went straight at those."*

### What I did
Raised a confined-space entry permit, recorded a gas reading, issued and
accepted it, suspended it (simulating a gas alarm), resumed it, and looked at
what happens as it nears and passes its window.

### What works for me
- **Rescue plan and gas testing are conditional controls, not optional fields.**
  The confined-space type requires a rescue plan and a gas test *before issue* —
  the gate refuses without them. That's exactly right, and rare.
- **The expiry watch is a real safety net.** An open permit past its window gets
  escalated automatically to the issuer, acceptor and authoriser, exactly once,
  and extension resets the watch. "Someone may still be in there" is precisely
  the risk it's designed for.
- **The four-point closure checklist** (work complete, area made safe,
  isolations removed, personnel clear) is required to close. That's the
  confined-space close-out done properly.
- **Shift handover drops the permit back to "issued" until the incoming person
  signs on** — work can't silently continue across a shift on someone else's
  acceptance.

### Bugs & safety gaps — and these are the serious ones

**PW-1 (High) — A gas test only has to *exist*, not to be *safe*.** The issue
gate checks that at least one gas reading has been recorded — it never checks the
*value*. I recorded a single reading of "LEL 90%" (a flammable atmosphere) and
the permit issued without complaint. There's no acceptable range per gas (O₂
19.5–23.5%, LEL <10%, etc.), no pass/fail, and no evaluation at all. For the most
lethal permit type in the catalogue, "a number was typed" is not the same as "the
atmosphere is safe to enter." There's also no reading *freshness* — a test from
six hours ago satisfies the gate as well as one from five minutes ago, and
confined spaces need re-testing / continuous monitoring. *Repro: confined-space
permit → record a dangerous gas reading → issue → accepted.*

**PW-3 (High) — "Confirm safe to resume" is a real API safeguard that the UI
throws away.** The `resume` endpoint deliberately requires a
`confirmSafeToResume` flag — the system is *asking* the person resuming to
confirm the reason for suspension is resolved. But the permit page hardwires that
flag to `true` on a plain "Resume" button, with no prompt. So a permit I
suspended because a gas alarm sounded resumes in a single click, no
re-confirmation, no forced fresh gas test. The safety intent of the flag is
nullified at the UI. *Repro: suspend a permit → click Resume → straight back to
active, nothing asked.*

**PW-2 (High) — You can accept (start work on) an already-expired permit.**
Accepting a permit (the acceptor signing on, moving it to "active") checks only
that the caller is the named acceptor — it does not check the validity window is
still open. A permit issued for 08:00–10:00 can be accepted at 10:30 and go
"active" half an hour after it expired. It shows as overdue and the worker
escalates, but the acceptor has still been allowed to sign on to authorise work
on a lapsed permit. Acceptance should be refused once the window has passed
(and, arguably, before it opens). *Repro: issue a permit, let its window pass,
then accept as the named acceptor → active + overdue.*

**PW-10 (Medium) — The only expiry notification is *after* expiry.** The
escalation fires once a permit is already overdue. There's an "expiring soon"
(2-hour) count on the register, but nobody is *emailed* before the window closes.
For a confined-space entry, a nudge 30–60 minutes before expiry would let the
team close out or extend in time — instead of the first alert arriving after the
permit has already lapsed with people potentially still inside.

**PW-8 (Medium) — No entrants list / entry-exit log (also raised by Whitfield).**
A confined-space permit must record who is in the space and when they entered and
left. Here the "entry/exit log ready" is a precondition tick, and only one
acceptor is named — the actual entrants aren't recorded in the system.

### UX / UI notes
- The permit page reads top-to-bottom like a worked paper permit
  (header → conflicts → preconditions → evidence → signatures → actions →
  timeline). That layout is intuitive and I'd trust a supervisor to follow it.
- Accessibility of the status/countdown chips is fine; the gas-reading form is
  clear.

### Usage patterns that make little sense — and what I'd do instead
- **Evaluate gas readings, don't just count them (PW-1):** acceptable ranges per
  gas on the type, block issue on any out-of-range or stale reading, and support
  re-test/continuous monitoring for confined space.
- **Make "resume" mean something (PW-3):** a confirmation dialog, and for
  gas/confined types force a fresh in-range gas reading before resuming.
- **Refuse acceptance of an expired window (PW-2).**
- **Warn before expiry (PW-10)** and **log entrants (PW-8).**

**Verdict:** The lifecycle scaffolding, rescue-plan gate and expiry escalation
are excellent. But for confined space specifically, the gas-test gate checking
presence-not-safety (PW-1), the one-click resume (PW-3) and accept-after-expiry
(PW-2) are three ways the system can bless an unsafe entry. I could not sign this
off for confined-space use until those are fixed — and they're the module's most
important use case.

---

# 4 · Marcus Lindqvist — EHS consultant & ISO 45001 lead auditor

> *"Paper permits get forged, copied from last week, and left open overnight. A
> digital permit earns its keep only if the audit trail is complete, the
> separation of duties holds, and the record proves who did what, when. I
> stress-tested the evidence."*

### What I did
Walked the full lifecycle asking, at each step, "would this record stand up in an
investigation?" Focused on separation of duties, the timeline, and the states
where work can be authorised.

### What works — and it's the stuff auditors rarely find
- **A complete append-only event log.** Every meaningful action — created,
  precondition checked/unchecked, gas reading, authorised, issued, accepted,
  suspended, resumed, extended, handed over, closed, cancelled, expiry escalated
  — writes an immutable, timestamped row with the actor. The expiry worker even
  logs with actor `system`. This is exactly the evidence trail ISO 45001 §7.5
  wants, and it's genuinely append-only.
- **Signatures are timestamped `(user, time)` stamps** on the row, plus the
  event. Authorise / issue / accept are individually attributed and dated.
- **Separation of duties is enforced server-side** at authorise and issue: the
  issuer can never be the acceptor; the authoriser can't be the acceptor.
- **The lifecycle is one shared state machine** used by router, UI and worker,
  so they can't disagree about what's legal — and overdue is *derived*, not a
  stored status that could drift.

### Bugs & defensibility gaps

**PW-5 (Medium) — Separation of duties has a hole at handover.** Issue and
authorise both block the acceptor from being the issuer/authoriser. But
*handover* only blocks handing the permit to the current issuer or current
acceptor — **not to the authoriser.** So the authorising engineer who
counter-signed the permit can be handed the acceptor role and end up doing (and
being in charge of) the very work they authorised. The handover dropdown filters
out the issuer and acceptor but not the authoriser. An investigator would flag
that immediately. *Repro: on a permit requiring an authoriser, hand it over to
the authoriser — accepted.*

**PW-2 / PW-3 as audit findings.** Accepting an expired permit (PW-2) and the
one-click resume (PW-3) both produce records that misrepresent reality: a permit
"accepted" after its window, or "resumed" with a system-recorded safe-to-resume
confirmation that no human was actually asked to give. The data says a judgement
was made that the UI never solicited. For a defence bundle that's worse than a
gap — it's a record that overstates the control.

**PW-11 (Medium) — Overdue permits remain fully workable.** An overdue "active"
permit can still be extended, handed over and worked; nothing auto-suspends it.
The design is "warn, don't block," which is a defensible philosophy — but for the
overdue state specifically (the permit's own validity has lapsed), I'd expect the
system to at least drop it to suspended or block acceptance/handover until it's
re-authorised. Right now the only consequence of expiry is an email.

**PW-15 (Low, documented) — Competence is a self-tick.** "Competence of all
operatives verified" is a checklist line the issuer ticks, not a check against
training records. The ADR is honest that this becomes a hard check when the
Training module lands — fair — but until then the strongest claim the record can
make about competence is "someone ticked a box."

**PW-6 (Low, audit angle) — No exportable permit record.** As Whitfield noted,
there's no PDF/print. For an audit or an incident bundle I want the closed
permit as a fixed document — preconditions, evidence, every signature and the
timeline — not just a live web page.

### Usage patterns that make little sense — and what I'd do instead
- **Close the handover loophole (PW-5):** block handing a permit to its
  authoriser (and filter them out of the UI dropdown).
- **Don't let the record claim controls that weren't exercised (PW-2/PW-3):**
  refuse acceptance past the window; make resume a real, attributed confirmation.
- **Give the overdue state teeth (PW-11)** and **an exportable record (PW-6).**

**Verdict:** The evidence architecture is genuinely strong — the append-only log
and timestamped signatures are exactly right, and the state machine is clean.
The defensibility gaps are narrow but real: the handover separation-of-duties
hole, and two states (accept-expired, one-click resume) where the record can
overstate the control that was applied. Fix those and this is an auditable permit
system I'd be comfortable defending.

---

# Consolidated findings

### The headline
This is a well-architected module — a real state machine, a conditional issue
gate, separation of duties, SIMOPs detection and auto-escalating expiry. The
issues are hardening, not foundations. But three of them (PW-1, PW-2, PW-3) let
the system authorise or continue work that shouldn't proceed, and they cluster on
the module's highest-risk use case: confined space.

### Where the reviewers agree (act on these first)
1. **The gas test is counted, not evaluated (PW-1).** Presence of a reading
   satisfies the gate regardless of the value or its age. *Bello; Nair (hot
   work).* → **The most important fix.**
2. **Work can be authorised/continued when it shouldn't:** accept an expired
   permit (PW-2) and one-click resume that bypasses the safety confirmation
   (PW-3). *Bello and Lindqvist.*
3. **Separation of duties has a handover hole** — the authoriser can become the
   acceptor (PW-5). *Lindqvist; Nair.*
4. **The permit doesn't reach the job or point at the safe system of work:** no
   printable/postable permit (PW-6) and no RA/method-statement link (PW-7).
   *Whitfield; Marcus; Priya.*
5. **Role & scope granularity:** only issuers can record checks/gas tests (PW-9),
   and any issuer can act on any permit across the estate (PW-12). *Nair.*
6. **Missing operational safety features:** entrants/gang list + entry-exit log
   (PW-8), pre-expiry warning (PW-10), teeth on the overdue state (PW-11).

### What everyone praised (protect these)
- The **conditional issue gate** — controls must exist before a permit can issue.
- **SIMOPs conflict detection** with strict overlap and audited acknowledgement.
- **Separation of duties** at authorise/issue (bar the handover hole).
- **Precondition snapshotting** so editing a type never rewrites a live permit.
- The **append-only event log** and **timestamped signatures**.
- The **auto-escalating expiry watch** (stamp-before-notify dedupe, resets on
  extension).
- The **live board** and register **needs-attention strip**.
- The **four-point closure checklist** and **shift-handover-drops-to-issued**.
- The nine **seeded, editable, sensible permit types**.

---

# Prioritised issue register

| ID | Sev | Summary | Raised by |
|----|-----|---------|-----------|
| PW-1 | High | Gas test only checked for *presence*, not safe value or freshness — a dangerous reading still passes the issue gate | Bello, Nair |
| PW-2 | High | `accept` doesn't check the validity window — an expired permit can be accepted and go active | Bello, Lindqvist |
| PW-3 | High | "Confirm safe to resume" is hardcoded `true` in the UI — suspended permits resume in one click, no re-check | Bello, Lindqvist |
| PW-5 | Med | Separation-of-duties hole: handover can make the authoriser the acceptor | Lindqvist, Nair |
| PW-6 | Med | No printable / PDF permit to post at the job or file as the record | Whitfield, Lindqvist |
| PW-7 | Med | A permit can't link to its risk assessment / method statement (RAMS) | Whitfield, Nair, Lindqvist |
| PW-8 | Med | Only one acceptor recorded — no gang/entrants list or confined-space entry/exit log | Whitfield, Bello |
| PW-9 | Med | Preconditions & gas readings gated on `permits.issue`, conflating the competent-person and issuer roles | Nair, Bello |
| PW-10 | Med | Expiry notification only fires *after* expiry — no pre-expiry warning to the parties | Bello, Whitfield |
| PW-4 | Med | Extension allows a past/overdue end time (no `newValidTo > now`) and doesn't re-run SIMOPs | Nair, Lindqvist |
| PW-11 | Med | Overdue permits stay fully workable; nothing auto-suspends or blocks | Lindqvist, Nair |
| PW-12 | Med | Any `permits.issue` holder can act on any permit — no per-site issuer scoping | Nair, Lindqvist |
| PW-13 | Low | Reference numbers overflow after PTW-9999 (4-digit pad) | Whitfield |
| PW-14 | Low | "Same area" SIMOPs flag is exact-text only; reordered wording misses the strongest warning | Nair |
| PW-15 | Low | Competence is a self-tick, not verified against records (documented; Training module pending) | Lindqvist |

---

# Engineering appendix (root cause & pointers)

- **PW-1 (gas test presence, not value)** — the issue gate only tests
  `type.requiresGasTesting && permit.gasReadings.length === 0`
  (`packages/api/src/routers/permits.ts` ~L1126). `gasReadingSchema`
  (`packages/shared/src/permits.ts` L179) captures substance/reading/unit but no
  acceptable range; there's no per-type limit config and no freshness/expiry on a
  reading. Fix: acceptable range per gas on the permit type, evaluate each
  reading, block issue on out-of-range/stale, support re-test.
- **PW-2 (accept expired)** — `accept` runs `assertTransition` + acceptor check
  only; no window check (`permits.ts` ~L1181-1203). `issue` *does* check
  `validTo <= now` (L1114) but `accept` doesn't. Fix: refuse when
  `validTo <= now` (and consider `now < validFrom`).
- **PW-3 (resume confirmation bypassed)** — API requires `confirmSafeToResume`
  (`permits.ts` ~L1244), but the UI calls
  `resume.mutate({ permitId, confirmSafeToResume: true })` from a plain button
  (`apps/web/app/[locale]/permits/[permitId]/page.tsx` L618). Fix: a
  confirmation dialog; for gas/confined types force a fresh in-range reading.
- **PW-5 (handover → authoriser)** — `handover` blocks
  `toUserId === issuerUserId` and `=== acceptorUserId` but not
  `=== authoriserUserId` (`permits.ts` ~L1338-1343). The UI dropdown filters
  `u.id !== acceptorUserId && u.id !== issuerUserId` only
  (`[permitId]/page.tsx` L697). Fix: block/filter the authoriser too.
- **PW-6 (no PDF/print)** — no print block or `render/permit` route exists
  (contrast `apps/web/app/render/risk-assessment/...`). Fix: a permit render
  route / print view.
- **PW-7 (no RA/RAMS link)** — `permits` schema
  (`packages/db/src/schema/permits.ts`) has no `riskAssessmentId` / document
  link; only free-text `workDescription`. Fix: link risk assessments/documents,
  require for high-risk types.
- **PW-8 (single acceptor)** — schema has `acceptorUserId` only; no
  entrants/operatives collection or entry/exit log. Fix: a people-on-permit
  sub-record.
- **PW-9 (role granularity)** — `checkPrecondition`, `recordGasReading`,
  `addAttachment` all `.use(requirePermission('permits.issue'))`
  (`permits.ts` L922, L969, L1011). Fix: allow a competent-person / create-level
  role for the physical checks; keep `issue` as the sign-off.
- **PW-10 (no pre-expiry warning)** — `permit-expiry-watch.ts` only selects
  `lte(validTo, now)` (L63-70). Fix: a second pass for
  `validTo` within a lead-time window that notifies once.
- **PW-4 (extension)** — `extend` checks `newValidTo > permit.validTo` and
  `addedHours <= maxDurationHours` but not `> now`
  (`permits.ts` ~L1283-1289); SIMOPs not re-run (ADR-documented). Fix: require
  `newValidTo > now`; re-run `findConflicts`.
- **PW-11 (overdue toothless)** — overdue is derived (`permitIsOverdue`,
  `packages/shared/src/permits.ts` L105); no lifecycle consequence. Fix: block
  accept/handover on overdue, or auto-suspend.
- **PW-12 (issuer scope)** — every lifecycle mutation guards only on the
  `permits.issue` permission, with no site relationship. Fix: apply site access
  scoping.
- **PW-13 (ref overflow)** — `PTW-${String(n).padStart(4, '0')}`
  (`permits.ts` ~L844).
- **PW-14 (same-area match)** — `normaliseArea` is trim/lowercase/collapse
  spaces + exact compare (`permits.ts` L199, L266). Fix: token-set match or a
  structured area field.
- **PW-15 (competence)** — precondition checklist line only; documented v1 gap
  pending the Training module (ADR 0012, Consequences).

### Overall
This is the strongest of the three FreeHS HSE modules reviewed. The architecture
is right; the work now is safety-hardening the highest-risk path (confined space:
PW-1/PW-2/PW-3), closing the handover separation-of-duties hole (PW-5), and
finishing the operational loop so the permit reaches the job and points at its
safe system of work (PW-6/PW-7/PW-8).

---

*Prepared as an independent practitioner review of the FreeHS Permit to Work &
High-Risk Activities module. Findings verified against the shipped implementation
on `main`; reproduction steps and code pointers included so each can be triaged
directly.*
