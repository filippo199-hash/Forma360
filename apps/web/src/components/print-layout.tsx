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
      }>;
    }>;
  }>;
}

export function PrintLayout({ snapshot }: { snapshot: InspectionRenderSnapshot }) {
  const content = snapshot.template.content as TemplateContentLike | undefined;
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
            .print-body .print-section { page-break-before: always; }
            .print-body .print-section:first-of-type { page-break-before: auto; }
            .print-body .print-response { margin: 0.2cm 0 0.3cm 0; }
            .print-body .print-response .prompt { font-weight: 600; }
            .print-body .print-response .answer { margin-top: 0.1cm; white-space: pre-wrap; }
            .print-body .print-signatures { margin-top: 0.6cm; }
            .print-body .print-signature { border: 1px solid #ccc; padding: 0.3cm; margin-bottom: 0.3cm; }
            .print-body .print-signature img { width: 180px; height: 60px; object-fit: contain; }
          `,
        }}
      />
      <div className="print-body">
        <h1>{snapshot.inspection.title}</h1>
        <div className="print-meta">
          {snapshot.inspection.documentNumber !== null ? (
            <div>Document: {snapshot.inspection.documentNumber}</div>
          ) : null}
          <div>Status: {snapshot.inspection.status}</div>
          {snapshot.inspection.completedAt !== null ? (
            <div>Completed: {snapshot.inspection.completedAt}</div>
          ) : null}
          <div>Template: {snapshot.template.name} (v{snapshot.template.versionNumber})</div>
        </div>

        {(content?.pages ?? []).map((page, i) => {
          if (page.type === 'title') return null;
          return (
            <section key={page.id ?? i} className="print-section">
              <h2>{page.title}</h2>
              {(page.sections ?? []).map((section, si) => (
                <div key={section.id ?? si}>
                  <h3>{section.title}</h3>
                  {(section.items ?? []).map((item, ii) => {
                    const response = snapshot.inspection.responses[item.id ?? ''];
                    return (
                      <div key={item.id ?? ii} className="print-response">
                        <div className="prompt">{item.prompt ?? item.id}</div>
                        <div className="answer">{stringifyResponse(response)}</div>
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
