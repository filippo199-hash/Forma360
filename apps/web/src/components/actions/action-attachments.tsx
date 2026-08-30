'use client';

/**
 * Attachments on an action — photos, videos and files.
 *
 * Anyone who can see the action can add files (the server gates on
 * `actions.view` at upload and insert); an upload is removable by its
 * author or an `actions.manage` holder. The WhatsApp assistant writes
 * into the same table ("attach that photo to a new action"), so files
 * sent from the field and files added here read identically.
 *
 * Images render as thumbnails because a photo of a defect is the
 * content, not an enclosure; everything else lists as a named file.
 * Both open the signed URL, which is short-lived and minted per request
 * by `attachments.list`.
 *
 * Mounted at the bottom of the Overview tab in BOTH the action sidebar
 * (action-detail-panel) and the full action page ([actionId]/page).
 */
import { FileText, Paperclip, Upload, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { appConfirm } from '../ui/app-confirm';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/cn';
import { useServerErrorToast } from '../../../src/lib/use-server-error';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPT = 'image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';

export function ActionAttachments({
  actionId,
  canManage = false,
}: {
  actionId: string;
  canManage?: boolean;
}) {
  const t = useTranslations('actions.detail.attachments');
  const onServerErrorG0 = useServerErrorToast(t('uploadError'));
  const onServerErrorG0_1 = useServerErrorToast(t('deleteError'));
  const format = useFormatter();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.actions.attachments.list.useQuery({ actionId });
  const create = trpc.actions.attachments.create.useMutation({
    onSuccess: () => {
      void utils.actions.attachments.list.invalidate({ actionId });
      void utils.actions.activity.list.invalidate({ actionId });
    },
    onError: onServerErrorG0,
  });
  const remove = trpc.actions.attachments.remove.useMutation({
    onSuccess: () => {
      void utils.actions.attachments.list.invalidate({ actionId });
      void utils.actions.activity.list.invalidate({ actionId });
    },
    onError: onServerErrorG0_1,
  });
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function uploadOne(file: File) {
    const form = new FormData();
    form.set('actionId', actionId);
    form.set('file', file);
    const res = await fetch('/api/upload/action-attachment', { method: 'POST', body: form });
    if (!res.ok) {
      toast.error(res.status === 415 ? t('unsupportedType') : t('uploadError'));
      return;
    }
    const json = (await res.json()) as {
      storageKey: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    };
    await create.mutateAsync({
      actionId,
      storageKey: json.storageKey,
      filename: json.filename,
      mimeType: json.mimeType,
      sizeBytes: json.sizeBytes,
    });
  }

  async function handleFiles(files: FileList | null) {
    if (files === null || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadOne(file);
      }
    } catch {
      toast.error(t('uploadError'));
    } finally {
      setUploading(false);
      if (fileInputRef.current !== null) fileInputRef.current.value = '';
    }
  }

  const rows = data ?? [];

  return (
    <section className="space-y-3 p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Paperclip className="h-4 w-4" aria-hidden="true" />
        {t('title', { count: rows.length })}
      </h3>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          // min-w-0 + a wrapping button — the long label must never paint
          // outside the dashed box in a narrow column (round 4).
          'flex min-w-0 items-center justify-center rounded-md border border-dashed p-3 text-sm transition-colors',
          dragOver ? 'border-primary bg-accent/50' : 'border-muted bg-muted/30',
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
          aria-label={t('dropZone')}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto min-h-9 max-w-full whitespace-normal text-center"
          disabled={uploading || create.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="mr-1 h-4 w-4 shrink-0" aria-hidden="true" />
          {uploading || create.isPending ? t('uploading') : t('dropZone')}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('emptyBody')}</p>
      ) : (
        <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
          {rows.map((att) => {
            const isImage = att.mimeType.startsWith('image/');
            const uploaded = format.dateTime(new Date(att.uploadedAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            });
            const uploaderLine =
              att.uploadedByName !== null
                ? t('uploadedBy', { name: att.uploadedByName })
                : uploaded;
            const canRemove = att.isMine || canManage;
            return (
              <li key={att.id} className="relative">
                {canRemove ? (
                  <button
                    type="button"
                    className="absolute right-1 top-1 z-10 rounded-full bg-background/90 p-1 text-muted-foreground shadow hover:text-destructive"
                    aria-label={t('deleteAction')}
                    disabled={remove.isPending}
                    onClick={() => {
                      void appConfirm({ description: t('deleteConfirm'), destructive: true }).then(
                        (ok) => {
                          if (ok) remove.mutate({ attachmentId: att.id });
                        },
                      );
                    }}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
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
                    title={`${att.filename} · ${formatBytes(att.sizeBytes)} · ${uploaderLine} · ${uploaded}`}
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
                    <span className="block truncate px-2 pt-2 text-xs">{att.filename}</span>
                    <span className="block truncate px-2 pb-2 text-[10px] text-muted-foreground">
                      {uploaderLine}
                    </span>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
