'use client';

import { ImagePlus, Play, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import { Skeleton } from '../ui/skeleton';

interface SiteMediaGalleryProps {
  siteId: string;
}

function fileUrl(storageKey: string): string {
  return `/api/files?key=${encodeURIComponent(storageKey)}`;
}

export function SiteMediaGallery({ siteId }: SiteMediaGalleryProps) {
  const t = useTranslations('sites');
  const canManage = useHasPermission('sites.manage');
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: media = [], isLoading } = trpc.siteMedia.list.useQuery({ siteId });
  const [uploading, setUploading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState('');

  const createMedia = trpc.siteMedia.create.useMutation();
  const updateCaption = trpc.siteMedia.updateCaption.useMutation({
    onSuccess: () => void utils.siteMedia.list.invalidate({ siteId }),
  });
  const archive = trpc.siteMedia.archive.useMutation({
    onSuccess: () => {
      void utils.siteMedia.list.invalidate({ siteId });
      void utils.sites.getHub.invalidate({ id: siteId });
      toast.success(t('mediaDeletedToast'));
      setOpenId(null);
    },
  });

  const open = openId === null ? null : (media.find((m) => m.id === openId) ?? null);

  async function handleFiles(files: FileList | null) {
    if (files === null || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set('siteId', siteId);
        form.set('file', file);
        const res = await fetch('/api/upload/site-media', { method: 'POST', body: form });
        if (!res.ok) {
          toast.error(t('mediaUploadError'));
          continue;
        }
        const body = (await res.json()) as {
          storageKey: string;
          filename: string;
          mimeType: string;
          sizeBytes: number;
        };
        await createMedia.mutateAsync({
          siteId,
          storageKey: body.storageKey,
          filename: body.filename,
          mimeType: body.mimeType,
          sizeBytes: body.sizeBytes,
        });
      }
      await utils.siteMedia.list.invalidate({ siteId });
      await utils.sites.getHub.invalidate({ id: siteId });
    } finally {
      setUploading(false);
      if (fileInputRef.current !== null) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('mediaTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('mediaSubtitle')}</p>
        </div>
        <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <ImagePlus className="mr-1.5 h-4 w-4" />
          {uploading ? t('mediaUploading') : t('mediaAdd')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-lg" />
          ))}
        </div>
      ) : media.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          {t('mediaEmpty')}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setOpenId(m.id);
                setCaptionDraft(m.caption);
              }}
              className="group relative aspect-square overflow-hidden rounded-lg border bg-muted"
            >
              {m.kind === 'video' ? (
                <>
                  <video
                    src={fileUrl(m.storageKey)}
                    className="h-full w-full object-cover"
                    preload="metadata"
                    muted
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                    <span className="rounded-full bg-black/60 p-2">
                      <Play className="h-5 w-5 fill-white text-white" />
                    </span>
                  </div>
                </>
              ) : (
                <img
                  src={fileUrl(m.storageKey)}
                  alt={m.caption.length > 0 ? m.caption : m.filename}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
              )}
              {m.caption.length > 0 ? (
                <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-left text-xs text-white">
                  {m.caption}
                </div>
              ) : null}
            </button>
          ))}
        </div>
      )}

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-3xl">
          {open !== null ? (
            <div className="space-y-4">
              <div className="flex max-h-[60vh] items-center justify-center overflow-hidden rounded-md bg-black">
                {open.kind === 'video' ? (
                  <video src={fileUrl(open.storageKey)} controls className="max-h-[60vh] w-full" />
                ) : (
                  <img
                    src={fileUrl(open.storageKey)}
                    alt={open.caption.length > 0 ? open.caption : open.filename}
                    className="max-h-[60vh] w-auto object-contain"
                  />
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    value={captionDraft}
                    onChange={(e) => setCaptionDraft(e.target.value)}
                    placeholder={t('mediaCaptionPlaceholder')}
                    maxLength={2000}
                    className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={updateCaption.isPending || captionDraft === open.caption}
                    onClick={() => updateCaption.mutate({ id: open.id, caption: captionDraft })}
                  >
                    {t('mediaSaveCaption')}
                  </Button>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {t('mediaUploadedBy')} {open.uploaderName ?? '—'}
                  </span>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={archive.isPending}
                      onClick={() => {
                        if (window.confirm(t('mediaDeleteConfirm'))) {
                          archive.mutate({ id: open.id });
                        }
                      }}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      {t('mediaDelete')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
