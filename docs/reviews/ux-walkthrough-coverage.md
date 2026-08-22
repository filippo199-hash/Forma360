# UX walkthrough coverage ledger

**Generated** by `tools/ux-explorer/coverage.mjs` — regenerate after route
changes (existing "Seen in" entries are preserved). 142 routes.

Each pass's findings doc ends with its route ledger; this file is the union.
Record a pass in "Seen in" as `UXW-1(W1)` / `SWP-B` etc. The first cycle's
exit criterion (playbook §8): every in-app route seen at least once, every
register also seen at zero rows and on /it, every render route opened once.

## in-app (130)

| Route | Seen in |
| --- | --- |
| **(home)** | |
| `/[locale]` | UXW-1(W1) |
| **about** | |
| `/[locale]/about` |  |
| **actions** | |
| `/[locale]/actions` | UXW-2(W2), UXW-4(W3) |
| `/[locale]/actions/[actionId]` | UXW-2(W2) |
| `/[locale]/actions/categories` |  |
| `/[locale]/actions/categories/[typeId]` |  |
| `/[locale]/actions/new` |  |
| `/[locale]/actions/settings` |  |
| **ai** | |
| `/[locale]/ai` | UXW-1(W1) |
| **analytics** | |
| `/[locale]/analytics` |  |
| **approvals** | |
| `/[locale]/approvals` |  |
| `/[locale]/approvals/[inspectionId]` |  |
| **assets** | |
| `/[locale]/assets` |  |
| `/[locale]/assets/[assetId]` |  |
| `/[locale]/assets/categories` |  |
| `/[locale]/assets/new` |  |
| `/[locale]/assets/settings` |  |
| **briefings** | |
| `/[locale]/briefings` | UXW-2(W2) |
| `/[locale]/briefings/[headsUpId]` |  |
| `/[locale]/briefings/[headsUpId]/edit` |  |
| `/[locale]/briefings/[headsUpId]/view` | UXW-2(W2) |
| `/[locale]/briefings/new` |  |
| **contact** | |
| `/[locale]/contact` |  |
| **contractor-upload** | |
| `/[locale]/contractor-upload/[token]` | UXW-3(W2) |
| **contractors** | |
| `/[locale]/contractors` | UXW-3(W2) |
| `/[locale]/contractors/[contractorId]` | UXW-3(W2) |
| `/[locale]/contractors/calendar` |  |
| `/[locale]/contractors/gate` | UXW-3(W2) |
| `/[locale]/contractors/templates` |  |
| **coshh** | |
| `/[locale]/coshh` |  |
| `/[locale]/coshh/[substanceId]` |  |
| `/[locale]/coshh/[substanceId]/assessments/[assessmentId]` |  |
| `/[locale]/coshh/lev` |  |
| `/[locale]/coshh/new` |  |
| `/[locale]/coshh/point-of-work` |  |
| **dashboards** | |
| `/[locale]/dashboards` |  |
| `/[locale]/dashboards/[dashboardId]` |  |
| `/[locale]/dashboards/new` |  |
| **data-deletion** | |
| `/[locale]/data-deletion` |  |
| **docs** | |
| `/[locale]/docs` |  |
| `/[locale]/docs/[slug]` |  |
| **documents** | |
| `/[locale]/documents` |  |
| `/[locale]/documents/[documentId]` |  |
| `/[locale]/documents/new` |  |
| **fire-safety** | |
| `/[locale]/fire-safety` | UXW-4(W3), UXW-5/6(W3) |
| `/[locale]/fire-safety/[buildingId]` | UXW-4(W3) |
| `/[locale]/fire-safety/fra/[fraId]` |  |
| `/[locale]/fire-safety/logbook` |  |
| `/[locale]/fire-safety/new` | UXW-4(W3) |
| `/[locale]/fire-safety/peeps/[buildingId]` |  |
| `/[locale]/fire-safety/settings` |  |
| **forgot-password** | |
| `/[locale]/forgot-password` |  |
| **gate** | |
| `/[locale]/gate/[token]` | UXW-3(W2) |
| **incidents** | |
| `/[locale]/incidents` | UXW-2(W2) |
| `/[locale]/incidents/[incidentId]` |  |
| `/[locale]/incidents/[incidentId]/investigation` |  |
| `/[locale]/incidents/new` | UXW-2(W2) |
| **inspections** | |
| `/[locale]/inspections` | UXW-1(W1), UXW-4(W3) |
| `/[locale]/inspections/[inspectionId]` | UXW-4(W3) |
| `/[locale]/inspections/[inspectionId]/report` |  |
| `/[locale]/inspections/[inspectionId]/signatures/[slotIndex]` |  |
| `/[locale]/inspections/[inspectionId]/status` |  |
| **invite** | |
| `/[locale]/invite/[token]` | UXW-2(W2), UXW-4(W3) |
| **my-work** | |
| `/[locale]/my-work` | UXW-1(W1), UXW-2(W2), UXW-5/6(W3) |
| `/[locale]/my-work/acknowledgements` |  |
| `/[locale]/my-work/actions` |  |
| **observations** | |
| `/[locale]/observations` | UXW-1(W1), UXW-4(W3), UXW-5/6(W3) |
| `/[locale]/observations/[observationId]` |  |
| `/[locale]/observations/categories` |  |
| `/[locale]/observations/categories/[categoryId]` |  |
| `/[locale]/observations/new` | UXW-4(W3) |
| `/[locale]/observations/qr-codes` | UXW-1(W1), UXW-2(W2), UXW-3(W2) |
| **permits** | |
| `/[locale]/permits` | UXW-5/6(W3) |
| `/[locale]/permits/[permitId]` | UXW-3(W2), UXW-4(W3) |
| `/[locale]/permits/board` |  |
| `/[locale]/permits/new` | UXW-3(W2), UXW-4(W3) |
| `/[locale]/permits/types` |  |
| **portal** | |
| `/[locale]/portal` |  |
| **pricing** | |
| `/[locale]/pricing` |  |
| **privacy** | |
| `/[locale]/privacy` |  |
| **product** | |
| `/[locale]/product` |  |
| `/[locale]/product/[slug]` |  |
| **rams** | |
| `/[locale]/rams` |  |
| `/[locale]/rams/[packId]` | UXW-3(W2), UXW-4(W3) |
| `/[locale]/rams/[packId]/brief` |  |
| `/[locale]/rams/[packId]/build` | UXW-3(W2), UXW-4(W3) |
| `/[locale]/rams/library` |  |
| `/[locale]/rams/library/[methodStatementId]` |  |
| `/[locale]/rams/new` | UXW-4(W3) |
| `/[locale]/rams/reviews` |  |
| `/[locale]/rams/reviews/[reviewId]` |  |
| **report** | |
| `/[locale]/report` |  |
| **reset-password** | |
| `/[locale]/reset-password` |  |
| **risk-assessments** | |
| `/[locale]/risk-assessments` | UXW-1(W1) |
| `/[locale]/risk-assessments/[assessmentId]` | UXW-1(W1), UXW-3(W2), UXW-4(W3) |
| **schedules** | |
| `/[locale]/schedules` |  |
| `/[locale]/schedules/[scheduleId]` |  |
| `/[locale]/schedules/calendar` |  |
| `/[locale]/schedules/new` |  |
| **security** | |
| `/[locale]/security` |  |
| **settings** | |
| `/[locale]/settings` |  |
| `/[locale]/settings/actions` |  |
| `/[locale]/settings/actions/[typeId]` |  |
| `/[locale]/settings/assets` |  |
| `/[locale]/settings/audit` |  |
| `/[locale]/settings/company` |  |
| `/[locale]/settings/custom-fields` |  |
| `/[locale]/settings/groups` |  |
| `/[locale]/settings/notifications` |  |
| `/[locale]/settings/permissions` |  |
| `/[locale]/settings/profile` |  |
| `/[locale]/settings/risk-matrix` |  |
| `/[locale]/settings/sites` |  |
| `/[locale]/settings/users` | UXW-1(W1), UXW-4(W3) |
| `/[locale]/settings/users/[userId]` |  |
| **sign-in** | |
| `/[locale]/sign-in` |  |
| **sign-up** | |
| `/[locale]/sign-up` | UXW-1(W1) |
| **sites** | |
| `/[locale]/sites` | UXW-1(W1), UXW-5/6(W3) |
| `/[locale]/sites/[siteId]` | UXW-5/6(W3) |
| **templates** | |
| `/[locale]/templates` | UXW-1(W1), UXW-4(W3) |
| `/[locale]/templates/[templateId]` | UXW-1(W1), UXW-4(W3) |
| **terms** | |
| `/[locale]/terms` |  |
| **training** | |
| `/[locale]/training` | UXW-2(W2) |
| `/[locale]/training/compliance` |  |
| `/[locale]/training/matrix` |  |
| `/[locale]/training/me` |  |
| `/[locale]/training/person` |  |
| `/[locale]/training/person/[userId]` |  |
| `/[locale]/training/requirements` |  |
| **try** | |
| `/[locale]/try` |  |

## public / unlocalised (3)

| Route | Seen in |
| --- | --- |
| `/offline` |  |
| `/s/[token]` | UXW-3(W2) |
| `/scan/[token]` | UXW-1(W1), UXW-2(W2), UXW-3(W2) |

## render-internal (SWP-F) (9)

| Route | Seen in |
| --- | --- |
| `/render/dashboard/[dashboardId]` |  |
| `/render/drill/[drillId]` |  |
| `/render/fra/[fraId]` |  |
| `/render/incident/[incidentId]` |  |
| `/render/inspection/[inspectionId]` |  |
| `/render/night-pack/[buildingId]` |  |
| `/render/permit/[permitId]` |  |
| `/render/rams/[packVersionId]` |  |
| `/render/risk-assessment/[assessmentId]` |  |
