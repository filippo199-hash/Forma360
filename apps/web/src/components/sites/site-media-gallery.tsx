'use client';

import { AlertTriangle, Check, GitCompare, ImagePlus, Play, Sparkles, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/cn';

interface SiteMediaGalleryProps {
  siteId: string;
}

function fileUrl(storageKey: string): string {
  return `/api/files?key=${encodeURIComponent(storageKey)}`;
}

async function analyzeOne(id: string): Promise<void> {
  try {
    await fetch('/api/site-media/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  } catch {
    // best-effort — tags simply won't appear
  }
}

export function SiteMediaGallery({ siteId }: SiteMediaGalleryProps) {
  const t = useTranslations('sites');
  const format = useFormatter();
  const canManage = useHasPermission('sites.manage');
  const canReport = useHasPermission('issues.report');
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: media = [], isLoading } = trpc.siteMedia.list.useQuery({ siteId });
  const [uploading, setUploading] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [raising, setRaising] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState<{
    text: string;
    beforeId: string;
    afterId: string;
  } | null>(null);

  const createMedia = trpc.siteMedia.create.useMutation();
  const createIssue = trpc.issues.issues.create.useMutation();
  const createAttachment = trpc.issues.attachments.create.useMutation();
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

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const m of media) for (const tag of m.tags) set.add(tag);
    return Array.from(set).sort();
  }, [media]);

  const visible = tagFilter === null ? media : media.filter((m) => m.tags.includes(tagFilter));
  const open = openId === null ? null : (media.find((m) => m.id === openId) ?? null);
  const photoCount = useMemo(() => media.filter((m) => m.kind === 'photo').length, [media]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1] as string, id]; // keep last + new
      return [...prev, id];
    });
  }

  function exitCompare() {
    setCompareMode(false);
    setSelected([]);
  }

  async function runCompare() {
    if (selected.length !== 2) return;
    setComparing(true);
    try {
      const res = await fetch('/api/site-media/compare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: selected }),
      });
      if (!res.ok) {
        toast.error(t('mediaCompareError'));
        return;
      }
      const body = (await res.json()) as { comparison: string; beforeId: string; afterId: string };
      setComparison({ text: body.comparison, beforeId: body.beforeId, afterId: body.afterId });
    } catch {
      toast.error(t('mediaCompareError'));
    } finally {
      setComparing(false);
    }
  }

  const comparisonBefore =
    comparison === null ? null : (media.find((m) => m.id === comparison.beforeId) ?? null);
  const comparisonAfter =
    comparison === null ? null : (media.find((m) => m.id === comparison.afterId) ?? null);

  async function handleFiles(files: FileList | null) {
    if (files === null || files.length === 0) return;
    setUploading(true);
    const newPhotoIds: string[] = [];
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
        const created = await createMedia.mutateAsync({
          siteId,
          storageKey: body.storageKey,
          filename: body.filename,
          mimeType: body.mimeType,
          sizeBytes: body.sizeBytes,
        });
        if (body.mimeType.startsWith('image/')) newPhotoIds.push(created.id);
      }
      await utils.siteMedia.list.invalidate({ siteId });
      await utils.sites.getHub.invalidate({ id: siteId });
    } finally {
      setUploading(false);
      if (fileInputRef.current !== null) fileInputRef.current.value = '';
    }

    // Fire auto-tagging for freshly uploaded photos, then refresh so tags show.
    if (newPhotoIds.length > 0) {
      await Promise.allSettled(newPhotoIds.map(analyzeOne));
      await utils.siteMedia.list.invalidate({ siteId });
    }
  }

  async function reAnalyze(id: string) {
    setAnalyzingId(id);
    try {
      await analyzeOne(id);
      await utils.siteMedia.list.invalidate({ siteId });
    } finally {
      setAnalyzingId(null);
    }
  }

  async function raiseObservation(m: (typeof media)[number]) {
    setRaising(true);
    try {
      const res = await fetch('/api/site-media/draft-observation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: m.id }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(err.error === 'NO_CATEGORY' ? t('mediaNoCategory') : t('mediaRaiseError'));
        return;
      }
      const draft = (await res.json()) as {
        title: string;
        description: string;
        categoryId: string;
      };
      const issue = await createIssue.mutateAsync({
        categoryId: draft.categoryId,
        title: draft.title,
        description: draft.description.length > 0 ? draft.description : undefined,
        siteId,
      });
      await createAttachment.mutateAsync({
        issueId: issue.issueId,
        storageKey: m.storageKey,
        filename: m.filename,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
      });
      toast.success(t('mediaRaisedToast'));
      setOpenId(null);
      router.push(`/${locale}/observations?observation=${issue.issueId}`);
    } catch {
      toast.error(t('mediaRaiseError'));
    } finally {
      setRaising(false);
    }
  }

  function dayKeyOf(m: (typeof media)[number]): string {
    return new Date(m.capturedAt ?? m.createdAt).toISOString().slice(0, 10);
  }

  function dayLabel(iso: string): string {
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    const yKey = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    if (iso === todayKey) return t('mediaToday');
    if (iso === yKey) return t('mediaYesterday');
    const d = new Date(`${iso}T00:00:00`);
    return format.dateTime(d, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
    });
  }

  // Group the visible media by the day it was added (newest first — `visible`
  // is already ordered created-desc, so insertion order gives newest groups
  // first). A Google-Photos-style dated timeline.
  const groups: Array<{ key: string; items: Array<(typeof media)[number]> }> = [];
  for (const m of visible) {
    const key = dayKeyOf(m);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.items.push(m);
    else groups.push({ key, items: [m] });
  }

  function renderTile(m: (typeof media)[number]) {
    return (
      <button
        key={m.id}
        type="button"
        onClick={() => {
          if (compareMode) {
            if (m.kind === 'photo') toggleSelect(m.id);
            return;
          }
          setOpenId(m.id);
          setCaptionDraft(m.caption);
        }}
        className={cn(
          'group relative aspect-square overflow-hidden rounded-lg border bg-muted',
          selected.includes(m.id) ? 'ring-2 ring-primary ring-offset-2' : '',
          compareMode && m.kind !== 'photo' ? 'cursor-not-allowed opacity-40' : '',
        )}
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
        {compareMode && selected.includes(m.id) ? (
          <span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3.5 w-3.5" />
          </span>
        ) : null}
        {m.tags.length > 0 ? (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-primary/90 p-1">
            <Sparkles className="h-3 w-3 text-primary-foreground" />
          </span>
        ) : null}
        {/* Always-visible caption strip (collapses under the hover overlay). */}
        {m.caption.length > 0 ? (
          <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-left text-xs text-white group-hover:opacity-0">
            {m.caption}
          </div>
        ) : null}
        {/* On hover: title + type + who uploaded it. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/30 to-transparent p-2 text-left opacity-0 transition-opacity group-hover:opacity-100">
          <p className="line-clamp-2 text-xs font-medium leading-snug text-white">
            {m.caption.length > 0 ? m.caption : m.filename}
          </p>
          <p className="mt-0.5 text-[10px] leading-tight text-white/80">
            {m.kind === 'video' ? t('mediaTypeVideo') : t('mediaTypePhoto')} ·{' '}
            {t('mediaUploadedBy')} {m.uploaderName ?? '—'}
          </p>
        </div>
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('mediaTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('mediaSubtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {compareMode ? (
            <>
              <Button
                variant="secondary"
                onClick={() => void runCompare()}
                disabled={selected.length !== 2 || comparing}
              >
                <GitCompare className="mr-1.5 h-4 w-4" />
                {comparing
                  ? t('mediaComparing')
                  : t('mediaCompareSelected', { count: selected.length })}
              </Button>
              <Button variant="ghost" onClick={exitCompare}>
                {t('mediaCompareCancel')}
              </Button>
            </>
          ) : (
            <>
              {photoCount >= 2 ? (
                <Button variant="outline" onClick={() => setCompareMode(true)}>
                  <GitCompare className="mr-1.5 h-4 w-4" />
                  {t('mediaCompare')}
                </Button>
              ) : null}
              <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <ImagePlus className="mr-1.5 h-4 w-4" />
                {uploading ? t('mediaUploading') : t('mediaAdd')}
              </Button>
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      {allTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <button
            type="button"
            onClick={() => setTagFilter(null)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
              tagFilter === null
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input text-muted-foreground hover:text-foreground',
            )}
          >
            {t('mediaAllTags')}
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setTagFilter(tag)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                tagFilter === tag
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input text-muted-foreground hover:text-foreground',
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}

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
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.key} className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">
                {dayLabel(g.key)}{' '}
                <span className="font-normal text-muted-foreground">({g.items.length})</span>
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {g.items.map(renderTile)}
              </div>
            </div>
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

              {open.tags.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  {open.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}

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
                  <div className="flex items-center gap-1">
                    {open.kind === 'photo' && canReport ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={raising}
                        onClick={() => void raiseObservation(open)}
                      >
                        <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                        {raising ? t('mediaRaising') : t('mediaRaiseObservation')}
                      </Button>
                    ) : null}
                    {open.kind === 'photo' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={analyzingId === open.id}
                        onClick={() => void reAnalyze(open.id)}
                      >
                        <Sparkles className="mr-1 h-3.5 w-3.5" />
                        {analyzingId === open.id ? t('mediaAnalyzing') : t('mediaAutoTag')}
                      </Button>
                    ) : null}
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
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={comparison !== null} onOpenChange={(o) => !o && setComparison(null)}>
        <DialogContent className="max-w-4xl">
          {comparison !== null ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-base font-semibold">
                <GitCompare className="h-4 w-4 text-primary" />
                {t('mediaCompareTitle')}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <figure className="space-y-1">
                  {comparisonBefore !== null ? (
                    <img
                      src={fileUrl(comparisonBefore.storageKey)}
                      alt={t('mediaCompareBefore')}
                      className="aspect-video w-full rounded-md object-cover"
                    />
                  ) : null}
                  <figcaption className="text-center text-xs text-muted-foreground">
                    {t('mediaCompareBefore')}
                  </figcaption>
                </figure>
                <figure className="space-y-1">
                  {comparisonAfter !== null ? (
                    <img
                      src={fileUrl(comparisonAfter.storageKey)}
                      alt={t('mediaCompareAfter')}
                      className="aspect-video w-full rounded-md object-cover"
                    />
                  ) : null}
                  <figcaption className="text-center text-xs text-muted-foreground">
                    {t('mediaCompareAfter')}
                  </figcaption>
                </figure>
              </div>
              <div className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm leading-relaxed">
                {comparison.text.length > 0 ? comparison.text : t('mediaCompareEmpty')}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
