# FreeHS — UXW-4, the supervisor day

**Pass:** UXW-4 (playbook: `docs/ux-walkthrough-playbook.md` §5)
**Persona:** P2 — Steve Barnes, site supervisor; desktop 1280 in the
cabin; working knowledge (knows the documents, not the statute);
interrupted every three minutes. A real Manager-set seat on Northfield
Works, invited and onboarded through the product.
**World:** W2 (`permit`/`hotWork` tile) grown into **W3** — the world
this pass leaves behind is lived-in: a failed fire check with its
follow-up action, a completed site-walk inspection, two permits worked
to closure/hand-over, a briefed RAMS pack, an observation. Supervisor
setup (fire building, site-walk template, height RA + roof pack) was
built through the real admin UI as world work; frictions met there are
filed below because a working supervisor does that setup too.
**Date:** 22 August 2026
**Instrument:** `tools/ux-explorer` against a local production build of
the UXW-2+3 fix branches (PR #69 head + the UXW-3 fix pass).
**Result:** the full day-script ran to a verdict — logbook fail → auto
action; site walk → completed; hot-work permit raised → SIMOPs
acknowledged → issued → accepted on glass → gated close → clean close;
RAMS gang briefing ×2 with signatures; mid-shift handover round-trip;
shouted observation logged. **8 findings: 0×S1, 0×S2, 3×S3, 5×S4.**

One-sentence verdict: **the safety machinery is genuinely excellent —
every gate this day leaned on (SIMOPs, entrants-inside, residual
coherence, briefing signatures) held and explained itself — while the
authoring surfaces still let a supervisor build the wrong thing
silently, and two or three labels talk in system time rather than
site language.**

---

## Findings

| ID | Shape | Sev | Where | Finding |
| --- | --- | --- | --- | --- |
| UXW4-01 | E-act | S3 | Template editor, "+ Add new" | The page's seeded first question is Yes/No/N-A, but **every question added via "+ Add new" silently defaults to free text**. An author extending the obvious checklist ships a form where three of four questions demand typing — discovered only when the walk is being conducted (on a phone, standing up). Nothing at authoring time signals the divergence; the two creation paths should share a default (or the new row should inherit the previous question's response type). |
| UXW4-02 | E-words | S3 | Inspection title (`{date}` token) | The inspection's own name renders as **"2026-08-22"** — page heading, register row, approvals queue. The `{date}` title-format token prints raw ISO where the house rule (format-date.ts) is `22 Aug 2026`. Every inspection created from the default title format is named in machine time. |
| UXW4-03 | E-words | S3 | Fire building, checks table | A check that has **never been performed** shows status "**OK**" (with "Last done —"). "OK" asserts an inspection nobody has made; a fresh building reads as compliant on day zero. Honest: "Not yet done" (neutral) until the first log, keeping the due date. |
| UXW4-04 | E-act | S4 | RAMS brief page, capture form | The briefer's "**Your name**" field is empty on every capture — Steve typed his own name twice in one briefing session while signed in. Prefill from the session (it is `briefedByName`); keep it editable. |
| UXW4-05 | E-flow | S4 | Permit actions, handover panel | The panel toggle and the submit are **both labelled "Hand over"**, adjacent. Tapping the toggle again (the natural "go on then" tap) closes the panel and silently drops the picked incoming acceptor. Label the submit for what it does ("Hand over to Steve Barnes" / "Confirm handover"). |
| UXW4-06 | E-act | S4 | Permit close-out checks | "**All personnel accounted for and clear**" can be ticked while the entry log two cards up shows "1 inside now — STILL IN". The server rightly refuses (see held-up), but the page lets the supervisor attest something it can itself disprove; the checkbox should surface the live entry-log count inline ("1 person is still logged in") before the round-trip. |
| UXW4-07 | E-words | S4 | Permit signatures, ceremony | **Authorise and Issue sign with a single unconfirmed click; Accept asks "Are you sure?"** — the ceremony is inverted (the code's own comment argues accepting deserves the confirm "on the one that matters", but authorising is the counter-signature the whole regime hangs on). Symmetry: either both get a light confirm or neither does; the current mix reads as accidental. |
| UXW4-08 | E-words | S4 | Contractor page, "Apply <trade> template" | The header offers "**Apply Roofing template**" on a fresh tenant where no requirement template exists; tapping it toasts "No requirement template exists for 'Roofing'. Create one under Requirement templates." The toast is honest, but the button offered an action that could never succeed — hide it, or make it the door to creating the template. |

## What held up

- **Every gate the day leaned on held, and said why.** The SIMOPs
  acknowledgement appeared exactly when a second hot-work permit
  overlapped the first ("I have reviewed the overlapping permits and
  accept the combined risk" — Issue disabled until ticked). The close
  with a man still logged in was refused — all four close-out checks
  ticked — with the best refusal sentence in the product: *"The entry
  log still shows people inside — log their exits before closing."*
  The residual-risk matrix stayed locked until a control was recorded
  (with the rule stated in place), refused a residual above the
  initial, and demanded a written justification for a High residual
  before publish.
- **The failed fire check did everything the doctrine promises**: red
  "Failed — awaiting re-test" state, logbook entry with name and call
  point, and a follow-up action raised, auto-assigned to the logger,
  High priority, due at the next-due date — visible in the nav badge
  before Steve left the page.
- **The on-glass acceptance (UXW3-01's fix) carried a real day's
  permit**: titled dialog, countersign wording, typed signature —
  issued → active in one flow, twice this day.
- **The briefing page briefs**: "What can hurt you, and what stops it"
  leads with the bound High hazard, hold points are marked in the
  step list, and the capture form resets cleanly for the next person
  (NR3-03 behaviour) with real signature strokes stored against v1.
- **Handover semantics are honest**: "The permit returns to Issued
  until the incoming acceptor signs on" — and it did, with Steve's
  accept completing the loop.
- **The site walk's No** went in as typed field notes and the
  inspection completed with document number and site pinned.

## Harness notes (for triage, not findings)

- The driver gained `draw` (signature canvases; scrolls into view
  first — mouse coordinates are viewport-relative) this pass.
- The briefing "They are a" vocabulary is Employee / Subcontractor /
  Agency worker / Visitor / Client representative / Other — my first
  capture guessed "Contractor" and failed; not filed (vocabulary is
  defensible), noted for future scripts.
- `permits/new` accepted a permit with **no site** and every lifecycle
  action (authorise / issue / accept) still worked (observed during
  UXW-3 world-building on the same build). Whether site-scoped permit
  authority should demand a site is a security-posture question for
  triage, not a UX finding.
- Not exercised: interruption-survival sweeps (F5 mid-wizard, tab
  close mid-signature) beyond what the instrument's own
  resume-reloads incidentally proved (conduct answers autosave; the
  wizard's *step position* resets to page 1 on reload — worth a look
  under SWP-C); the scheduled-inspection variant (the walk started
  ad-hoc from the template picker); photo attachment on the walk (no
  object store in the environment).

## Route ledger (this pass)

`/[locale]/fire-safety` + `/new` + `/[buildingId]` (checks, log-check
dialog) · `/[locale]/actions` (auto-raised action) ·
`/[locale]/inspections` + conduct wizard (start → answer → submit) ·
`/[locale]/templates` + editor + publish wizard (world work) ·
`/[locale]/permits/new` + `/[permitId]` (SIMOPs, on-glass accept,
entry log, gated close, handover both sides) ·
`/[locale]/risk-assessments/[id]` (residual gates, justification,
publish) · `/[locale]/rams/new` + `/[packId]` + `/build` + `/brief` ·
`/[locale]/observations` + `/new` · `/[locale]/settings/users`
(invite) + `/[locale]/invite/[token]` (accept).
