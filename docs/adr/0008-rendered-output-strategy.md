# ADR 0008 — Rendered-output strategy (PDF, Word, public share links)

**Status:** Accepted
**Date:** 2026-04-18

## Context

Phase 2 needs three related capabilities for completed inspections:

1. **PDF export** — a faithful, portable, printable render of the
   inspection (title block, document number, responses, signatures,
   approvals).
2. **Word export** — an editable `.docx` rendition of the same content
   for teams that layer comments on top of an audit before filing it.
3. **Public share links** — a tenant admin hands a read-only URL to an
   external auditor / client who does not have a Forma360 account. The
   link is revocable, optionally expiring, and never exposes more than
   the single inspection.

The choice is load-bearing for Phase 2+ because every module that adds
an export surface (issues, assets, heads-up post-mortems) will reuse
the same renderer and cache layer. Getting this wrong means rewriting
four modules.

## Decision

### PDF

**Render HTML via Next.js, snapshot via Puppeteer against a dedicated
print route, cache the resulting artefact in R2 keyed by a content
hash.**

- The print route is `/render/inspection/[inspectionId]`. It serves a
  print-CSS-optimised `<PrintLayout />` — A4 page size, `page-break-before`
  for each section, embedded signature images.
- Puppeteer launches chromium headless, navigates to the print URL, and
  prints to PDF. Authentication is an **internal HMAC token** signed
  with `RENDER_SHARED_SECRET` — the print route rejects any request
  without a valid token. This keeps the route crawler-invisible while
  letting the renderer reach it without a session cookie.
- Artefacts are cached in R2 under
  `<tenantId>/inspections/<inspectionId>/pdf-<sha256>.pdf`. The hash is
  computed from the inspection's content-stable inputs (template
  version, responses, signatures, approvals, completion timestamp) so a
  stable inspection re-renders to the same key and we serve from cache.
- The public download endpoint returns a short-lived signed R2 GET URL.

### Word

**Render with the `docx` npm package — pure JavaScript, no native
dependencies, no browser launch.** The doc is assembled in-process from
the same inspection snapshot the PDF renderer reads, cached in R2 under
`<tenantId>/inspections/<inspectionId>/docx-<sha256>.docx` with the same
content-hash key.

### Public share links

**Opaque tokens stored in the existing `public_inspection_links` table.**
Tokens are 32 cryptographically-random bytes, base64url-encoded (43
chars, no padding). The `/s/[token]` web route validates the token
against the table (rejecting expired or revoked rows), loads the
inspection by the token's foreign key, and renders the same
`<PrintLayout />` the print route serves — no session required, single
inspection only, no sibling data exposed.

Revoke is a row update (`revokedAt = now()`), not a delete — history
is preserved, reissue requires a fresh row.

## Rejected alternatives

- **pdfkit.** Declarative API duplicates our existing React layout in a
  parallel tree. Every layout change would force a second implementation.
- **wkhtmltopdf.** A separate C++ binary that has to be installed and
  kept patched on the Railway worker. CVE exposure surface; packaging
  pain. Puppeteer at least ships chromium via `@sparticuz/chromium`.
- **@react-pdf/renderer.** Its layout primitives are flexbox-ish but not
  CSS. Our print layout uses grid + `page-break-*` CSS we already
  prototyped for signatures. Rewriting to `@react-pdf`'s primitives for
  every Phase 2+ export module is a tax we do not want to keep paying.

## Consequences

1. The worker (or a dedicated render process, later) must have chromium
   available. In the Railway deploy, `@sparticuz/chromium` is added as
   a regular dependency and unpacked on cold start. If chromium cannot
   launch, the render code path degrades to a stub PDF ("Render engine
   not configured") so the share-link and Word halves of this ADR
   continue to work. Stubbing is logged; a production deploy without
   chromium is a misconfiguration, not a feature.
2. `RENDER_SHARED_SECRET` is a required env var (≥32 chars). Rotating
   it invalidates every in-flight render token but not any cached
   artefact.
3. `APP_URL` is the canonical public base URL; share links are
   `${APP_URL}/s/<token>`. Changing it does not invalidate existing
   share-link rows but changes the URL the copy-button hands back.
4. Future export surfaces (issue reports, asset maintenance history)
   reuse `packages/render/` — add a new renderer module, reuse the
   content-hash cache helper, same Puppeteer print route pattern.

## Implementation pointer

- Code lives in `packages/render/`.
- Env additions: `APP_URL` (already required), `RENDER_SHARED_SECRET` (new).
- Routes: `/render/inspection/[inspectionId]?token=...` (HMAC-gated, renders
  PrintLayout), `/s/[token]` (public share), `/api/exports/{pdf,docx}`
  (session-gated download endpoints).
- Router: `packages/api/src/routers/exports.ts` exposes `renderPdf`,
  `renderDocx`, `createShareLink`, `listShareLinks`, `revokeShareLink`.
