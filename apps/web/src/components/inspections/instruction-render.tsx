'use client';

/**
 * Instruction renderer for the conduct UI and the on-screen report.
 *
 * Shows the admin's guidance clearly marked as an Instruction: Markdown body,
 * attachments (images shown large + click-to-open, PDFs embedded inline, other
 * docs as a download card), and an embedded YouTube/Vimeo player. Files are
 * served through the session-gated `/api/files?key=` proxy; the video embed URL
 * is rebuilt safely by `parseVideoEmbed` (never the raw user link).
 */
import type { Item } from '@forma360/shared/template-schema';
import { parseVideoEmbed } from '@forma360/shared/video-embed';
import { FileText, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MarkdownMessage } from '../ai/markdown-message';

type InstructionItem = Extract<Item, { type: 'instruction' }>;

function fileUrl(key: string): string {
  return `/api/files?key=${encodeURIComponent(key)}`;
}

export function InstructionBody({ item }: { item: InstructionItem }) {
  const t = useTranslations('templates.editor.questionType');
  const embed = item.videoUrl !== undefined ? parseVideoEmbed(item.videoUrl) : null;
  const hasBody = item.body.trim().length > 0;
  if (!hasBody && item.attachments.length === 0 && embed === null) return null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
        <Info className="h-3.5 w-3.5" />
        {t('instruction')}
      </div>

      {hasBody && (
        <div className="text-foreground">
          <MarkdownMessage content={item.body} />
        </div>
      )}

      {item.attachments.length > 0 && (
        <div className="mt-3 space-y-3">
          {item.attachments.map((a) => {
            const url = fileUrl(a.key);
            if (a.mimeType.startsWith('image/')) {
              return (
                <a key={a.key} href={url} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={url}
                    alt={a.filename}
                    className="max-h-[70vh] w-full rounded-md border bg-muted object-contain"
                  />
                </a>
              );
            }
            if (a.mimeType === 'application/pdf') {
              return (
                <iframe
                  key={a.key}
                  src={url}
                  title={a.filename}
                  className="h-[600px] w-full rounded-md border"
                />
              );
            }
            return (
              <a
                key={a.key}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{a.filename}</span>
              </a>
            );
          })}
        </div>
      )}

      {embed !== null && (
        <div className="mt-3 aspect-video w-full overflow-hidden rounded-md border bg-black">
          <iframe
            src={embed.embedUrl}
            title={t('instruction')}
            className="h-full w-full"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
    </div>
  );
}
