/**
 * @forma360/render — rendered-output surface for Phase 2+.
 *
 * - {@link renderInspectionPdf} — PDF via Puppeteer (+ stub fallback).
 * - {@link renderInspectionDocx} — Word via the `docx` npm package.
 * - {@link generateShareToken} / {@link validateShareToken} — opaque
 *   public-share tokens backed by `public_inspection_links`.
 * - {@link signRenderToken} / {@link verifyRenderToken} — internal HMAC
 *   tokens for the Puppeteer-facing print route.
 * - {@link loadInspectionSnapshot} / {@link hashInspectionSnapshot} —
 *   shared read that every renderer consumes.
 *
 * See ADR 0008 for the architectural decisions behind each surface.
 */
export {
  renderInspectionPdf,
  pdfObjectKey,
  type RenderDeps,
  type RenderResult,
} from './pdf';
export {
  renderInspectionDocx,
  docxObjectKey,
  type RenderDocxDeps,
  type RenderDocxResult,
} from './docx';
export {
  generateShareToken,
  validateShareToken,
  buildShareUrl,
  revokeShareLinkRow,
  SHARE_TOKEN_BYTES,
  type ShareTokenClaims,
} from './share';
export {
  signRenderToken,
  verifyRenderToken,
  DEFAULT_RENDER_TOKEN_TTL_SECONDS,
} from './hmac';
export {
  loadInspectionSnapshot,
  hashInspectionSnapshot,
  type InspectionRenderSnapshot,
} from './snapshot';
