# UXW-5/6 manager-and-audit walkthrough — response & fix record

**Findings doc:** `freehs-manager-audit-ux-walkthrough.md` (4 filed,
3 standing after triage)
**Adjudication:** product owner, 22 Aug 2026 — *implement all the fixes*
**Fix pass:** this branch, shipped with the UXW-4 pass.

| ID | Sev | Fix | Where |
| --- | --- | --- | --- |
| UXW56-01 | **S2** | The site question is now **requirable**: `isResponseRequirable` accepted every answer type that round-trips through `responses` except `site`, so a title-page site marked required never blocked submit. A completed walk shipped with `site_id` NULL — a blank Site on the printed report, invisible to every site-scoped view and compliance card, with nobody told. The server-side mirror into `inspection.siteId` already existed; only the gate was missing. Pinned by a new `conduct-state.test.ts` case (unanswered blocks, answered clears). | `inspections/conduct-state.ts` (+`.test.ts`) |
| UXW56-02 | S3 | The report header speaks English: `formatDateTime` for "Completed" (it printed a raw ISO timestamp **with milliseconds** on a document people file), house `STATUS_LABELS` for the lifecycle enum, and — via UXW4-02 — a title that is no longer an ISO date. | `print-layout.tsx`, `packages/api/src/routers/inspections.ts` |
| UXW56-03 | — | **Retracted at triage** (instrument error — the aria dump was truncated before the card's stat list; the card does render "1 check failed"). Recorded, not deleted, per the FS-G05 rule. | — |
| UXW56-04 | S4 | The permits register names the absence — "No site" rather than a bare "—", which reads as "column not applicable" rather than "this permit is attached to nothing". | `permits/page.tsx`, bundles |

## Carried in the same pass (sweeps)

| ID | Fix | Where |
| --- | --- | --- |
| SWP-B1 | The training gaps view distinguished "clean" from "unconfigured": with zero requirements **defined** it said "No gaps. Every required record is in date." — an empty register presenting as a passed audit, TR-B13's exact class one level up. It now says nothing is being tracked and links to defining requirements. | `packages/api/src/routers/training.ts`, `training/page.tsx`, bundles |
| SWP-E1 | The `/it` walk found `nav.child.fireSafetySettings` rendering as a **raw key path in the navigation of nine locales**. Key added ×9, and a new `nav-key-parity.test.ts` pins full parity both ways (missing keys and dead keys) — the nav binds labels through variables, the hole K01 structurally cannot see (the K02 lesson). The namespace is small and bounded, so a full-parity rule holds without the false positives that killed the general variable-key guard. | bundles, `apps/web/src/lib/nav-key-parity.test.ts` |

## Deliberately not done

- **A site-less permit cannot be given a site after issue** (the other
  half of UXW56-04). Attaching a site to a live permit changes which
  site's authority governs it — a lifecycle question, not a label one.
  The register now at least names the gap; the repair belongs with the
  site-scoping posture question already parked in the UXW-3 harness notes.

## Verification

- `pnpm typecheck` + `pnpm lint` green; targeted suites green (see the
  UXW-4 response for the list); full `pnpm test` before merge, read from
  the log's exit marker rather than a task summary.
- Explorer re-verification on a production build: a site-required
  template refuses to submit until the site is picked, and the resulting
  report prints both the site and a house-format header.
