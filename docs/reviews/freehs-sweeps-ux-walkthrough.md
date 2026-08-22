# FreeHS — SWP-A..G, the cross-cutting sweeps

**Pass:** the mesh (playbook: `docs/ux-walkthrough-playbook.md` §5,
"cross-cutting sweeps"). Run against the lived-in W3 tenant the persona
passes left behind, plus the UXW-2 tenant for the constrained-user walk.
**Date:** 22 August 2026
**Instrument:** `tools/ux-explorer` against a local production build, and
— for the two mechanisable sweeps — new guard tests that run in CI
forever after.
**Result:** **5 findings (1×S2, 2×S3, 2×S4)**, two of them found by
guards written during the sweep rather than by walking. Every finding is
fixed in the same pass.

One-sentence verdict: **the sweeps found less rot in the walked surfaces
than in the *rules about* them — the two defects that mattered most were
a permission gate contradicting its own permission-set copy, and a
missing key that made nine locales print a raw path in the navigation.**

---

## Findings

| ID | Shape | Sev | Sweep | Finding |
| --- | --- | --- | --- | --- |
| SWP-G1 | E-act | **S2** | G — constrained render | `/templates` **silently redirected any non-admin to My profile**, including a **Manager** — whose seeded permission set's own description reads *"Create templates, manage training, manage feature settings."* The shell gated on `grantsAdminAccess`, a Phase-2 simplification ("mirror the /settings pages") that the permission catalogue has since outgrown: `templates.view`/`templates.manage` are real keys, the router enforces both (including a non-manager access-rule branch), and `templates.view` is in the **Standard** set. So the product contradicted its own permission-set copy, and did it by bouncing the reader to an unrelated page with no word of explanation. |
| SWP-E1 | E-words | S3 | E — locale render | The Italian walk showed **`nav.child.fireSafetySettings` rendered as a raw key path in the navigation**. The key existed in `en` only; the other **nine locales** printed the path. The nav binds labels through variables (`t(entry.labelKey)`), which is structurally invisible to K01 — the K02 lesson, in the most-seen chrome in the product. |
| SWP-C1 | E-words | S3 | C — deep link + refresh | A deep link to a non-existent RAMS pack printed the bare guard key **`pack-not-found`**, where every sibling module answers with a sentence ("Not found.", "This risk assessment could not be found."). Four inline renders on that page put raw `error.message` on screen — the BUG-17 class, which already has a guard the page was not listed in. **Three more were found while fixing it — see below.** |
| SWP-B1 | E-words | S4 | B — empty states | With **zero training requirements defined**, the gaps view said *"No gaps. Every required record is in date."* — an unconfigured register presenting itself as a passed audit. This is TR-B13's exact class one level up (that fix distinguished "no gaps" from "nobody is a member of this site"; this one distinguishes it from "nothing is being tracked"), and again the reassuring reading was the wrong one. |
| SWP-A1 | E-act | S4 | A — dead controls | No dead locale links survive in the app today — but the class has shipped twice (the RAMS builder linked-and-never-committed; fire-safety settings unreachable), which is this repo's own bar for pinning a class. Recorded as a finding because the *absence* of a guard was the defect; the guard is the fix. |

## What the sweeps confirmed rather than broke

- **SWP-B, empty states** (7 registers at zero rows): incidents,
  COSHH, assets, documents, briefings and observations all say what the
  module is for and offer the first action — "No substances in the
  inventory yet. Drop a safety data sheet to add the first one." is the
  house standard. Only training misread its own emptiness.
- **SWP-C, deep links** to non-existent records across five modules:
  permits, incidents and actions answer "Not found."; risk assessments
  answers with a full sentence. Only RAMS leaked a key. No route showed
  the known skeleton-that-never-resolves failure.
- **SWP-F, document coherence**: covered by UXW-6 against the permit,
  RAMS-pack and inspection PDFs — see that response doc. The RAMS pack
  prints audit-grade; the inspection report's header was the one machine
  voice left, fixed there.
- **SWP-G, the rest of the constrained walk**: with `templates` repaired,
  a Standard user reaches every register their set grants (permits,
  RAMS, fire safety, COSHH, risk assessments, contractors, documents,
  and the team directory — `users.view` is deliberately in the Standard
  set) and no route dead-ends. The training refusal now explains itself
  and offers the personal wallet (UXW2-10).

## SWP-C1 — the guard was the reason the class survived

Fixing the pack page meant adding it to `inline-error-render.test.ts`,
which is when the shape of that guard became the finding. It is an
**allowlist** — two file paths — written when ~10 sites still carried the
raw pattern, on the reasoning that the list would be widened as they were
fixed. An allowlist can only ever pin what somebody remembered to add to
it, so a scan of the whole app was run instead of trusting it. Two
survivors, both on pages a user reaches:

- **`rams/new`** printed the create failure raw.
- **The briefing capture screen** printed the load failure raw — and,
  worse, its offline-queue banner stored `err.message` in state and
  rendered the variable. That is the same bug wearing a local name, on
  the module's most-used surface, built for a phone with no signal: a
  foreman on a bad connection was shown a kebab-case guard key by the one
  banner whose whole job is to say the briefings are safe and retryable.

All three now resolve through `useServerErrorMessage` with copy in ten
locales, and the guard walks every `.tsx` under `app/` and `src/` instead
of a list. The pointed pin on the two original pages stays, because the
stored-string variant has no general shape to scan for.

The lesson generalises past this guard: **an allowlist guard records
history, a scan states a rule.** Prefer the scan wherever the pattern is
specific enough to avoid false positives — the same reasoning that made
SWP-A a scan and left K02 a pin.

## What the sweeps left behind (the durable half)

Two guards, both proven to bite before being committed:

- **`route-links.dead.test.ts` (SWP-A)** — every literal `/${locale}/…`
  href must have a page behind it. Interpolated segments match any route
  segment, because a value is as often a static route name
  (`/settings/${tab.key}`) as a record id; the stricter reading produced
  three false positives on the first run, and a guard that cries wolf
  gets deleted. Doc comments are stripped (usage examples invent paths).
  Proven by injecting a dead link and watching it name the file.
- **`nav-key-parity.test.ts` (SWP-E)** — every locale carries every
  `nav.*` key `en` has, and no locale carries one it doesn't. Bounded
  namespace, so full parity holds as a rule without the false-positive
  noise that killed the general variable-key guard.

## Not run, and why

- **SWP-D (error injection)** beyond what UXW-2 already covered
  (offline submit on the incident form, which produced the no-signal
  verdict now shipped). A systematic kill-the-network-per-mutation-family
  pass wants the driver to fail *individual* requests rather than the
  whole context — killing the context asks "what happens with no
  network", where the question worth asking is "does the user learn
  **this** write failed, and is their typing still there?"

  **The instrument gained that in this pass** (`failRequests` /
  `clearFailures`: match on a URL substring, answer with a dead
  connection or an HTTP error status, bounded by `times` so a retry can
  be watched succeeding). The pass itself is a separate walk with its
  own findings doc, because it is a different question from the five
  sweeps above and deserves the same expectation-first discipline
  rather than being appended here.
- **SWP-F's export-content diff** (CSV exports build client-side; the
  headless download lands in a temp profile dir). The server-side
  exports, which is where document trust lives, were read directly.
