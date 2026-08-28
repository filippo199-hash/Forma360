# AI Agents — four simulated HSE managers set up and test the platform

**Date:** 28 August 2026 · **Build:** live-equivalent of merge `9c47b2e` (PR #81, the AI Agents platform), production build served locally · **Method:** four persona walkthroughs driven through real Chromium sessions against seeded sandbox workspaces (the UX-walkthrough programme's expectation-before-action protocol), plus a 29-check deterministic audit of exactly what reaches the model (real context builders + prompt assembler against the live database).

**One scope caveat, stated up front:** the local environment's Anthropic API key is a dead placeholder (the model returned 401; production uses its own live key which cannot be read back out of Railway — by design). So this round evaluates the **entire setup and usage experience, every gate, and everything deterministic about guideline adherence** — but not live draft *quality* or conversational behaviour. Those need one input: a valid `ANTHROPIC_API_KEY` for the test environment. The failure UX that the dead key exposed turned out to be one of the most valuable findings of the day.

---

## The four managers

| Persona | Company | Profile | Modules exercised |
|---|---|---|---|
| **Sarah Okonkwo**, 44 | Hargreaves Scaffolding (~60 operatives, occupied hospital/school sites) | Methodical; reads everything, sets up properly, then tries it | Risk Assessment Drafter, end to end |
| **Marcus Bevan**, 58 | Willowbrook Care Group (11 care homes, ~400 staff) | Not technical; reads copy literally; gives up fast | FRA Assistant discovery, Briefing Writer, the Off switch |
| **Priya Sharma**, 37 | Calder Coatings (industrial coatings, heavy COSHH) | Sceptical chemist; probes for invented facts and cut corners | COSHH Drafter governance, knowledge probes, SDS Importer |
| **Tom Gallagher**, 49 | Commercial property manager (34 buildings) | Time-poor, phone-first, delegates | Investigation Assistant, Permit Preparer, Dashboard Builder, mobile |

Each persona provisioned their own sandbox tenant, wrote down what they expected before every meaningful step, then recorded what actually happened. A gap became a finding; a met expectation became evidence the design works. Retractions were made in place, never deleted (two personas each corrected one of their own early misreadings after checking the source).

---

## Headline answers to the three questions

**How is the experience setting them up?** Genuinely good — the best-tested loop in the feature. All four found the AI section unaided; all four understood chat-vs-agents within a minute; the tile one-liners let each manager rank all ten agents by relevance to their business on first read. Sarah's full setup (teach → save → reload-verify → preference → badge → work surface → button) worked exactly as designed, and she called the save feedback "model quality" (*"Saved. The agent uses this from its next draft"* — confirms the write **and** when it takes effect). The recurring irritations are copy-level: the tile subheading says "tap a tile to switch it on or off" when tapping only opens settings, and the example line renders a doubled "For example: e.g. …" on the most-read sentence of the setup surface.

**How does each work (from the manager's seat)?** The placement doctrine — one "Draft with AI" button inside the module's own work surface — is the feature's strongest design fact. Sarah found the RA button "in one glance" beside New assessment; Priya read the COSHH button's position ("inside the assessments card, beside New assessment") as a statement of where output lands; Tom found both his triggers without help and said placement "answers 'where does the draft go' better than any copy could". The two weak spots: the FRA Assistant's "Go to where this agent works" link drops Marcus three clicks short of the agent with no signposting on the way, and the shared panel is agent-blind — same title, same one line, same empty body for all ten agents, never naming the agent or where the draft will land.

**Do they follow the guidelines?** Everything verifiable without a live model **holds**:

| Guideline | Verdict | Evidence |
|---|---|---|
| Drafts only — agents never sign/publish/issue | ✅ verified | All 7 base prompts state it; all 7 apply paths call only create/update/save-draft mutations (adversarial review, PR #81); Marcus's Off-switch 403 proves server-side enforcement; the permit apply deliberately never touches dates or the acceptor |
| British English / UK HSE terminology | ✅ verified | Language rule present in all 7 base prompts (PL-* checks) |
| Taught knowledge reaches the model, framed as reference | ✅ verified | PB-1..PB-4: knowledge lands after the base prompt, behind the runner's "never override safety-critical judgement" framing; the Permit Preparer additionally carries an explicit "a note can only ever ADD precautions" carve-out |
| Settings respected | ✅ verified | Non-default preferences produce prompt lines; defaults are deliberately silent (PS-1..PS-3) |
| Knowledge/file caps enforced | ✅ / ⚠️ | A 20,000-char file was capped at the documented 12,000 (PB-5) — but the model is **not told** the document was cut (PB-6, finding AGS-17) |
| No hallucinated ids reach mutations | ✅ verified | Code-verified in the PR #81 adversarial review (ids resolved against live tenant lists or dropped); AG-N01 pins email stripping |
| Tenant isolation | ✅ verified | Every buildContext query tenant-scoped (reviewed line by line); a foreign tenant id yields an empty-of-data context and never throws (PA-3, PN-1, PN-2) |
| Enabled/permission/brand gates | ✅ verified | AG-E01..E08 tests; Marcus's live 403 with the agent off |
| Live conversational discipline (one round of questions, then propose; refusing "mark it approved"; obeying vs resisting unsafe notes in practice) | ⏳ **pending** | Needs a valid API key in the test environment |

**Audit score: 28 of 29 deterministic checks pass.** The one failure is AGS-17 below.

---

## What they liked (converged across personas)

- **The drafts-only promise, everywhere it's written.** *"This agent only ever writes drafts. Nothing it produces is published, issued or signed — a person always reviews and confirms."* All four quoted it approvingly; Marcus called it "exactly the sentence an HSE lead needs"; Tom matched it with the permit page's own "preconditions, evidence and signatures happen before issue".
- **Plain, job-shaped tile copy.** "Writes a briefing or toolbox talk your team can read in two minutes"; "five-step risk assessment" is the HSE's own method language. No marketing fluff; every line says input and output.
- **Placement inside the work.** The Draft-with-AI button lives where the output lands. Found unaided by all four.
- **The privacy note.** *"What you write and upload here is sent to the AI model whenever this agent runs. Only include material your company is allowed to use — never another company's documents."* Priya (the sceptic) called it "a real, practical caution, not boilerplate"; Tom called it "the sentence a facilities director needs — most products bury it".
- **Save behaviour.** Explicit save, disabled until dirty, state-confirming toast, perfect persistence across reloads — all four verified round-trips.
- **Honest tile state.** Customized and Off badges are readable at a glance (Sarah initially suspected otherwise and retracted after checking).
- **Per-agent example prompts that teach by example.** The scaffolding example made Sarah feel "the product knew my industry"; the Briefing Writer's care-sector example did the same for Marcus; option labels like "Very simple words" and "3 years — recommended" put guidance inside the choice.
- **Mobile is real.** Full-screen panel, thumb-reachable buttons, AI in the bottom tab bar; Marcus judged the 390px settings pages "genuinely usable".
- **Apply guards at the right moment** (code-verified by Tom): overwrite confirms fire exactly when a form holds typed content.

## What they disliked (converged)

- **Silence after failure.** A four-second corner toast, then a panel indistinguishable from one still working — with the placeholder switching to "Ask for changes…" as if a draft exists.
- **The switch that lies twice.** "Agent is on" in bold beside a switch showing off, and a save toast promising "its next draft" right after you stopped it drafting.
- **My admin switch is invisible where staff work.** Template Drafter off, yet "Build with AI" still headlines the create dialog and refusal renders as a network fault with "Try again".
- **The agent-blind panel.** Never names the agent, never says where the draft lands, ~75% empty space that could carry an example brief.
- **Being blamed for the product's failure.** A compliant 700-byte .txt rejected with "Try a PDF, photo or text file under 10 MB" when the object store was down.
- **A typed brief dies silently on close** — worst on a phone, where it was probably dictated.
- **No concept of safety-critical content in the knowledge box** — a control-stripping instruction gets the same green tick as a stationery preference.

---

## Findings register

Severity: **S1** blocks the task / destroys data · **S2** significant friction or misleading · **S3** real friction, workaround exists · **S4** papercut/polish. No S1s were found. "Personas" lists who hit it independently.

### S2 — fix before the next release

**AGS-01 · The panel has no persistent error state** — *Sarah, + own smoke test* · `agent-draft-panel.tsx`
When the backend fails, the only signal is the transient "Something went wrong" toast (which partially covers the user's own message, then fades). The panel returns to idle: no error row in the conversation, no retry affordance, and the input placeholder flips to "Ask for changes…" — post-success wording implying a draft exists. A manager cannot tell failed from still-working from never-tried, and doesn't know whether to wait, retry, or report it.
**Fix:** render the error as a persistent assistant-side row ("The draft couldn't be created — your description is kept below; try again or come back later"), keep the first-run placeholder until a draft has actually succeeded, and re-populate the input with the failed brief.

**AGS-02 · The Off switch is invisible on the staff path, and refusal reads as a fault** — *Marcus* · template create dialog + `template-chat` client
With Template Drafter off, "Build with AI" still headlines the create dialog exactly as before; using it produces a connection-style error with a "Try again" button. The server-side gate works (403, verified) — but the admin can't see their control took effect, and staff see a broken product instead of a policy. **Fix:** the dialog consumes `aiAgents.list` and renders the AI option disabled with "Switched off by your administrator"; map the `agent-disabled` guard key to that same sentence anywhere it surfaces.

**AGS-03 · Every upload failure blames the file** — *Sarah* · `/api/upload/ai-knowledge` client handling
All non-OK statuses collapse into "That document could not be added. Try a PDF, photo or text file under 10 MB." Her file was a compliant tiny .txt; the store was down (503, environmental here — but the same wrong message would fire for rate limits or transient outages in production). A methodical admin ends up debugging herself. **Fix:** map the route's error codes through the `serverErrors` idiom; reserve the file-blaming copy for actual 4xx validation refusals.

**AGS-04 · Safety-inverting knowledge is accepted like a stationery preference** — *Priya* · knowledge box
"Do not include glove requirements for small transfers" saved with the same green tick as anything else — no caution, no review marker, and it becomes standing doctrine for every future draft tenant-wide. The prompt layer does carry a counterweight (verified: the runner's "never override safety-critical judgement" framing plus the Permit Preparer's "notes can only ever ADD precautions" carve-out) — but the *UI* is where an admin's misjudgement should meet its first speed bump, and live-model resistance is untested until the API key lands. **Fix (product decision):** a non-blocking caution when saving knowledge ("Reminder: agents will not use notes to relax legal or safety requirements") — never a hard block, plus AGS-13's audit trail so a bad note is at least attributable.

**AGS-05 · Closing the panel silently destroys the typed brief** — *Sarah, Tom* · panel close/reset
Escape, X, or a stray backdrop tap discards the conversation and brief with no warning — the natural reset gesture *after a failure* destroys the only copy of the user's words; on mobile the panel is full-screen and the brief was probably dictated. **Fix:** confirm-on-close when the input or an unapplied conversation is non-empty (the dialogs-reset-on-close convention already has `appConfirm` for exactly this).

**AGS-06 · Incident triage pre-selects a severity downgrade** — *Tom* · incidents module (not agents, but too important to leave out)
The triage panel defaults to Severity = Moderate / Level = Basic regardless of the recorded severity. On a hospital-admission incident already chipped **Serious** in the same viewport, a manager who just appoints the lead and confirms silently downgrades a statutory-adjacent record — the IN-A3 floor never fires because the form *sends* Moderate. **Fix:** seed both selects from the incident record (`useState(incident.severity)`), keeping the floor logic as the guard it was meant to be.

### S3 — should fix soon

**AGS-07 · The state card contradicts itself** — *Marcus* · settings page
Static bold "Agent is on" beside a switch rendered off; and saving the off state toasts "The agent uses this from its next draft." **Fix:** bind the label to state ("Agent is on/off") and use a state-aware toast ("Saved — this agent is now switched off for your company").

**AGS-08 · "Go to where this agent works" can strand the user** — *Marcus, Priya* · settings header link
For the FRA Assistant it lands on the fire-safety register, three unsignposted clicks from the actual button (register → building → FRA record); the label never names the destination for any agent. **Fix:** name the destination ("Go to Fire Safety") and, for deep-trigger agents, land on or link to the nearest surface that shows the button; a one-line "open a fire risk assessment to use this agent" under the link would have saved Marcus entirely.

**AGS-09 · The panel is agent-blind** — *Tom, Sarah, Marcus* · `agent-draft-panel.tsx`
Same title, same generic line, same empty body for all ten agents. It never names the agent, never says where the draft lands, and "Describe the job in your own words" misfits evidence-driven agents (the Investigation Assistant's evidence is already on file). The reassurance sentences that landed best all live on settings pages a module user may never open. **Fix:** panel header = agent name; body empty-state = the agent's own one-line scope + an example brief (the excellent `knowledgeHint`-style copy already exists per agent); for evidence-driven agents, say what's already attached.

**AGS-10 · "Create draft" on an apply that creates nothing** — *Tom* · permits/new
The panel's Apply reads "Create draft" one click from the form's own "Create draft permit" — but the permit apply only fills the form (deliberately). A manager could Apply and walk away believing a permit exists. **Fix:** per-agent apply labels ("Fill in the form" for the Permit Preparer), or a generic "Apply draft" + the follow-up label doing the disambiguation.

**AGS-11 · The privacy note under-declares** — *Priya* · settings page
It covers "what you write and upload here" while the same page says drafts are built "from the substance's own safety data" — record data is also sent, and the processor is unnamed. For a DPO-adjacent reader that's an incomplete inventory. **Fix:** one added clause: "…along with the relevant records from your workspace (for example this substance's data sheet), to our AI provider."

**AGS-12 · No grounding-missing warning** — *Priya* · COSHH substance page
"Draft with AI" is fully enabled on a substance with **no SDS and no hazard data**, while an amber banner on the same page says the SDS is absent. The one scenario a sceptic most fears — drafting from nothing — carries no caution at the button. **Fix:** when the module's own page already knows the grounding input is missing, echo it in the panel ("No safety data sheet is on file — the draft will rely on your description and company knowledge").

**AGS-13 · Knowledge has no visible authorship or history** — *Priya* · settings page
`updatedBy`/`updatedAt` are already stored on every save and never rendered; an overwritten dangerous note leaves no visible trace. **Fix (cheap first step):** display "Last edited by X on date" from the existing columns; full versioning is a later decision.

**AGS-14 · Admins can't see the delegation model** — *Tom* · settings page
The "only administrators can change this" note renders exclusively to non-admins, so the decision-maker planning a hand-off can't learn from the page that his managers get a read-only view. **Fix:** one admin-visible line: "Everyone in your company can see this page; only administrators can change it."

**AGS-15 · The paid journey has dead copy waiting to embarrass** — *Tom* · Dashboard Builder + entitlements
In launch mode (`DASHBOARDS_FREE_FOR_EVERYONE = true`) no plan communication exists anywhere — defensible generosity. But `settingsPage.planRequired` ("This agent needs the paid plan.") is defined in all ten locales and rendered by **no component**, so when the flag flips, the Upgrade-badged tile opens a settings page that never mentions a plan. **Fix:** wire `planRequired` (plus a "what upgrading buys" line) into the settings page behind the entitlement check now, while it's dormant.

**AGS-16 · The investigation trigger's position understates its reach** — *Tom* · investigation workspace
The button sits in the Root-cause analysis card header, but Apply also writes the chronology, conclusion and findings. **Fix:** move it to the workspace header (or state scope in the panel per AGS-09).

**AGS-17 · Truncated documents are silent toward the model** — *own audit (PB-6)* · `task-agent.ts`
An over-limit document is correctly capped at 12,000 chars (and the settings page marks it "shortened" to the admin) — but nothing tells the *model*, which will confidently cite "your standards document" as if complete. The ADR's "truncation is marked, never silent" currently holds for the UI only. **Fix:** append a one-line marker at the cut ("[document shortened — later sections not included]"). Three lines.

**AGS-18 · The sandbox's "Record and investigate" tile doesn't** — *Tom* · sandbox seeds
All three incident refinements produce byte-identical workspaces (one incident at Reported, no investigation) — the differentiated tile labels promise a choice the seed ignores, and a visitor who chose the investigation tile must complete triage before anything investigation-shaped exists. Same class as the seed-coherence lessons in the sandbox doctrine. **Fix:** `withInvestigation` seeds a triaged incident with an open draft investigation; add the goal assertion.

### S4 — polish batch (one sitting)

**AGS-19** *(Sarah, Marcus, Tom)* — "Tap a tile to **switch it on or off**…" misdescribes tapping; admins hesitate, non-admins are promised a control they lack. → "Each one does a single job. Open a tile to set it up and teach it about your company."
**AGS-20** *(Sarah, Priya)* — "For example: e.g. …" doubled prefix on every agent's example line. → drop the "e.g." from the hint strings (all ten locales).
**AGS-21** *(Sarah, Marcus, Tom)* — Tile-name truncation: "Fire Risk Assessment Assi…" at 1920px; the Customized badge squeezes the customised agent's own name to "Risk Assessm…". → let names wrap to two lines; move badges off the title row.
**AGS-22 — accessibility batch** *(all four + instrument)* — the panel's send button is icon-only with **no accessible name** (blocked role-based automation; screen readers announce a nameless button — `panel.send` already exists as a key); the knowledge textarea and preference selects have no label association (bare "textbox"/"combobox"); the triage severity/level selects likewise; the person picker in single-select mode needs an explicit Done and its popover covers the Confirm button. → aria-labels/htmlFor throughout; single-select closes on pick.
**AGS-23** *(all four)* — `/favicon.ico` 404s on every page load (PWA icons resolve; the bare path doesn't), one console error per navigation and a generic tab icon in manifest-ignoring browsers. → ship a real `/favicon.ico`.

---

## Per-agent status from the walkthroughs

| Agent | Work surface found? | Setup exercised? | Notes |
|---|---|---|---|
| Risk Assessment Drafter | ✅ one glance (register header) | ✅ full loop incl. knowledge + preference persistence | Sarah's deep-dive; error UX findings AGS-01/03/05 |
| COSHH Assessment Drafter | ✅ (assessments card on substance page) | ✅ incl. adversarial knowledge probes | AGS-04/11/12/13; .exe upload correctly refused at both layers |
| RAMS Drafter | — (not in this round's tenants) | catalogue/settings only | Apply paths code-verified in the PR #81 review |
| FRA Assistant | ⚠️ found, but 3 unsignposted clicks deep | partial | AGS-08 is its finding |
| Investigation Assistant | ✅ (RCA card header) | copy + placement judged | AGS-16; module-level AGS-06 discovered en route |
| Briefing Writer | ✅ | ✅ reading-level options praised | "Very simple words" exactly right for ESL care staff |
| Permit Preparer | ✅ (above the form) | ✅ desktop + mobile | AGS-10; best page copy in the journey |
| Template Drafter (legacy) | ✅ (create dialog) | Off-switch enforcement proven | AGS-02 is its finding |
| Dashboard Builder (legacy) | ✅ | plan journey audited | AGS-15; /dashboards/new suggestion prompts praised |
| SDS Importer (legacy) | ✅ via link | settings cadence judged | "3 years — recommended" pattern praised; AGS-08's generic link label applies |

## What could not be tested this round — and what it needs

1. **Live draft quality and conversational guideline adherence** (clarifying-question discipline, refusing "mark it approved", whether the model actually resists Priya's unsafe note in output, knowledge visibly shaping drafts, Apply→refine→Apply cycles): needs a valid `ANTHROPIC_API_KEY` available to the test environment. Everything is staged to run the moment one exists — same personas, same tenants, same instrument.
2. **Knowledge-document extraction end-to-end** (PDF/photo → text → injection): local R2 credentials are placeholders, so uploads 503 before extraction. Unit-level extraction and injection are tested; production R2 is live. Needs either real R2 test credentials or verification against production.

## Method notes and retractions (kept per the programme's rules)

- Two persona findings were self-retracted in place after source checks: Sarah's "tiles never show off-state" (they do — the Off badge) and Marcus's mid-run tab-state confusion (instrument batching, not the app). Tom's first person-picker failure was re-run and confirmed real (the popover genuinely covers the confirm button).
- The nameless send button (AGS-22) was discovered *by* the instrument — role-based clicking timed out — and verified as a genuine a11y defect rather than harness noise.
- The dead API key made the failure path the most-exercised path of the day; treat AGS-01's prominence as the honest result of that, not sampling bias — production outages will present exactly the same screens.
- First simulation attempt was cut short by an account rate-limit window; the full rerun completed cleanly (4 personas, 231 browser-tool calls). Partial first-run observations (upload failure, switch-label bug, the second AI entry point) were all re-confirmed in the full run.

## Fix pass (same day) — disposition per finding

All 23 findings were addressed in the follow-up pass on this branch. Dispositions:

- **Shipped as recommended:** AGS-01 (persistent error row, first-run placeholder until a draft succeeds, brief restored to the input; a 403 mid-flight names the off switch), AGS-02 (create-template dialog consumes the agent flag — "Build with AI" renders disabled with the switched-off sentence; the 403 renders the same sentence in-chat, no more "Try again" on a policy), AGS-03 (upload failures map by server code — file-blaming copy only for genuine file problems; storage/server failures say the file is fine), AGS-05 (close with unsaved words asks first), AGS-06 (triage seeds severity and level from the record; the IN-A3 floor stays the guard), AGS-07 (state-bound switch label + a switched-off save toast), AGS-08 (every agent carries a `whereHint` under the work-surface link, naming exactly where its button lives — ten agents × ten locales), AGS-10 ("Fill in the form" as the Permit Preparer's Apply label via a per-agent override), AGS-11 + AGS-04's copy half (the privacy strip now declares workspace records and the AI provider, and states that notes can never relax legal or safety requirements — only add precautions), AGS-12 (the COSHH panel shows a no-SDS grounding caution supplied by the page), AGS-13 (Last edited by X on date, from the columns that already existed), AGS-14 (admin-visible delegation line), AGS-15 (`planRequired` wired into the settings page behind the entitlement check, live the moment the launch flag flips), AGS-16 (the investigation trigger moved to the workspace header), AGS-17 (a shortened-document marker now reaches the model), AGS-18 (the `withInvestigation` tile seeds a triaged, genuinely started draft investigation, with goal assertions; `recordOnly`/`withRiddor` keep the untriaged report deliberately — their open decisions are triage and the screening), AGS-19/20/21 (subheading rewritten, doubled "For example: e.g." resolved by dropping the prefix, tile names wrap instead of truncating), AGS-22 (send button named; knowledge textarea and preference selects labelled; triage selects get `htmlFor`; single-select person picking commits on pick and closes), AGS-23 (a real multi-size `/favicon.ico`).
- **Partially shipped, remainder deferred:** AGS-04 — the always-visible safety sentence shipped; a save-time interstitial specifically for suspect notes is deferred (a keyword heuristic would cry wolf, and a guard that cries wolf gets deleted). AGS-09 — the panel now names its agent and fills the empty state with the agent's own scope line; bespoke per-agent example briefs are deferred. AGS-13 — full version history deferred; attribution ships.
- **Noted, not in this pass:** the `templates.create.optAiTitle` label ("Build with AI") is English in all ten bundles — a pre-existing translation gap in the template dialog, outside this pass's scope; recorded here so it isn't lost.

## Recommended order of attack

1. **The S4 polish batch + AGS-07 + AGS-20/19/21/23** — one sitting, all copy/aria/CSS, disproportionate trust gain (three of four personas hit the tile-copy line).
2. **The failure loop: AGS-01 + AGS-05 + AGS-03** — one component + one route's error mapping; converts every future outage from "looks broken" to "told me what happened".
3. **AGS-02** — make the admin's Off switch visible where staff work.
4. **AGS-09 + AGS-10** — give the panel an identity; per-agent apply labels.
5. **AGS-17** (three lines) and **AGS-06** (seed triage from the record) — small, high-consequence.
6. Product decisions to schedule: AGS-04 caution, AGS-13 audit trail, AGS-11 privacy clause, AGS-15 paywall copy, AGS-12 grounding warnings, AGS-08 link destinations, AGS-14 delegation line, AGS-18 sandbox seed.
7. **Rerun the live-model half of this simulation once a test API key exists.**
