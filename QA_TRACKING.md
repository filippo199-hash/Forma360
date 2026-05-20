# QA Tracking — Forma360 production verified features

Production URL: https://forma360.io  
Auth: OTP to filippo199@gmail.com

---

## Funzionalità testate

| Data | Feature | Esito | Commit(s) | Note |
|------|---------|-------|-----------|------|
| 2026-05-20 | Heads Up Publish button → tRPC mutation (was broken Link nav) | ✅ | `82a0089` | Toast + badge change; no 404 redirect |
| 2026-05-20 | Compliance dashboard — score cards (overall %, compliant, due soon, non-compliant) | ✅ | `3d71a62` | Loads 200, cards render 0-state correctly |
| 2026-05-20 | Compliance framework creation — name + type + target score + redirect | ✅ | `3d71a62` | Toast + redirect to detail page |
| 2026-05-20 | Compliance framework detail — rule table, Add rule button, Archive button, F5 persist | ✅ | `3d71a62` + `a3b25f1` | All data survives hard reload |
| 2026-05-20 | Compliance rule creation — name + clause ref + frequency + status column | ✅ | `3d71a62` | Row appears in table immediately after create |
| 2026-05-20 | Compliance Evaluate rule — BullMQ job enqueue via tRPC | ✅ | `3d71a62` + `a1ac047` | "Evaluation job enqueued." toast; job reaches Redis worker |
| 2026-05-20 | Compliance permissions gating (compliance.manage, compliance.frameworks.manage) | ✅ | `a3b25f1` | Add rule / Archive buttons hidden for non-admins, visible for admin |
| 2026-05-20 | Compliance sidebar entry (ShieldCheck icon, active highlight) | ✅ | `3d71a62` | Correct icon, active state on all compliance/* routes |

## Edge case coperti

| Data | Edge case | Esito | Note |
|------|-----------|-------|------|
| 2026-05-20 | Target score 101 on framework create | ✅ blocked | Browser native `rangeOverflow` validation fires before JS handler |
| 2026-05-20 | Target score decimal (85.5%) on framework create | ✅ accepted | Saved and displayed correctly as "85.5%" |
| 2026-05-20 | Non-existent framework ID in URL | ⚠️ partial | No white crash (app shell intact); shows permanent skeleton instead of "not found" message |

## Regressioni evitate

| Data | Pagina/feature | Esito |
|------|---------------|-------|
| 2026-05-20 | /en/templates | ✅ 200, 3 template rows |
| 2026-05-20 | /en/inspections | ✅ 200, 2 inspection rows |
| 2026-05-20 | /en/schedules | ✅ 200, empty state renders |
| 2026-05-20 | /en/heads-up | ✅ 200, published TEST_ item shows |
| 2026-05-20 | /en/assets | ✅ 200, empty state renders |
| 2026-05-20 | /en/documents | ✅ 200, empty state renders |

## Bug risolti in produzione

| Data | Bug | Fix | Commit |
|------|-----|-----|--------|
| 2026-05-20 | `compliance/layout.tsx` mancante → `PermissionsProvider` non montato → tutti `useHasPermission()` restituivano `false` → pulsanti "Add rule" e "Archive" nascosti anche per admin | Creato `apps/web/app/[locale]/compliance/layout.tsx` (pattern identico a heads-up) | `a3b25f1` |
| 2026-05-20 | BullMQ v5 rifiuta `:` nei nomi delle code → tutti e 10 i `QUEUE_NAMES` con formato `forma360:*` causavano "Queue name cannot contain :" al primo enqueue | Rinominati tutti i nomi delle code in formato `forma360-*` (dash) | `a1ac047` |
| 2026-05-20 | Drizzle migration journal 0015_phase8_compliance mancante → migrazione non applicata | Aggiunto entry in `meta/_journal.json` | `60c5613` |

## Record TEST_ in produzione

Questi record sono stati creati dai run di verifica. Prefisso `TEST_<YYYYMMDD>_` per identificazione.
Possono essere eliminati manualmente via UI in qualsiasi momento.

| Data | Record | Modulo |
|------|--------|--------|
| 2026-05-20 | TEST_20260520_ISO 45001 Safety | Compliance framework (Health Safety, target 90%) |
| 2026-05-20 | TEST_20260520_Fire Extinguisher Monthly Check | Compliance rule (inside above framework) |
| 2026-05-20 | TEST_20260520_Decimal Score Framework | Compliance framework (Custom, target 85.5%) |
| 2026-05-20 | TEST_20260520_Comunicazione sicurezza luoghi di lavoro | Heads Up (Published) |
