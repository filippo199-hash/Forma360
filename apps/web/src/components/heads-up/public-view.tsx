/**
 * Public, read-only Heads-Up viewer rendered by the `/s/[token]` share
 * route when the token resolves to a published heads-up (rather than an
 * inspection). Chrome-less, presentational only — mirrors the print
 * layout's inlined-`<style>` approach so it renders cleanly with no app
 * shell, no session, no cookie.
 *
 * Possession of the share token IS the permission check. This surface is
 * deliberately read-only: no acknowledge / sign / reactions / comments —
 * those are authenticated-recipient actions and live in the app.
 *
 * This component is exempt from the no-hardcoded-strings lint rule
 * (it lives under `src/components/**`), so plain English copy is fine.
 */

import { formatDate } from '../../lib/format-date';

/** Attachment with a pre-resolved signed URL (minted by the server page). */
interface PublicAttachment {
  id: string;
  filename: string;
  mimeType: string;
  /** Signed download URL, or null when signing failed / unavailable. */
  url: string | null;
}

/** Linked library document — name only; no public download. */
interface PublicDocument {
  name: string;
}

type EngagementLevel = 'view' | 'acknowledge' | 'sign';

const ENGAGEMENT_COPY: Record<EngagementLevel, string> = {
  view: 'For your information',
  acknowledge: 'Acknowledgement requested',
  sign: 'Signature requested',
};

export function HeadsUpPublicView({
  title,
  description,
  creatorName,
  createdAt,
  attachments,
  documents,
  engagementLevel,
}: {
  title: string;
  description: string | null;
  creatorName: string | null;
  createdAt: Date;
  attachments: ReadonlyArray<PublicAttachment>;
  documents: ReadonlyArray<PublicDocument>;
  engagementLevel: string;
}) {
  const body = (description ?? '').trim();
  const images = attachments.filter((a) => a.mimeType.startsWith('image/'));
  const files = attachments.filter((a) => !a.mimeType.startsWith('image/'));
  // UK-DATES: no locale on the public share route — house-style default,
  // not whatever the viewer's browser happens to be set to.
  const createdLabel = formatDate(createdAt);

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .hu-body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; font-size: 15px; line-height: 1.55; max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
            .hu-body .hu-author { display: flex; align-items: center; gap: 8px; color: #6b7280; font-size: 13px; margin-bottom: 12px; }
            .hu-body .hu-author .hu-name { font-weight: 600; color: #374151; }
            .hu-body h1 { font-size: 24px; line-height: 1.25; margin: 0 0 12px 0; }
            .hu-body .hu-level { display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 999px; padding: 2px 10px; margin-bottom: 20px; }
            .hu-body .hu-description { white-space: pre-wrap; margin: 0 0 24px 0; }
            .hu-body .hu-section-label { font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #6b7280; margin: 24px 0 10px 0; }
            .hu-body .hu-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
            .hu-body .hu-gallery img { width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 8px; object-fit: contain; background: #f9fafb; }
            .hu-body .hu-file { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 8px; margin: 6px 0; font-size: 14px; }
            .hu-body .hu-file a { color: #1d4ed8; text-decoration: none; word-break: break-word; }
            .hu-body .hu-file a:hover { text-decoration: underline; }
            .hu-body .hu-file-icon { flex: none; }
            .hu-body .hu-doc { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 8px; margin: 6px 0; font-size: 14px; color: #374151; }
          `,
        }}
      />
      <div className="hu-body">
        <div className="hu-author">
          <span className="hu-name">{creatorName ?? 'Unknown'}</span>
          <span aria-hidden="true">·</span>
          <span>{createdLabel}</span>
        </div>

        <h1>{title}</h1>
        <div className="hu-level">
          {engagementLevel === 'sign'
            ? ENGAGEMENT_COPY.sign
            : engagementLevel === 'acknowledge'
              ? ENGAGEMENT_COPY.acknowledge
              : ENGAGEMENT_COPY.view}
        </div>

        {body.length > 0 ? <div className="hu-description">{body}</div> : null}

        {images.length > 0 ? (
          <>
            <div className="hu-section-label">Images</div>
            <div className="hu-gallery">
              {images.map((a) =>
                a.url !== null ? (
                  <img key={a.id} src={a.url} alt={a.filename} />
                ) : (
                  <div key={a.id} className="hu-file">
                    <span className="hu-file-icon" aria-hidden="true">
                      🖼
                    </span>
                    <span>{a.filename}</span>
                  </div>
                ),
              )}
            </div>
          </>
        ) : null}

        {files.length > 0 ? (
          <>
            <div className="hu-section-label">Attachments</div>
            {files.map((a) => {
              const isVideo = a.mimeType.startsWith('video/');
              const icon = isVideo ? '🎬' : '📎';
              return (
                <div key={a.id} className="hu-file">
                  <span className="hu-file-icon" aria-hidden="true">
                    {icon}
                  </span>
                  {a.url !== null ? (
                    <a href={a.url} target="_blank" rel="noreferrer">
                      {a.filename}
                    </a>
                  ) : (
                    <span>{a.filename}</span>
                  )}
                </div>
              );
            })}
          </>
        ) : null}

        {documents.length > 0 ? (
          <>
            <div className="hu-section-label">Linked documents</div>
            {documents.map((d, i) => (
              <div key={i} className="hu-doc">
                <span className="hu-file-icon" aria-hidden="true">
                  📄
                </span>
                <span>{d.name}</span>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </>
  );
}
