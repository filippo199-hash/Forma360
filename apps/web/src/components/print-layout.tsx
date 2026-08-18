/**
 * Print layout used by both the Puppeteer-facing `/render/inspection/*`
 * route and the public `/s/[token]` share route. Renders from the
 * snapshot shape `@forma360/render` produces — same data, same markup,
 * same print CSS.
 *
 * Print CSS notes:
 *   - A4 page size (210x297 mm) via `@page`.
 *   - `page-break-before: always` between sections so auditors get a
 *     predictable layout.
 *   - Signature images render at 180x60 px so they fit the print
 *     width without scaling artefacts.
 */
import type { InspectionRenderSnapshot } from '@forma360/render';
import type { TemplateContent } from '@forma360/shared/template-schema';
import {
  collectFlaggedAnswers,
  computeSkippedItemIds,
  multipleChoiceLabels,
} from '@forma360/shared/inspection-eval';
import { CompanyLetterhead } from './company-letterhead';
import { formatDate } from '../lib/format-date';

/**
 * Narrow shape of the page-walk we do. Matches what @forma360/shared
 * produces but kept local so we don't have to drag the full Zod type
 * into a client-safe React component.
 */
interface TemplateContentLike {
  pages?: ReadonlyArray<{
    id?: string;
    type?: string;
    title?: string;
    sections?: ReadonlyArray<{
      id?: string;
      title?: string;
      items?: ReadonlyArray<{
        id?: string;
        type?: string;
        prompt?: string;
        responseSetId?: string;
      }>;
    }>;
  }>;
  settings?: {
    branding?: {
      logoStorageKey?: string;
      primaryColor?: string;
      accentColor?: string;
    };
  };
}

interface InstructionPrintItem {
  id?: string;
  type: 'instruction';
  body?: string;
  attachments?: ReadonlyArray<{ key: string; filename: string; mimeType: string }>;
  videoUrl?: string;
  showInReport?: boolean;
}

/**
 * Render an instruction in the printed report. Honours `showInReport`. Images
 * embed via pre-resolved signed URLs (`mediaUrls`); video shows as a link
 * (a PDF can't play it) and other docs are listed by name.
 */
function InstructionPrint({
  item,
  mediaUrls,
}: {
  item: InstructionPrintItem;
  mediaUrls: Record<string, string>;
}) {
  if (item.showInReport === false) return null;
  const body = (item.body ?? '').trim();
  const attachments = item.attachments ?? [];
  const images = attachments.filter((a) => a.mimeType.startsWith('image/'));
  const docs = attachments.filter((a) => !a.mimeType.startsWith('image/'));
  if (body.length === 0 && attachments.length === 0 && item.videoUrl === undefined) return null;

  return (
    <div className="print-instruction">
      <div className="ins-label">Instruction</div>
      {body.length > 0 ? <div className="ins-body">{body}</div> : null}
      {images.map((a) => {
        const url = mediaUrls[a.key];
        return url !== undefined ? <img key={a.key} src={url} alt={a.filename} /> : null;
      })}
      {docs.map((a) => (
        <div key={a.key} className="ins-file">
          Attachment: {a.filename}
        </div>
      ))}
      {item.videoUrl !== undefined ? <div className="ins-file">Video: {item.videoUrl}</div> : null}
    </div>
  );
}

/**
 * Tenant-level branding fallback (ADR 0018). The template schema always
 * promised "templates without branding fall back to tenant defaults in
 * rendered output" — this is that fallback. Per-field: the tenant value
 * applies only where the template does not set its own.
 */
export interface PrintTenantBranding {
  logoUrl?: string | null;
  primaryColor?: string;
  accentColor?: string;
}

export function PrintLayout({
  snapshot,
  logoUrl = null,
  mediaUrls = {},
  tenantBranding = null,
}: {
  snapshot: InspectionRenderSnapshot;
  /** Pre-resolved signed URL for `settings.branding.logoStorageKey`. Caller is responsible for fetching this. */
  logoUrl?: string | null;
  /**
   * Pre-resolved signed URLs for instruction image attachments, keyed by R2
   * key. The headless browser has no session, so the caller must resolve these
   * (same as `logoUrl`); unresolved keys simply don't render an image.
   */
  mediaUrls?: Record<string, string>;
  /** Tenant branding used per-field when the template sets none. */
  tenantBranding?: PrintTenantBranding | null;
}) {
  const content = snapshot.template.content as TemplateContentLike | undefined;
  const branding = content?.settings?.branding;
  const primary = branding?.primaryColor ?? tenantBranding?.primaryColor;
  const accent = branding?.accentColor ?? tenantBranding?.accentColor;
  const coverLogoUrl = logoUrl ?? tenantBranding?.logoUrl ?? null;

  // Flagged-answer summary (shown at the very top of the report). Computed
  // from the same pure helper the conduct UI uses, so the two never disagree.
  const evalContent = snapshot.template.content as TemplateContent | undefined;
  const responses = snapshot.inspection.responses;
  const flaggedAnswers =
    evalContent !== undefined ? collectFlaggedAnswers(evalContent, responses) : [];
  const flaggedItemIds = new Set(flaggedAnswers.map((f) => f.itemId));
  // Questions skipped by a forward jump render as "Skipped" rather than blank.
  const skippedItemIds =
    evalContent !== undefined ? computeSkippedItemIds(evalContent, responses) : new Set<string>();

  // Title-page items are auto-populated — resolve their values from the
  // inspection so the title page renders real text, not blanks/ids.
  const insp = snapshot.inspection;
  const fmtDate = (d: string | null): string => (d === null ? '' : formatDate(d));
  const titleValues: Record<string, string> = {};
  for (const page of content?.pages ?? []) {
    if (page.type !== 'title') continue;
    for (const section of page.sections ?? []) {
      for (const item of section.items ?? []) {
        if (item.id === undefined) continue;
        if (item.type === 'site') titleValues[item.id] = insp.siteName ?? '';
        else if (item.type === 'conductedBy') titleValues[item.id] = insp.conductedByName ?? '';
        else if (item.type === 'inspectionDate')
          titleValues[item.id] = fmtDate(insp.completedAt ?? insp.startedAt);
        else if (item.type === 'documentNumber') titleValues[item.id] = insp.documentNumber ?? '';
      }
    }
  }

  return (
    <>
      {/*
        Print CSS inlined so the Puppeteer rasteriser picks it up
        regardless of Next's CSS-extraction strategy. Kept as a
        plain <style> tag for the same reason.
      */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @page { size: A4; margin: 1cm; }
            .print-body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; font-size: 11pt; line-height: 1.4; }
            .print-body h1 { font-size: 18pt; margin: 0 0 0.4cm 0; }
            .print-body h2 { font-size: 14pt; margin: 0.6cm 0 0.2cm 0; }
            .print-body h3 { font-size: 12pt; margin: 0.4cm 0 0.1cm 0; }
            .print-body .print-meta { margin-bottom: 0.4cm; }
            .print-body .print-meta div { margin: 0.1cm 0; }
            .print-body .print-cover { display: flex; align-items: center; gap: 0.4cm; padding: 0.3cm 0.5cm; margin: 0 0 0.4cm 0; color: #fff; border-radius: 0.15cm; }
            .print-body .print-cover img { height: 1.4cm; width: auto; object-fit: contain; background: rgba(255,255,255,0.15); padding: 0.1cm; border-radius: 0.1cm; }
            .print-body .print-cover h1 { color: #fff; margin: 0; }
            .print-body .print-section { page-break-before: always; }
            .print-body .print-section:first-of-type { page-break-before: auto; }
            .print-body .print-section h2 { border-bottom: 2px solid #ccc; padding-bottom: 0.1cm; }
            .print-body .print-response { margin: 0.2cm 0 0.3cm 0; }
            .print-body .print-response .prompt { font-weight: 600; }
            .print-body .print-response .answer { margin-top: 0.1cm; white-space: pre-wrap; }
            .print-body .print-response.flagged { border-left: 3px solid #dc2626; padding-left: 0.2cm; }
            .print-body .print-response .flag-badge { display: inline-block; margin-left: 0.2cm; padding: 0 0.15cm; font-size: 8pt; font-weight: 700; color: #fff; background: #dc2626; border-radius: 0.1cm; vertical-align: middle; }
            .print-body .print-response.skipped { opacity: 0.5; }
            .print-body .print-response.skipped .prompt { font-weight: 400; color: #6b7280; }
            .print-body .print-instruction { border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 0.15cm; padding: 0.3cm 0.4cm; margin: 0.2cm 0 0.4cm 0; }
            .print-body .print-instruction .ins-label { font-size: 8pt; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #2563eb; margin-bottom: 0.15cm; }
            .print-body .print-instruction .ins-body { white-space: pre-wrap; margin-bottom: 0.2cm; }
            .print-body .print-instruction img { max-width: 100%; max-height: 9cm; object-fit: contain; border: 1px solid #e5e7eb; border-radius: 0.1cm; margin: 0.15cm 0; display: block; }
            .print-body .print-instruction .ins-file { font-size: 9pt; color: #374151; margin: 0.1cm 0; }
            .print-body .print-response .skip-badge { display: inline-block; margin-left: 0.2cm; padding: 0 0.15cm; font-size: 8pt; font-weight: 700; color: #374151; background: #e5e7eb; border-radius: 0.1cm; vertical-align: middle; }
            .print-body .print-flagged { border: 1px solid #fca5a5; background: #fef2f2; border-radius: 0.15cm; padding: 0.3cm 0.4cm; margin: 0 0 0.5cm 0; }
            .print-body .print-flagged h2 { margin: 0 0 0.2cm 0; color: #b91c1c; border: 0; font-size: 13pt; }
            .print-body .print-flagged ul { margin: 0; padding-left: 0.5cm; }
            .print-body .print-flagged li { margin: 0.1cm 0; }
            .print-body .print-flagged .loc { color: #6b7280; font-size: 9pt; }
            .print-body .print-signatures { margin-top: 0.6cm; }
            .print-body .print-signature { border: 1px solid #ccc; padding: 0.3cm; margin-bottom: 0.3cm; }
            .print-body .print-signature img { width: 180px; height: 60px; object-fit: contain; }
          `,
        }}
      />
      <div className="print-body">
        {/* Company letterhead (settings/company). The cover bar below keeps
            the logo treatment, so the letterhead stays text-only here. */}
        <CompanyLetterhead company={snapshot.company} />
        {primary !== undefined || coverLogoUrl !== null ? (
          <div
            className="print-cover"
            style={primary !== undefined ? { backgroundColor: primary } : undefined}
          >
            {coverLogoUrl !== null ? <img src={coverLogoUrl} alt="logo" /> : null}
            <h1>{snapshot.inspection.title}</h1>
          </div>
        ) : (
          <h1>{snapshot.inspection.title}</h1>
        )}
        <div className="print-meta">
          {snapshot.inspection.documentNumber !== null ? (
            <div>Document: {snapshot.inspection.documentNumber}</div>
          ) : null}
          <div>Status: {snapshot.inspection.status}</div>
          {snapshot.inspection.completedAt !== null ? (
            <div>Completed: {snapshot.inspection.completedAt}</div>
          ) : null}
          <div>
            Template: {snapshot.template.name} (v{snapshot.template.versionNumber})
          </div>
        </div>

        {flaggedAnswers.length > 0 ? (
          <div className="print-flagged">
            <h2>Flagged items ({flaggedAnswers.length})</h2>
            <ul>
              {flaggedAnswers.map((f) => (
                <li key={f.itemId}>
                  <strong>{f.prompt}</strong>
                  {' — '}
                  {f.options.map((o) => o.label).join(', ')}
                  <span className="loc">
                    {' · '}
                    {f.pageTitle} › {f.sectionTitle}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {(content?.pages ?? []).map((page, i) => {
          return (
            <section key={page.id ?? i} className="print-section">
              <h2 style={accent !== undefined ? { borderBottomColor: accent } : undefined}>
                {page.title}
              </h2>
              {(page.sections ?? []).map((section, si) => (
                <div key={section.id ?? si}>
                  <h3>{section.title}</h3>
                  {(section.items ?? []).map((item, ii) => {
                    // Instructions are guidance, not Q&A — render the body /
                    // images / video, honouring the admin's report toggle.
                    if (item.type === 'instruction') {
                      return (
                        <InstructionPrint
                          key={item.id ?? ii}
                          item={item as unknown as InstructionPrintItem}
                          mediaUrls={mediaUrls}
                        />
                      );
                    }
                    const response = snapshot.inspection.responses[item.id ?? ''];
                    const skipped = item.id !== undefined && skippedItemIds.has(item.id);
                    // Multiple-choice answers render as their option labels, not
                    // the raw ULID(s) stored in the response map.
                    const mcLabels =
                      evalContent !== undefined
                        ? multipleChoiceLabels(evalContent, item, response)
                        : null;
                    const titleVal = item.id !== undefined ? titleValues[item.id] : undefined;
                    const answerText =
                      titleVal !== undefined
                        ? titleVal
                        : mcLabels !== null
                          ? mcLabels.join(', ')
                          : stringifyResponse(response);
                    const flagged =
                      !skipped && item.id !== undefined && flaggedItemIds.has(item.id);
                    return (
                      <div
                        key={item.id ?? ii}
                        className={
                          skipped
                            ? 'print-response skipped'
                            : flagged
                              ? 'print-response flagged'
                              : 'print-response'
                        }
                      >
                        <div className="prompt">
                          {item.prompt ?? item.id}
                          {flagged ? <span className="flag-badge">FLAGGED</span> : null}
                          {skipped ? <span className="skip-badge">SKIPPED</span> : null}
                        </div>
                        {!skipped ? <div className="answer">{answerText}</div> : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </section>
          );
        })}

        {snapshot.signatures.length > 0 ? (
          <section className="print-signatures print-section">
            <h2>Signatures</h2>
            {snapshot.signatures.map((s) => (
              <div key={s.id} className="print-signature">
                <div>
                  Slot {s.slotIndex + 1}: {s.signerName}
                  {s.signerRole !== null ? ` (${s.signerRole})` : null}
                </div>
                <div>Signed at: {s.signedAt}</div>
                {s.signatureData.startsWith('data:') ? (
                  <img src={s.signatureData} alt={`Signature ${s.slotIndex + 1}`} />
                ) : (
                  <div>(signature data not embeddable)</div>
                )}
              </div>
            ))}
          </section>
        ) : null}

        {snapshot.approvals.length > 0 ? (
          <section className="print-section">
            <h2>Approvals</h2>
            {snapshot.approvals.map((a) => (
              <div key={a.id}>
                <div>
                  {a.decision} by {a.approverUserId} at {a.decidedAt}
                </div>
                {a.comment !== null ? <div>{a.comment}</div> : null}
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </>
  );
}

function stringifyResponse(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '[unserialisable]';
  }
}
