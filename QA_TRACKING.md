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
| 2026-08-12 | Settings → Notifications — tabella preferenze per utente: 26 tipi di notifica × 2 canali (Email / In-app), gruppi per modulo, brand-gated (FreeHS mostra tutti i 12 gruppi) | ✅ | PR #50 (`c9f4aa4`..`b67fca6`) | Verificato su istanza locale del commit deployato (dominio prod non raggiungibile dal container CI); 52 switch renderizzati, default tutti ON |
| 2026-08-12 | Persistenza di TUTTI i 52 toggle — off→refresh→persistono, on→refresh→persistono | ✅ | PR #50 | Ogni opzione esercitata via UI reale + tRPC; nessuna scrittura persa |
| 2026-08-12 | Gating end-to-end canali (observation_notification, via worker BullMQ): entrambi ON → bell + email; In-app muto → solo email; entrambi muti → silenzio totale | ✅ | PR #50 | Email verificate nel log console del worker; righe bell verificate in DB |
| 2026-08-12 | i18n — /it/settings/notifications con etichette tradotte, nessuna chiave grezza | ✅ | PR #50 | Guard test NP-K01 copre tutte e 10 le lingue in CI |
| 2026-08-12 | Login OTP + sign-up con OTP funzionanti (regressione) | ✅ | PR #50 | Account creato via flusso reale di sign-up |
| 2026-08-12 | Azioni — caricamento file/foto: uploader + galleria in fondo al tab Overview della sidebar E della vista completa | ✅ | PR #52 | E2E 12/12 su istanza locale del commit deployato; png+pdf caricati, tile con nome uploader |
| 2026-08-13 | Formati foto/video da smartphone (HEIC/HEIF/AVIF, 3GP/MKV/HEVC) accettati su tutte le 14 route di upload; HEIC convertito in JPEG all'ingest così l'anteprima funziona | ✅ | PR #54 | E2E 9/9: HEIC Samsung reale (HEVC) caricato da UI azioni e route osservazioni, JPEG verificato sui byte |
| 2026-08-13 | MIME vuoto/octet-stream (webview Android) risolto via estensione file | ✅ | PR #54 | UM-E03; testato E2E con IMG_0042.HEIC octet-stream |
| 2026-08-13 | Video da telefono fino a 100 MB sulle route media (il vecchio limite 25 MB rifiutava pochi secondi di 4K) | ✅ | PR #54 | E2E con mp4 da 30 MB |
| 2026-08-12 | Persistenza allegati dopo refresh; conteggio nel titolo sezione; blob scritti su storage | ✅ | PR #52 | Verificati anche i file su disco (dev .local-storage) |
| 2026-08-12 | Eliminazione allegato (autore) con conferma; voce activity "removed the file" tradotta | ✅ | PR #52 | Regole server: autore o actions.manage (AT-E04) |

## Edge case coperti

| Data | Edge case | Esito | Note |
|------|-----------|-------|------|
| 2026-05-20 | Target score 101 on framework create | ✅ blocked | Browser native `rangeOverflow` validation fires before JS handler |
| 2026-05-20 | Target score decimal (85.5%) on framework create | ✅ accepted | Saved and displayed correctly as "85.5%" |
| 2026-05-20 | Non-existent framework ID in URL | ⚠️ partial | No white crash (app shell intact); shows permanent skeleton instead of "not found" message |
| 2026-08-12 | Email mutata = "gestita": gli stamp di dedupe/escalation dei worker vengono comunque scritti (niente ri-invio quotidiano con destinatari tutti muti) | ✅ | Unit test per ogni worker (es. DOC-J02, PW-J06) |
| 2026-08-12 | Chiavi legacy PF-23 (emailActionReminders/ScheduleMissed/DocumentExpiry) risolte nella nuova matrice | ✅ | NT-E03; una chiave nuova esplicita vince sulla legacy |
| 2026-08-12 | Bell row non dipende più dal dispatcher email (sendEmail null perdeva anche la notifica in-app) | ✅ | Fix in actions/approvals; coperto da NP-AC1 |
| 2026-08-12 | Kind `issue_reported` documentato ma mai scritto — ora cablato | ✅ | NP-IS1 |
| 2026-08-12 | Upload .exe rifiutato (415) con errore visibile; conteggio invariato | ✅ | ACCEPTED_MIME esclude anche SVG (stored XSS) |
| 2026-08-12 | Storage key fuori dal prefisso tenant → FORBIDDEN; azione di altro tenant → NOT_FOUND | ✅ | AT-E02/E03 |

## Regressioni evitate

| Data | Pagina/feature | Esito |
|------|---------------|-------|
| 2026-05-20 | /en/templates | ✅ 200, 3 template rows |
| 2026-05-20 | /en/inspections | ✅ 200, 2 inspection rows |
| 2026-05-20 | /en/schedules | ✅ 200, empty state renders |
| 2026-05-20 | /en/heads-up | ✅ 200, published TEST_ item shows |
| 2026-05-20 | /en/assets | ✅ 200, empty state renders |
| 2026-05-20 | /en/documents | ✅ 200, empty state renders |
| 2026-08-12 | /en/my-work, /en/inspections, /en/actions, /en/settings/profile | ✅ 200 (istanza locale del commit deployato) |
| 2026-08-12 | Campanella notifiche (dropdown + badge non letti) | ✅ elenca la notifica appena creata |
| 2026-08-12 | freehs.software prod: boot pulito (migrazioni ok, Next ready), worker processa tutte le 25 code, HTTP 200, nessun nuovo issue Sentry post-deploy | ✅ |

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
