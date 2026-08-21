# UX walkthroughs — the playbook

**Genre:** persona-driven, in-browser expectation audits of the rendered app
**Findings land in:** `docs/reviews/<slug>-ux-walkthrough.md` + a `-response.md`
disposition doc — the same loop the HSE rounds use
**Status:** playbook v1, written before the first pass. Amend it with what the
passes teach; do not fork it per pass.

---

## Why this genre exists

The platform already has four review genres, and none of them sits in front of
the rendered app as a person with a job and no map:

| Genre | Instrument | What it audits |
| --- | --- | --- |
| Module audits (`docs/reviews/*-module-audit.md`) | test suites against the routers | server correctness, procedure by procedure |
| Cross-module sweep | generated from the router itself | access-predicate parity across ~300 procedures |
| HSE expert reviews | practitioners using the product | domain correctness — is the safety content right |
| Release verification (`QA_TRACKING.md`) | driving the real UI per feature | does the thing we just built work where we built it |

What keeps slipping through is the defect found today only by accident: *I
click on something and that is not the expected behaviour — the platform does
something other than what the person using it would expect.* Not a broken
procedure. An **expectation mismatch**. The HSE rounds caught these as a
by-product — the disabled-input burst-typing class (NR-01), the frozen
`window.confirm` (NR3-05), the mutation that closed a half-typed RIDDOR
screening — and they were among the highest-value findings of those rounds.
But hunting them was never anyone's brief. This playbook makes it a brief.

The scale that makes "I'll notice things as I go" insufficient: **142 route
files** under `apps/web/app`, across ~15 modules, in at least six materially
different app states each. Ad-hoc noticing samples that space at random.
A walkthrough programme covers it deliberately.

---

## 1. The defect class

An expectation mismatch is: **the product behaves as coded, and not as the
user's mental model predicts.** Every finding is tagged with one of three
shapes:

- **E-act** — the interaction does the wrong thing, or nothing. (Click a
  button, get a navigation. The RS-A1 page that was linked and did not exist —
  a class that has now shipped twice.)
- **E-flow** — each step works, but the flow does not lead where the job goes
  next. (The permit is issued; the screen offers nothing about the contractor
  standing at the gate waiting to accept it.)
- **E-words** — the user cannot tell what a control does, what state they are
  in, or what will happen, *before* acting. (Two adjacent buttons whose
  difference is a domain distinction the persona does not hold.)

Explicit non-goals — other genres own these and a walkthrough that drifts into
them produces worse versions of both: procedure correctness (module audits),
access boundaries (cross-module sweep), safety-domain content (HSE reviews),
regression of already-verified features (`QA_TRACKING.md`).

The defining discipline: **a finding requires an expectation recorded before
the action.** "This felt wrong" is not a finding; "I expected X, it did Y" is.
That is what turns a vague walk-around into a register someone can act on —
and what makes disagreement productive, because roughly half of these findings
will be *working as designed*, and the response doc then decides whether the
design changes or the affordance does (§7). FS-G05 is the precedent: an
auditor asserted published-FRA editing must be refused, the response retracted
the finding against ADR 0011, and the *affordance* (the attestation-stale
banner) is what carries the safety. Both outcomes are wins; only a recorded
expectation lets you tell them apart.

---

## 2. The protocol — rules of a pass

1. **Play the persona, not a tester.** Enter through the front door (sign-in →
   nav), never by pasting a deep URL, unless the persona would genuinely
   arrive by link (P4 arrives *only* by link). Use the persona's vocabulary
   when searching and their patience when waiting.
2. **Expectation before action.** Before every non-trivial interaction, write
   one line: what I think this will do. Act. Record what happened. Mismatch —
   including "I could not form an expectation at all" — is a finding.
3. **Exercise every control on a visited screen**, or log that you skipped it.
   A button nobody dares click is itself an E-words finding. Dead controls are
   E-act findings regardless of how minor the screen.
4. **Friction counts.** Hesitations ("I did not know which of these two"),
   double-takes, vocabulary misses, re-reads, wrong first clicks that you
   recovered from — all findings, severity S3/S4. The recovered wrong click is
   the single best predictor of a real user's unrecovered one.
5. **Never read the source mid-pass to explain a confusion away.** The
   confusion is the data. Source reading happens at triage, in the response
   doc.
6. **Complete the day-script.** A pass that finishes its persona's day beats
   one that exhausts a single module. Depth-first rabbit holes get one line in
   the findings doc ("worth its own pass") and the script continues.
7. **Screenshot every finding**, numbered to the finding ID. Screenshots stay
   with the session / PR discussion; the findings doc is textual with exact
   repro (route, world, steps) — the repo does not carry image blobs.
8. **End with the coverage ledger**: the list of routes visited, each with the
   worlds it was seen in. The programme's exit criterion lives on the union of
   these ledgers (§8).

---

## 3. The cast — six personas

Personas are roles, not demographics. Each carries a device, a vocabulary
level, a patience budget, and — most importantly — jobs, stated as outcomes,
never as feature names.

| ID | Who | Device / viewport | Vocabulary | Patience |
| --- | --- | --- | --- | --- |
| P1 | H&S manager (owns compliance, 40-person firm, two sites) | Desktop 1440 | Expert (RIDDOR, CoSHH, RAMS are native words) | Low for re-typing, high for reading |
| P2 | Site supervisor | Desktop 1280 in the cabin + phone on the floor | Working (knows the documents, not the statute) | Interrupted every three minutes |
| P3 | Frontline worker | Phone 390×844, sometimes gloves | Everyday words only; possibly ESL | Two minutes, standing up |
| P4 | External contractor (no seat) | Phone + laptop; arrives **only** by link or QR | Working | Suspicious of links; opens them twice, forwards them, opens them three weeks late |
| P5 | Brand-new owner-admin, day zero | Desktop | None yet — the nav labels are their first contact with our vocabulary | ~20 minutes before churning |
| P6 | Auditor / HSE inspector | Desktop | Expert | Infinite for evidence, zero for evasion |

Day-scripts (the spine of each persona pass — jobs, in order):

- **P5 — day zero.** Land on the marketing/entry surface; understand what this
  is; sign up (password path, no verification step); orient in an *empty*
  tenant — what do these nav words mean, where do I start; create the site(s);
  invite two colleagues; produce the first real record end to end (a risk
  assessment from scratch, then an inspection template); print/post the first
  QR poster; find out what the free plan does and does not include.
- **P3 — a frontline day.** Scan the wall QR and report a hazard with no
  account; report an accident that happened to a colleague ten minutes ago
  (the mobile-first form, one-handed); find "my work": complete an assigned
  action with a photo; sign an acknowledgement; sit a toolbox briefing and
  sign; look at own training card. One of these happens in a dead zone
  (offline) and must survive it.
- **P4 — outside the fence.** Receive a RAMS pack link and accept it for the
  company; upload insurance documents through the contractor-upload token; be
  named acceptor on a permit and sign on glass; scan a site QR and report;
  re-open every one of those links a second time, forwarded, and expired.
- **P2 — a supervisor day.** Morning fire-logbook checks (one fails — raise
  and assign the follow-up); run the scheduled site-walk inspection; issue a
  hot-work permit to an arriving contractor, gas readings and all; brief the
  gang on the RAMS pack and capture signatures; accept a mid-shift handover;
  log an observation someone shouted across the yard; close the permit at end
  of day.
- **P1 — a manager week (compressed).** Triage the morning needs-attention
  strips across incidents / actions / fire; chase two overdue actions to their
  owners; build and issue a RAMS pack for a new job to a client; review a
  contractor's submitted pack; check training gaps before assigning the job;
  pull monthly numbers (dashboard + export) for the board; adjust one settings
  surface (risk matrix or action types).
- **P6 — an audit day.** Runs against a *lived-in* world (§4, W3): "show me
  your risk assessments and who signed them"; the version in force on a given
  past date; one incident file end to end including the RIDDOR determination;
  the permit record for a named date; training evidence for a named person;
  the fire logbook for the quarter. Every PDF opened gets compared with its
  screen — dates, names, and content must agree (the UTC document-clock class).

---

## 4. Worlds — the states a pass runs in

Most expectation mismatches live outside the happy, freshly-seeded,
admin-on-desktop state. Every pass declares its worlds; the programme is not
done until each world has hosted at least one pass.

- **W1 — day zero.** A real sign-up, empty everything. Deliberately *not* the
  sandbox. Note: because every e2e spec and every demo rides the seeded
  sandbox, the empty tenant is now the **least-tested state in the product**
  while being the first state every real customer sees. This is why UXW-1
  runs first (§8).
- **W2 — seeded-coherent.** The sandbox tiles, which exist precisely to mint
  coherent states on demand: `riskAssessment` (general / coshh / fire /
  manualHandling), `inspection` (siteWalk / equipment / vehicles /
  fireChecks), `hazard` (captureOnly / withActions / anonymous), `permit`
  (hotWork / confinedSpace / workingAtHeight / electrical), `incident`
  (recordOnly / withInvestigation / withRiddor), `rams` (reviewPack /
  buildPack / contractorDocs). One POST to `/api/sandbox/create` per world —
  the same harness `apps/web/e2e/fixtures/sandbox.ts` uses.
- **W3 — lived-in.** A tile *plus* a day of real activity layered on by an
  earlier pass. Passes compound deliberately: UXW-4 (supervisor day) runs on
  the permit tile and leaves a worked tenant; UXW-6 (audit day) audits that
  same tenant. A world with history is the only place "the version in force
  on that date" can be tested honestly.
- **W4 — constrained.** The invited colleague on the **Standard** permission
  set (minted by P5's own invite during UXW-1 — `EMAIL_DELIVERY=console`
  prints the invite link in dev, or pull the token from the DB under a
  production build); and the **free plan** for the entitlement gate. The
  question in this world is never "is access enforced" (the sweep owns that)
  but "when I am refused, do I understand what happened and what to do".
- **W5 — degraded.** Offline mid-briefing (the queue must surface, not
  swallow); network killed between click and response on a mutation (the
  banned outcome is silent loss — the field must restore or the toast must
  name it); every mutation delayed 3 s (the panel-closing / stale-closure
  class lives in this gap).
- **W6 — second locale + second brand.** Walk key screens on `/it` beside
  `/en` — the raw-key and misplaced-level classes (the permit `evidence.`
  keys) only *render* at runtime, and K01 structurally cannot see the
  misplaced-level kind. Spot the shared surfaces on a `forma360` build too;
  CI's two brand legs prove boot, not UX.

Mobile is not a world — it is P3's and P4's device, and every register P1
visits on desktop gets a one-screenshot viewport spot-check in passing.

---

## 5. The pass catalogue

Persona passes — the spine. One pass = one session = one findings doc.

| Pass | Persona | Worlds | Known classes it hunts |
| --- | --- | --- | --- |
| UXW-1 First run | P5 | W1 | onboarding cliffs; empty-register dead ends; nav vocabulary (ADR 0014's labels meeting a stranger); the seeded-sandbox ↔ real-product gap |
| UXW-2 Frontline day | P3 | W2 (`hazard`, `incident`), W5 | mobile form ergonomics; localStorage draft; offline queue surfacing; everyday-words failures |
| UXW-3 Outside the fence | P4 | W2 (`rams` reviewPack, `permit`), token surfaces | the NR3-01 class (public layouts break silently — nobody internal dogfoods `/s`, `/scan`, `/gate`, `contractor-upload`); expired/second-open/forwarded token behaviour |
| UXW-4 Supervisor day | P2 | W2 (`permit`) → leaves W3 | cross-module flow seams (inspection→action, permit→RAMS gate, logbook→action); interruption survival (F5, back button, tab close mid-flow) |
| UXW-5 Manager week | P1 | W3 (from UXW-4) or W2 (`rams`, `incident`) | register ergonomics at volume; needs-attention truthfulness; export/dashboard trust |
| UXW-6 Audit day | P6 | W3 | PDF ↔ screen coherence; version-history navigability; evidence-trail completeness as *presented* |

Cross-cutting sweeps — the mesh. Cheap, mechanical, batchable several per
session; run them between persona passes:

- **SWP-A dead controls.** Every route: every link and button either acts or
  is a finding. (Candidate for later mechanisation as a guard test that
  collects literal `href`s and asserts a route exists — the RS-A1 class has
  now shipped twice, which is the repo's own bar for pinning a class.)
- **SWP-B empty states.** Every register at zero rows: does the screen say
  what this module is for and offer the first action, or is it a blank table?
  (W1 makes this sweep nearly free.)
- **SWP-C deep-link + refresh.** Every route loaded directly by URL; F5
  mid-flow; browser back after a mutation. Skeletons that never resolve
  (the known not-found-shows-skeleton gap in `QA_TRACKING.md`) belong here.
- **SWP-D error injection.** Kill the network on each family of mutation;
  the restore-or-name rule; double-click every submit.
- **SWP-E locale render.** `/it` walk of the top 30 screens: raw key paths,
  English leaking through, ICU plural failures, date formats.
- **SWP-F document coherence.** Every renderer (`/render/*`, `/api/exports/*`)
  opened once against its source screen: same numbers, same names, same
  times, same timezone.
- **SWP-G constrained render.** The Standard user (W4) walks the full nav:
  no dead 403 ends, no controls that visibly exist only to fail, refusals
  that explain themselves.

---

## 6. Mechanics — how a pass actually runs

**Where.** In a Claude Code session against a local production build — the
same recipe as the `e2e` CI job (`.github/workflows/ci.yml`), which is the
canonical boot: Postgres + Redis (in remote sessions Docker Hub is
egress-blocked, so use the native-services recipe in
`tools/ux-explorer/README.md` — apt Postgres 16 + `redis-server`; on a
machine with registry access, `tools/test-db/docker-compose.yml`), `pnpm
--filter @forma360/db db:migrate`, write `apps/web/.env` exactly as the CI job
does with `BRAND=freehs`/`NEXT_PUBLIC_BRAND=freehs`, `pnpm --filter
@forma360/web build`, `pnpm start`. Production-domain smoke stays with
`prod-smoke.yml` and the local `verify-changes` flow — those verify releases;
walkthroughs discover, and they discover better on a build where the DB and
the emailed tokens are inspectable.

**Workspace minting.** `POST /api/sandbox/create` with the chosen tile and a
unique `x-real-ip` (reuse the fixture's `uniqueClientIp` trick verbatim) for
W2; the real sign-up form for W1; the console-printed invite link (or the DB
row) for W4.

**The driver.** A thin explorer, to be built in the first session at
`tools/ux-explorer/` (~100 lines, not committed to CI):

- launch the pre-provisioned Chromium once, headless, with
  `--remote-debugging-port`, per-persona viewport (and Playwright device
  emulation for P3/P4), storage state persisted to the scratchpad;
- each step is a short node script that connects over CDP, performs one
  persona action, and exits with a screenshot + an accessibility-tree dump;
- Claude reads the screenshot, writes the expectation line for the next
  action *as the persona*, and issues the next step;
- `context.setOffline(true)` and route-interception delay switches for W5.

This is the same loop a human tester runs — look, predict, act, compare —
executed by a session that never gets bored on route 90 of 142.

**Session sizing.** One persona pass or two-three sweeps per session. Passes
must not merge: the findings doc's voice is one persona's.

**Kickoff.** Appendix A is a paste-ready prompt for UXW-1; adapt the header
block (persona, worlds, day-script) for the others. The prompt embeds the §2
protocol so a pass session needs no other context beyond `CLAUDE.md`.

---

## 7. The register, adjudication, and pinning

**Findings doc** — `docs/reviews/<slug>-ux-walkthrough.md`, one per pass, in
the house review format: header (pass, persona, worlds, date, route ledger),
then a findings table, then per-finding detail.

ID scheme: `UXW<pass>-NN` (`UXW1-07`). Fields per finding:

| Field | Values |
| --- | --- |
| Shape | E-act / E-flow / E-words |
| Severity | S1–S4 (below) |
| Expectation | the line written *before* acting |
| Actual | what happened |
| Where | route + world + steps |
| Proposed disposition | fix / affordance / by-design / (adjudicator may add: retract) |

Severity — calibrated to consequence for the persona, not to code size:

- **S1** — the job cannot be completed, typed data is lost, or a
  legally-significant record comes out wrong without the user knowing.
- **S2** — the job completes but the user now believes something false: it
  looked saved and was not, it looked sent and was not, the register and its
  own detail disagree, the seeded state contradicts itself. Trust damage.
- **S3** — friction: wrong first click, hesitation, vocabulary miss, needless
  re-typing. Job completes correctly.
- **S4** — polish.

**Adjudication** — a `-response.md` per findings doc, same as the HSE rounds.
The product owner rules on every S1/S2 individually; S3/S4 may be batch-ruled.
The four dispositions are the point of the whole exercise: *fix* (change
behaviour), *affordance* (keep behaviour, change what the user can tell before
acting — the FS-G05 resolution), *by-design* (document; consider docs copy),
*retract* (the persona misread — record why, it tunes the next pass).

**Fix passes** consume the response doc exactly as the HSE fix passes did:
small conventional commits, findings-IDs in messages and PR body.

**Pinning** — the step that stops re-litigating:

- a fixed S1/S2 *journey* gets a spec on the sandbox fixture
  (`freehs-*.spec.ts` — the existing five are the pattern);
- a fixed *class* that is mechanically checkable gets a guard test beside the
  existing family (`dialog-titles`, `format-date-usage`,
  `inline-error-render`, …). The bar stays the repo's own: a class that
  shipped twice earns a guard. Fix the code, never the guard.

---

## 8. Sequencing — the first cycle

1. **Session 0 — harness.** Build `tools/ux-explorer/`; prove the boot recipe
   in-container end to end (stack up, sandbox minted, screenshot captured);
   generate the route inventory from `apps/web/app/[locale]` + the nav model
   as the master coverage checklist.
2. **UXW-1 first run (P5/W1).** The rawest expectations meet the least-tested
   state; also produces the Standard-set colleague for W4 and makes SWP-B
   nearly free.
3. **UXW-2 frontline day (P3/W2+W5).** The adoption-critical surface — if the
   worker with gloves fails, nothing upstream matters.
4. **UXW-3 outside the fence (P4).** Highest blast radius when broken and the
   least internally dogfooded; the NR3-01 class lived here for a reason.
5. **Sweeps A+B+C batched.**
6. **Adjudicate 1–3 → fix pass → pin.** Do not run more discovery on top of a
   known backlog; a register that only ever grows stops being read.
7. **UXW-4 → UXW-5 → UXW-6** (they compound into W3), sweeps D–G between,
   adjudicate, fix, pin.
8. **Then the humans.** Schedule HSE practitioner round 4 *after* the first
   fix pass, pointed at judgment-heavy areas. Their hours are the scarcest
   instrument in the programme; walkthroughs exist so those hours are never
   again spent discovering that a button is dead.

Exit criterion for the cycle: the union of route ledgers covers the FreeHS
nav; every register has been seen at zero rows and on `/it`; every renderer's
output has been opened once; every world has hosted at least one pass.

---

## 9. What this genre cannot do

Named so nobody over-trusts it: domain judgment (whether the RIDDOR guidance
is *right* — HSE reviewers own that), taste and brand feel, real-device
ergonomics (glare, gloves, a cracked screen), performance feel under real
network jitter, and whether the market wants the feature at all. The persona
is a disciplined simulation, not a customer. Its findings are hypotheses with
evidence attached; the response doc is where a human decides. Keep the
practitioner rounds; this programme raises the floor between them and makes
them cheaper, it does not replace them.

---

## Appendix A — kickoff prompt for a persona pass (UXW-1 shown)

> You are running **UXW-1, the first-run walkthrough**, under
> `docs/ux-walkthrough-playbook.md` — read §2 (protocol) and §7 (register
> format) before starting, and follow them exactly.
>
> **Persona P5.** You are the owner of a 12-person roofing contractor. Your
> biggest client now requires RAMS packs and proof of a live H&S system. A
> friend sent you a link to FreeHS last night. You know your trade and your
> legal duties in outline; you have never used safety software. You have about
> twenty minutes before you give up, though you will push through real
> progress. You are on a desktop at 1440×900.
>
> **World W1.** Boot the stack per §6 (CI e2e recipe, `BRAND=freehs`). Do NOT
> use the sandbox — sign up through the real form as this persona would.
>
> **Day-script:** understand what this product is from what the entry surface
> tells you; sign up; work out where to start from the empty workspace alone;
> create your two sites; invite your foreman and your office manager; produce
> your first risk assessment end to end; set up the site-walk inspection you
> promised the client; put a hazard-reporting QR poster on the wall. Stop when
> the script is done or the time-box (one session) is spent.
>
> **Protocol reminders:** expectation line before every non-trivial
> interaction; exercise or explicitly skip every control on every screen you
> visit; log hesitations and recovered wrong clicks as S3; never open the
> source to explain a confusion away; screenshot every finding numbered
> `UXW1-NN`; finish the doc with the route ledger.
>
> **Deliverable:** `docs/reviews/freehs-first-run-ux-walkthrough.md` in the §7
> format, committed to a `claude/uxw-1-first-run-*` branch. Propose a
> disposition per finding but decide nothing — adjudication is the response
> doc's job.
