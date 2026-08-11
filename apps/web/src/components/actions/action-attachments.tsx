'use client';

/**
 * Attachments on an action — photos, videos and files.
 *
 * The only writer today is the WhatsApp assistant ("attach that photo to a new
 * action"), so this is read-only: without it a file saved over WhatsApp would
 * exist in R2 and in the database and be invisible to the person who sent it,
 * which is worse than not saving it at all.
 *
 * Images render as thumbnails because a photo of a defect is the content, not
 * an enclosure; everything else lists as a named file. Both open the signed
 * URL, which is short-lived and minted per request by `attachments.list`.
 */
import { FileText, Paperclip } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { trpc } from '../../lib/trpc/client';
import { Skeleton } from '../ui/skeleton';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ActionAttachments({ actionId }: { actionId: string }) {
  const t = useTranslations('actions.detail.attachments');
  const format = useFormatter();
  const { data, isLoading } = trpc.actions.attachments.list.useQuery({ actionId });

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  // Nothing attached is the common case — stay silent rather than spending a
  // heading and an empty state on it.
  if (data === undefined || data.length === 0) return null;

  return (
    <section className="space-y-3 border-t p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Paperclip className="h-4 w-4" aria-hidden="true" />
        {t('title', { count: data.length })}
      </h3>

      <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
        {data.map((att) => {
          const isImage = att.mimeType.startsWith('image/');
          const uploaded = format.dateTime(new Date(att.uploadedAt), {
            dateStyle: 'medium',
            timeStyle: 'short',
          });
          return (
            <li key={att.id}>
              {att.signedUrl === null ? (
                <div className="rounded-md border p-3 text-xs text-muted-foreground">
                  {att.filename}
                  <span className="block">{t('unavailable')}</span>
                </div>
              ) : (
                <a
                  href={att.signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-md border transition hover:border-foreground/30"
                  title={`${att.filename} · ${formatBytes(att.sizeBytes)} · ${uploaded}`}
                >
                  {isImage ? (
                    // Plain <img>, not next/image: the source is a short-lived
                    // signed R2 URL on a host that would have to be allow-listed,
                    // and optimising a URL that expires in minutes buys nothing.
                    <img
                      src={att.signedUrl}
                      alt={att.filename}
                      className="aspect-square w-full bg-muted object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center bg-muted">
                      <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                    </div>
                  )}
                  <span className="block truncate p-2 text-xs">{att.filename}</span>
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
