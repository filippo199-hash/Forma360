# FreeHS — UXW-3, outside the fence

**Pass:** UXW-3 (playbook: `docs/ux-walkthrough-playbook.md` §5)
**Persona:** P4 — Davor Ilić, director of a two-man roofing firm; no seat,
arrives **only** by link or QR; phone 390×844 (laptop for nothing — every
link reached him on site); suspicious of links: opens them twice, forwards
them, lets them go stale.
**Worlds:** W2 built live through the real admin UI — tenant A
(`rams`/`buildPack`: RA-0001 authored + published in-product, pack
RAMS-000001 issued v1, client link, contractor record with two blocking
document requirements, upload token, site QR, gate kiosk token, authorised
visit), tenant B (`permit`/`hotWork`: a second permit raised with a named
**external** acceptor — the BUG-05 flow — through preconditions, in-range
gas reading, authorise, issue).
**Date:** 21 August 2026
**Instrument:** `tools/ux-explorer` against a local production build of the
UXW-2-fix branch (PR #69 head — all UXW-1/2 fixes in).
**Result:** the RAMS accept round-trip, both `/scan` round-trips and the
kiosk check-in journey ran to their verdicts; the **on-glass permit
acceptance could not be completed by the instrument at all** (native
`window.prompt`), and the insurance upload ran to the product's failure
rendering (object store absent in the environment — see harness notes).
**11 findings: 2×S2, 6×S3, 3×S4, 0×S1.**

One-sentence verdict: **the token surfaces mostly hold their weight —
public pack, scan and kiosk journeys all reach real verdicts — but the
outward-facing voice keeps slipping into the internal one (wrong requester
name, staff-voice refusals, ISO timestamps), and the single most
safety-critical outside moment — a contractor signing a hot-work permit on
glass — hangs on the one UI primitive this codebase already banned.**

---

## Findings

| ID | Shape | Sev | Where | Finding |
| --- | --- | --- | --- | --- |
| UXW3-01 | E-act | **S2** | `permits/[permitId]` acceptance + refusal; 2 copy-link sites | The external acceptance signature — the BUG-05 flow's closing moment — is captured through **`window.prompt`** (`page.tsx:1182`), and the refusal reason likewise (`:1216`). The NR3-05 pass banned `window.confirm` because a native dialog froze a page; prompts are the same class: auto-suppressed in kiosk/WebView/embedded contexts (the instrument's context returns `null` instantly — the button reads as **dead**, nothing sent), unstylable, and zero-ceremony for a **legal counter-signature** (the internal accept two lines down gets `appConfirm` with the comment "ask on the one that matters"). Two further prompt survivors show copy-links (`contractors/gate/page.tsx:92`, `contractors/[contractorId]/page.tsx:155`). |
| UXW3-02 | E-words | **S2** | RAMS pack page, client-links list | The register row reads "**Accepted Priya Shah — Northgate Facilities** v1 · … 'Fire watch duration noted…'" — but the person who signed was **Davor Ilić, Ilić Roofing & Cladding Ltd** (typed into the decision block; the public page correctly shows "By Davor Ilić"). The row is labelled with the link's *contact name* and never shows the *signatory*, so the manager's evidence view attributes a safety-critical acceptance to someone who never made it. |
| UXW3-03 | E-flow | S3 | `/s/[token]` revoked | Re-opening the link after revocation lands on the **bare Next.js 404** ("This page could not be found.") — no brand, no "this link was withdrawn by <company>", no way forward. The sibling surfaces both have designed dead-ends (`contractor-upload`: "This upload link is invalid or has expired."; `/scan`: "This QR code is no longer active… contact the site administrator."). For the person who yesterday **signed** this document, a 404 reads as "they deleted the evidence". |
| UXW3-04 | E-words | S3 | `/[locale]/contractor-upload/[token]` | The intro names the wrong party: "**Ilić Roofing & Cladding Ltd has requested the documents below.**" Ilić Roofing is the *contractor being asked*; the requester (the workspace) is never named. For a link-suspicious contractor the page's authority framing is inverted on its first line. |
| UXW3-05 | E-words | S3 | contractor-upload, failed upload | A failed upload surfaces as a bare "**Something went wrong.**" toast — no filename, no "your document did not reach us", no retry or fallback ("email it to…"). The incidents pass established the rule (IN-A4: a dropped file must never look like anything but itself, named); the one surface used exclusively by outsiders got the generic toast. (The failure itself was the environment's absent object store — the *rendering* is the product's.) |
| UXW3-06 | E-flow | S3 | `/[locale]/gate/[token]` zero state | The kiosk with no visits says "**No visits scheduled right now.**" and stops. The person most likely to stand at a gate kiosk is an unbooked contractor; there is no walk-in affordance, no "ask at reception", no human fallback line — a dead end at the fence. |
| UXW3-07 | E-words | S3 | gate kiosk, non-compliant check-in | The visit card flags "**Not compliant**" with no explanation, and tapping it alerts: "**This contractor is not compliant — check-in needs a recorded override reason (or send them to the site office).**" — staff-voice, third person, on the contractor-facing screen. Davor reads about himself as "them", is told nothing about *what* is missing (his two blocking documents), and gets no on-screen next step. |
| UXW3-08 | E-words | S3 | `/s/[token]` pack page | Every timestamp is raw ISO: "issued **2026-08-21 23:28**", author-declaration date "**2026-08-21 23:28**", decision "When **2026-08-21 23:33**" — on the product whose house rule (format-date.ts, born of the RIDDOR "8/6" incident) is `21 Aug 2026`. The one document shown to outsiders is the one that ignores the convention. |
| UXW3-09 | E-words | S4 | `/s/[token]` pack sections | Section numbering renders **1, 2, 4, 5, 6, 8, 9** — empty sections (3 · substances, 7) are omitted *but keep their numbers*. In a safety document a numbering gap reads as missing pages, precisely wrong for the suspicious reader. Either render the empty sections with "None for this job" or renumber. |
| UXW3-10 | E-act | S4 | `/s/[token]` post-accept | At the moment of acceptance the page swaps in one sentence ("This pack has been accepted. Thank you.") — the full decision record (name, organisation, when, comment) appears only after a manual reload. The receipt exists; the moment that most wants it doesn't show it. |
| UXW3-11 | E-words | S4 | `/scan/[token]` description field | The description placeholder still reads "…help us understand **the observation**" — the UXW2-02 de-jargoning covered the heading and thanks screen but not this line. |

## What held up

- **The public pack is genuinely readable on a phone** — job details,
  bound-RA tables with residual ratings, the full sequence with hold
  points and PPE per step, emergency arrangements, the author declaration.
  A contractor can actually check what his lads are signing up to.
- **The decision block behaves**: both buttons held disabled until
  name + organisation; the recorded decision is version-anchored; the
  forwarded copy (fresh profile) shows the decided state and offers **no
  second decision** (RS-A14 guards holding in the field).
- **`/scan` end to end, twice**: plain form, reference receipt
  (OBS-000001), "Report another" resets cleanly to a second submission —
  and the UXW-2 copy fixes are live on the frame ("Report: Hazard").
- **The kiosk's happy path is honest**: the visit card names the firm and
  the job, check-in is one tap (when compliant), and the compliance gate
  *did* refuse an override-less check-in — the enforcement is right, only
  the words face the wrong person.
- **The permit issue gates all bound live** during world-building: 7/7
  preconditions demanded, the gas reading validated against the type's
  LEL range with freshness noted, authorise/issue signatures stamped and
  logged in the history.
- **Invalid tokens** on `/scan` and `contractor-upload` both land on
  designed, branded dead-ends (UXW3-03 is about `/s` lacking the same).

## Harness notes (for triage, not findings)

- The environment has no object store (R2 credentials are fakes; MinIO
  install egress-blocked), so every upload path is verified **to the
  attempt boundary** — the UXW3-05 toast is the product's own rendering of
  a 503. The upload happy path (file lands, requirement turns compliant,
  kiosk flag clears) remains unexercised; UXW-4 should re-try if storage
  becomes available.
- `window.prompt`/`confirm`/`alert` are auto-dismissed by the instrument
  (as by kiosk browsers) — UXW3-01's "dead button" observation is real for
  those contexts, and at run time it meant the acceptance journey could
  not be completed even as evidence. (During the fix pass the same journey
  completed through the new dialog — see the response doc.)
- The "opens it three weeks late" P4 variant needs server-side clock
  travel; not exercised. Revocation stood in for expiry on `/s`.
- The forwarded-link variant ran for `/s` (fresh profile: decided state,
  no re-decision). Forwarding the *upload* link was skipped — same class.
- Driver gained `fillByLabel` / `clickByRole` / `selectByLabel` this pass
  (label-associated fields and Radix portals were undriveable by CSS).
- Internal-side observations parked for UXW-4's ledger (found while
  world-building, outside P4's frame): "Apply Roofing template" offers an
  action that cannot succeed until a template exists (toast explains);
  authorise/issue sign with **no** confirm while accept asks "Are you
  sure?" (ceremony inverted); client-link **Revoke** fires with no
  confirm; `permits/new` was left with no site set and every lifecycle
  action still worked (site-scoping of permit authority worth a look).

## Route ledger (this pass)

`/s/[token]` (read, accept, re-open, forwarded, revoked) ·
`/[locale]/contractor-upload/[token]` (+ invalid) · `/scan/[token]`
(submit ×2, another, invalid) · `/[locale]/gate/[token]` (zero state,
visit card, non-compliant refusal) · `/[locale]/permits/new` +
`/[locale]/permits/[permitId]` (external-acceptor create → issue → the
prompt wall) · `/[locale]/rams/[packId]` + `/build` (bind, issue, client
link, revoke) · `/[locale]/risk-assessments/[id]` (author → publish) ·
`/[locale]/contractors` + `/[contractorId]` + `/gate` (record,
requirements, visit, kiosk link) · `/[locale]/observations/qr-codes`.
