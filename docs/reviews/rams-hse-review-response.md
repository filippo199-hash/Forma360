# RAMS (Risk Assessment & Method Statement) — HSE expert review response

**Review:** [`rams-hse-expert-review.md`](./rams-hse-expert-review.md)
(four practitioners — Tom Whitfield, Priya Nair, Dr. Aisha Bello,
Marcus Lindqvist; 4 August 2026)
**Disposition date:** 4 August 2026

The review's own summary was that the server work was excellent and the
product still did not function — a delivery failure rather than a design
one. That reading was correct, and one detail made it literally true:
**the builder route existed on disk and had never been committed.**
Commit `0cee5d2` added its 227 i18n keys and both entry points, and left
the file itself unstaged. Whitfield wrote *"someone should find out
whether that file exists on a machine somewhere before it gets
rewritten"* — it did, and recovering it rather than rewriting it closed
RS-A1 in a single commit with the reviewers' own design intact.

Every finding RS-A1 to RS-A14 is addressed. Nothing is deferred.

## Per-finding disposition

| ID | Sev | Disposition | What changed |
|----|-----|-------------|--------------|
| RS-A1 | **Critical** | **Fixed** | `apps/web/app/[locale]/rams/[packId]/build/page.tsx` shipped (commit `9550656`). It was written, never committed — the recovered file carries the live issue-gate checklist, ranked binding suggestions, the structural step editor with per-step hazard references and hold points, PPE, scope, the emergency block and 900 ms autosave. That one file restores every procedure the review listed as unreachable: `packs.saveDraft` / `update` / `bind`+`unbindRiskAssessment` / `bind`+`unbindCoshh` / `add`+`removeDocument` / `suggestBindings` / `getVersion`. A pack can now be created → bound → drafted → issued → briefed end to end. |
| RS-A2 | **Critical** | **Fixed** | `app/s/layout.tsx` mounts `TRPCProvider` + `Toaster`, matching `app/scan/layout.tsx`. The client acceptance view no longer throws on arrival; accept and request-changes both work. |
| RS-A4 | **Critical** | **Fixed** | The reviews page gained an intake form calling `reviews.submit`: contractor (searchable from `contractors.list`), pack title, site and work description. The receive-only persona is reachable — Dr. Bello's entire use case ran on a queue that could never be filled, and now fills. |
| RS-A3 | High | **Fixed** | `packs.get` projects the `clientLinks` select explicitly, dropping `token` (and `tenantId`). The opaque share token is no longer readable by every `rams.view` holder. RS-A14's recoverability need is served instead by `client.getLinkUrl` — one link, `rams.issue` only, never for a revoked link. |
| RS-A5 | High | **Fixed** | Re-issue is a signing event, not a button. The panel shows the attestation in full, requires a fresh tick, takes an optional re-issue note, and warns with the exact count of briefings the new version will invalidate. The hardcoded `confirmAttestation: true` is gone. |
| RS-A6 | High | **Fixed** | Two halves. The brief screen mounts the existing `SignaturePad` and passes `signatureData`, so the PDF's "Signed" column stops being structurally "—". And the frozen snapshot now carries hazards: `PackVersionRiskAssessment.hazards` (hazard, who is at risk, controls, residual band) is written at issue and rendered both on the brief screen and in PDF §2, which had been metadata-only. A briefing that shows no hazards is not a briefing. |
| RS-A7 | High | **Fixed** | Three real bugs in the offline queue. The flush sent the whole queue and removed the whole queue, so an entry added mid-flight was dropped and a retried entry could brief someone twice; optimistic success masked both. Now: a `flushing` ref guards re-entry, the flush operates on a snapshot and removes only what it actually sent, success is no longer optimistic, and a 20 s timer retries while anything is queued. `clientRef` — accepted by the router and previously discarded — is stored, with a partial unique index on `(pack_id, client_ref)` and `onConflictDoNothing` (migration `0070`), so a duplicate send is idempotent at the database rather than by hope. |
| RS-A8 | Med | **Fixed** | The source vocabulary now lives once in `apps/web/src/lib/action-sources.ts`; the list, board, filter, detail page and slide-over panel all read it. RAMS actions are labelled "RAMS pack" and filterable. The accompanying test scrapes the router's `sourceType` enum, so a server-side source the hub cannot label is a failing test rather than a wrong label. That test immediately found a wider live bug: the five brand-module chips (risk assessment, COSHH, all three fire ones) were keyed under `actions` while the code resolves against `actions.list`, so every one of them had been rendering as a missing key. Moved, ten locales. |
| RS-A9 | Med | **Fixed** | Same shape, same treatment: `apps/web/src/lib/search-categories.ts` holds the Cmd-K category table, with a test that scrapes the search router's return keys. RAMS results are rendered instead of dropped, and the PF-6 class of regression cannot recur silently. |
| RS-A10 | Med | **Fixed** | `publicDecide` refuses a second decision (`CONFLICT link-already-decided`), refuses a pack that is not `issued` (`FORBIDDEN pack-not-issued`), and re-asserts `decision = 'pending'` in the UPDATE's WHERE so two concurrent submissions cannot both win. `packs.cancel` revokes outstanding client links exactly as `withdraw` does. `publicGet` strips `tenantId` from the public payload. |
| RS-A11 | Med | **Fixed** | `ramsGateError` moved into `packages/shared/src/permits.ts` beside `gasGateError`, taking a `PermitRamsLink` describing what the permit's link resolves to. The router loads the facts and delegates; `permits.get` runs the same helper and returns the verdict. The safe-system-of-work card names the exact blocker and the Issue button is disabled until it clears — the blocker is visible before Issue, not when the issuer is already standing at the job. PW-E11 covers own-pack status, both accepted outcomes and the validity window in all three directions. |
| RS-A12 | Med | **Fixed** | `rams/new` reads `?methodStatementId=` (and `?fromPackId=`), so the library's "Start pack" no longer discards the selection. And the library is no longer read-and-clone: the new editor at `rams/library/[methodStatementId]` covers scope, the sequence of operations (add / reorder / delete, PPE, hold points), the emergency block and the logistics block, autosaves, and publishes a version — reaching `methodStatements.saveDraft` and `publish`, which had no caller. |
| RS-A13 | Med | **Fixed** | The author declaration renders through `gate.attestationText` in all ten locales, with an explicit line in the nine translated ones stating that the English wording is what is recorded and printed (the record stays identical everywhere — ADR 0015). The eight review-checklist labels resolve through `reviewChecklist.<id>`, which is the indirection the constant's own comment always claimed. `formatBand` replaces `text-transform: capitalize`, so the client-facing PDF prints "Very high" rather than "Very_high". PDF §2 carries per-RA hazard tables (see RS-A6). |
| RS-A14 | Low | **Fixed** | The `pendingClientAcceptance` chip filters the register (new `packs.list` predicate) instead of being an inert span beside chips that all filter. CSV export, library seed and duplicate, pack issue / withdraw / re-issue, and client link create / revoke all surface their errors — a save that fails silently is a document the author believes is written and is not. A live share URL is recoverable via `client.getLinkUrl` and copyable, and each live link has a Revoke control. `renderPdf` resolves the version through the pack in both directions, so a caller-supplied `packVersionId` can never render one pack's content under another pack's identity. `tenantId` no longer reaches the public client view. |

## The structural finding

Marcus Lindqvist's point was that **no test touched a web path**, which
is why an uncommitted page and a missing i18n key both reached
production. Two new test files answer that directly, and both are written
so they fail on the *next* instance rather than only this one:

- `apps/web/src/lib/action-sources.test.ts` — reads the actions router's
  `sourceType` enum from source and asserts the hub's table matches it
  exactly, then resolves every chip and sentence key in all ten locales.
- `apps/web/src/lib/search-categories.test.ts` — reads the search
  router's return keys and asserts the palette renders every one, then
  resolves every category label in all ten locales.

The mis-named RS-E17 router test — *"resolves a label and a working
back-link in the actions hub"*, which asserted type, href, reference and
title but never a label — is renamed to what it actually covers. The
label half now lives in the web test, where it belongs.

## New tests

| Test | Covers |
|------|--------|
| `permits.test.ts` PW-E11 | `ramsGateError` — own-pack status, both accepted outcomes, validity window in all three directions, and the no-link case |
| `rams.test.ts` RS-A14 | Register filter to packs awaiting a decision; the filter drops a pack once the client decides; `renderPdf` refuses another pack's version and still renders its own |
| `rams.test.ts` client links | `getLinkUrl` re-reads a live URL, refuses a revoked link, and is refused to a user without `rams.issue` |
| `action-sources.test.ts` | 8 tests — enum parity with the server, distinct labels, key resolution in ten locales, placeholder correctness, RAMS specifically |
| `search-categories.test.ts` | 4 tests — category parity with the server, unique keys and base paths, label resolution in ten locales |

## What was protected

No changes were made to the issue-gate ordering, snapshot-on-issue, the
`withdraw` link revocation, PDF gating, the HMAC render route, the AI
tool wiring, the nav model's brand + permission gating, or the eighteen
spec'd RS-E edge cases. `suggestBindings` remains deterministic — a rule,
not a model, per §12 of the spec.

## Migration

`0070_rams_briefing_client_ref.sql` — adds `rams_briefings.client_ref`
and a partial unique index on `(pack_id, client_ref) WHERE client_ref IS
NOT NULL`. Forward-only; existing rows are unaffected (the column is
nullable and the index only constrains non-null refs).
