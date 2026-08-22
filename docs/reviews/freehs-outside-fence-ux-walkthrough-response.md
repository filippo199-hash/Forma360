# UXW-3 outside-the-fence walkthrough — response & fix record

**Findings doc:** `freehs-outside-fence-ux-walkthrough.md` (11 findings)
**Adjudication:** product owner, 22 Aug 2026 — *implement all the fixes*
**Fix pass:** this branch. Every disposition below is `fix`; the notes
record the shape each fix took and where it lives, so nobody re-litigates
the choices.

| ID | Sev | Fix | Where |
| --- | --- | --- | --- |
| UXW3-01 | S2 | New `appPrompt()` — the text-input sibling of `appConfirm()` (same singleton-provider pattern, promise-resolving dialog, native fallback when unmounted; NR3-05 doctrine extended to prompts). All four `window.prompt` survivors converted: the external permit **acceptance signature** gets a titled dialog naming the acceptor with the countersign wording as its description (min 2 chars); the permit **refusal reason** gets a textarea dialog (min 3); both contractor **copy-link fallbacks** show the URL in a real dialog input. Zero `window.prompt` calls remain in the app. | `ui/app-prompt.tsx` (new), `[locale]/layout.tsx` (provider), `permits/[permitId]/page.tsx`, `contractors/gate/page.tsx`, `contractors/[contractorId]/page.tsx` |
| UXW3-02 | S2 | The client-links row now names the **signatory**: a decided link renders "signed by {name} — {organisation}" beside the contact it was sent to. The router already shipped `acceptedByName`/`acceptedByOrganisation` — the row never rendered them. Two component tests pin it (decided row shows the signer; pending row shows none). | `rams/client-link-row.tsx` (+`.test.tsx`) |
| UXW3-03 | S3 | Revoked, expired and unknown `/s` tokens land on a designed, branded dead-end ("This link is no longer active." + ask-for-a-fresh-link guidance, Accept-Language negotiated ×10 locales) instead of the bare framework 404. The refusal policy is untouched (a withdrawn pack still never renders — RS-E12); integrity holes (valid claims, missing snapshot) still 404. | `share-link-dead-end.tsx` (new), `app/s/[token]/page.tsx`, bundles (`shareLink.*`) |
| UXW3-04 | S3 | `contractors.publicByToken` now returns the workspace's `companyName`, and the portal intro names the parties the right way round: "{company} has asked {name} for the documents below." | `packages/api/src/routers/contractors.ts`, `contractor-upload/[token]/page.tsx`, bundles |
| UXW3-05 | S3 | The failed-upload toast names the file and the consequence: "{filename} didn't reach us — nothing was saved. Try again…; if it keeps failing, send the document to the company that asked for it." (IN-A4's rule applied to the outsider surface.) | `contractor-upload/[token]/page.tsx`, bundles (`contractors.portalUploadFailed`) |
| UXW3-06 | S3 | The kiosk zero-state carries the human fallback: "…No booking? Ask at reception — they can sign you in as a walk-in." Words only — the walk-in flow already exists on the internal side. | bundles (`contractors.gate.kioskNoVisits`) |
| UXW3-07 | S3 | The kiosk refusal speaks to the person reading it: "We can't check you in automatically — some of your company's documents are missing or out of date. Please see the site office; they can sign you in." The card chip reads "Documents outstanding" instead of the bare "Not compliant". Enforcement unchanged; the internal `visits.blockedNonCompliant` staff copy is a separate key and untouched. | bundles (`contractors.gate.blockedNonCompliant`, `.nonCompliantChip`) |
| UXW3-08 | S3 | The RAMS snapshot gained `siteTimeZone`/`tenantTimeZone` (BUG-14 applied to the one renderer that missed it) and the pack layout formats every date through `formatInTimeZone(…, 'en-GB')` under `resolveDocumentTimeZone` — "21 Aug 2026, 23:28" in the work's clock, everywhere the public pack, PDF and briefing register print a time. Both call sites pass `APP_TIMEZONE` as the last resort. | `packages/render/src/snapshot.ts`, `rams-print-layout.tsx`, `render/rams/[packVersionId]/page.tsx`, `client-acceptance-view.tsx`, `app/s/[token]/page.tsx` |
| UXW3-09 | S4 | Sections 3 (COSHH) and 7 (Supporting documents) render **always**, with "None for this job." when empty — matching section 2's own "None bound." pattern. The numbering can no longer gap. | `rams-print-layout.tsx` |
| UXW3-10 | S4 | The moment of acceptance shows the full receipt: on success the decision block renders "Signed by {name} — {organisation}, version {n}." from the submitted values, not just after a reload. | `client-acceptance-view.tsx` |
| UXW3-11 | S4 | The scan description placeholder de-jargoned: "Add any details that might help — what, where, when." ×10 locales. | bundles (`scanPage.descriptionPlaceholder`) |

## Deliberately not done (and why)

- **Kiosk walk-in self-registration** (the flow, not the words): letting an
  unbooked stranger create a visit from the gate screen has security
  implications the internal walk-in flow deliberately keeps behind staff.
  UXW3-06's fix routes the person to a human instead.
- **The internal-side observations** in the findings doc's harness notes
  (authorise/issue confirm ceremony, Revoke without confirm, no-site
  permits, the requirement-template toast) are parked for UXW-4 — they are
  P2's frame, and the walkthrough should see them fresh.

## Verification

- `pnpm typecheck` + `pnpm lint` green; targeted vitest (the two new
  UXW3-02 row tests, SE01, K01 + placeholder guards over the 16 new/changed
  keys ×10 locales); full `pnpm test` before merge.
- Explorer re-verification (P4's own profiles, phone-390): revoked `/s`
  link shows the branded dead-end; upload page names the workspace as
  requester; failed upload names the file; kiosk zero-state and refusal
  speak contractor-voice; permit acceptance opens a real signature dialog
  and completes (the flow the instrument previously could not finish);
  public pack prints house-format dates and unbroken section numbers.
