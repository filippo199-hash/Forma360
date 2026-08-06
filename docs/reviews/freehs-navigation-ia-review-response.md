# Navigation & information architecture — review response

**Review:** [`freehs-navigation-ia-hse-expert-review.md`](./freehs-navigation-ia-hse-expert-review.md)
(four practitioners, 3 August 2026)
**Disposition date:** 4 August 2026

The panel's converged proposal is implemented in full, with one addition
from the product owner: **RAMS joins Records & registers**, which the
review predates.

## The menu as it now ships

```
  ▪ Dashboard
  ▪ Ask AI

  ＋ Report                     hazard · incident · permit · inspection

  ── FOR ME ──────────────────
  ▪ My actions            ③
  ▪ My acknowledgements   ①

  ── DO THE WORK ─────────────
  ▪ Inspections                 ▸ Templates · Schedules · Calendar · Approvals ②
  ▪ Hazards & near misses       ▸ QR codes · Categories
  ▪ Incidents             ②
  ▪ Permits               ⑤     ▸ Live board · Type catalogue
  ▪ Actions                     ▸ Categories

  ── RECORDS & REGISTERS ─────
  ▪ Risk assessments      ②
  ▪ COSHH                       ▸ Point of work · LEV
  ▪ Fire Safety           ④     ▸ Logbook
  ▪ RAMS                        ▸ Method statement library · Contractor reviews

  ── THE ORGANISATION ────────
  ▪ Sites
  ▪ Assets                      ▸ Maintenance · Categories
  ▪ Contractors                 ▸ Gate · Calendar
  ▪ Documents
  ▪ Briefings

  ⚙ Settings
```

Twenty flat rows became **17 rows in four named groups**, with a
two-row personal block at the top and everything previously orphaned
now nested under the parent it belongs to. Nothing was removed.

## Priority table disposition

| # | Change | Status |
|---|--------|--------|
| 1 | Group the modules; nest Templates/Schedules/Approvals under Inspections and Maintenance under Assets | **Done.** Four groups (`groupForMe`, `groupDoWork`, `groupRecords`, `groupOrg`) declared in `nav-model.ts`. Nesting required `activeNavItem` to resolve a child route back to its parent, since these children are top-level paths rather than sub-paths — without it, standing on `/approvals` lit nothing up. |
| 2 | Personal block: My actions · My acknowledgements · ＋Report | **Done.** Both are real routes (`/my-work/actions`, `/my-work/acknowledgements`) rather than query strings, so each lights up on its own and can be linked to. Ungated — they can only ever show rows addressed to the caller. "My acknowledgements" now genuinely means what it says: risk-assessment sign-offs were added to the queue alongside briefings. |
| 3 | Needs-attention counts on items and on collapsed group headers | **Done.** One batched endpoint (`myWork.counts`) returns the caller's own queues *and* per-module attention numbers — incidents untriaged or past their RIDDOR deadline, permits at or near expiry, risk assessments and fire records past review. Brand- and permission-gated server-side: a module the deployment doesn't ship costs no query, and a module the caller can't view returns nothing. Group headers aggregate their items' numbers and show the total **only while folded**, per the panel. |
| 4 | Collapsible groups, state persisted | **Done.** Per-group fold state in `localStorage`, defaulting open. Folded, not hidden. |
| 5 | Renames + route the report decision in-flow | **Done.** *Heads Up → Briefings*, *Observations → Hazards & near misses*, in all 10 locales. The ＋Report menu labels carry the distinction ("Nobody was hurt" / "Someone was harmed or made ill"), and a "Not sure which?" route opens `/report`, which asks the single question that separates them and sends the reporter to the right module. The menu is no longer where that judgement is made. |
| 6 | Declare nav group + weight in the module catalogue rather than array order | **Partially done — deliberately.** The group is declared once, in `nav-model.ts`'s blueprint, which is the single unit-tested source both the sidebar and the drawer render. Moving it into `packages/shared/src/brand.ts` would put a web-presentation concern in a package the worker and the API also import, so the declaration stays in the model. Marcus's substance — one place, not inferred from JSX — holds; his suggested file does not. |

## What the panel asked us not to do

No user-customisable hiding, no further permission gating, no
mega-menus, nothing removed. All respected.

## Accessibility

Groups render as `<section aria-labelledby>` → `<h2>` → `<ul>`, with the
heading itself the fold control carrying `aria-expanded`. The grouping
is now real for a screen reader rather than visual only, which is where
Bello's tab-order concern is actually resolved.

## Verification

`nav-model.test.ts` (NAV-E01..E10) updated for the new IA: the brand
gate covers RAMS both ways, the personal block survives every
permission gate, the two personal doors never light up together, badges
name their own queue and Approvals keeps its count while nested, and the
tab bar fills from the personal block first. Full workspace suite green.

## Known gap, unrelated to this change

The non-English locale files are ~213 keys short of English, from an
earlier wave. Every key this change introduced is complete in all 10
locales; some older platform UI still falls back to English.
