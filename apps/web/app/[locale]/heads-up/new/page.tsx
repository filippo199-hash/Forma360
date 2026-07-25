'use client';

import {
  CheckCircle,
  ChevronUp,
  Eye,
  FileText,
  Loader2,
  Paperclip,
  PenLine,
  QrCode,
  Smile,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FocusedPageShell } from '../../../../src/components/focused-page-shell';
import { GroupUserSelector } from '../../../../src/components/selectors/group-user-selector';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../../src/components/ui/dropdown-menu';
import { AutoGrowTextarea } from '../../../../src/components/ui/auto-grow-textarea';
import { Input } from '../../../../src/components/ui/input';
import { Separator } from '../../../../src/components/ui/separator';
import { Switch } from '../../../../src/components/ui/switch';
import { cn } from '../../../../src/lib/cn';
import { usePlaceTerms } from '../../../../src/lib/terminology';
import { trpc } from '../../../../src/lib/trpc/client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PendingFile {
  /** Temp local ID for keying the list. */
  localId: string;
  file: File;
  /** Object URL for image previews. */
  previewUrl: string | null;
  /** Set once the upload completes. */
  storageKey: string | null;
  uploading: boolean;
  error: string | null;
}

type PreviewDevice = 'tablet' | 'mobile';
type EngagementLevel = 'view' | 'acknowledge' | 'sign';

const ENGAGEMENT_OPTIONS: Array<{
  value: EngagementLevel;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: 'view', icon: Eye },
  { value: 'acknowledge', icon: CheckCircle },
  { value: 'sign', icon: PenLine },
];

const EMOJI_MAP: Record<string, string> = {
  celebrate: '🎉',
  clap: '👏',
  smile: '😄',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function scheduleLabel(
  type: 'now' | 'tomorrow' | 'nextweek',
  locale: string,
  timeLabel: string,
): string {
  const now = new Date();
  if (type === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return `${d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}, ${timeLabel}`;
  }
  if (type === 'nextweek') {
    const d = new Date(now);
    d.setDate(d.getDate() + ((7 - d.getDay() + 3) % 7) || 7); // next Wednesday
    d.setHours(9, 0, 0, 0);
    return `${d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}, ${timeLabel}`;
  }
  return '';
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NewHeadsUpPage() {
  const t = useTranslations('headsUp.new');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();
  const placeTerms = usePlaceTerms();

  // ── Form state ──
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [allowComments, setAllowComments] = useState(true);
  const [allowReactions, setAllowReactions] = useState(true);
  const [engagementLevel, setEngagementLevel] = useState<EngagementLevel>('view');
  const [audienceMode, setAudienceMode] = useState<'everyone' | 'groups' | 'sites' | 'users'>(
    'everyone',
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [audienceError, setAudienceError] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [sitesOpen, setSitesOpen] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('tablet');
  const [publishAt, setPublishAt] = useState<Date | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [docQuery, setDocQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: groupsData, error: groupsError } = trpc.groups.list.useQuery(undefined, {
    staleTime: 60_000,
  });
  const groups = groupsData ?? [];
  const selectedGroupNames = groups
    .filter((g) => selectedGroupIds.includes(g.id))
    .map((g) => g.name);

  const { data: sitesData, error: sitesError } = trpc.sites.list.useQuery(undefined, {
    staleTime: 60_000,
    enabled: audienceMode === 'sites',
  });
  const sites = sitesData ?? [];
  const selectedSiteNames = sites.filter((s) => selectedSiteIds.includes(s.id)).map((s) => s.name);

  function toggleGroup(id: string) {
    setAudienceError(false);
    setSelectedGroupIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleSite(id: string) {
    setAudienceError(false);
    setSelectedSiteIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const { data: allDocuments = [], error: documentsError } = trpc.documents.list.useQuery({});

  // ── tRPC mutations ──
  // `create` always writes a draft; publishing immediately is a create→publish
  // chain (the "Publish" button must actually publish, not just save a draft).
  // A scheduled publishAt is left as a draft for the schedule job to publish.
  const publishAfterCreateRef = useRef(false);
  const createdIdRef = useRef<string | null>(null);

  const publishMutation = trpc.headsUps.publish.useMutation({
    onSuccess: () => {
      toast.success(t('publishedToast'));
      if (createdIdRef.current !== null) router.push(`/${locale}/heads-up/${createdIdRef.current}`);
    },
    onError: (err) => {
      // The draft exists — send the user to the detail page to retry publish.
      toast.error(err.message.length > 0 ? err.message : tCommon('error'));
      if (createdIdRef.current !== null) router.push(`/${locale}/heads-up/${createdIdRef.current}`);
    },
  });

  const createMutation = trpc.headsUps.create.useMutation({
    onSuccess: ({ headsUpId }) => {
      if (publishAfterCreateRef.current) {
        // Publish resolves recipients from the recipientSpec just stored.
        createdIdRef.current = headsUpId;
        publishMutation.mutate({ headsUpId });
        return;
      }
      toast.success(t('savedToast'));
      router.push(`/${locale}/heads-up/${headsUpId}`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  // ── File upload ──
  const uploadFile = useCallback(async (localId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch('/api/upload/heads-up', { method: 'POST', body: form });
      if (!res.ok) {
        // Parse JSON cautiously — a proxy/framework error might return HTML.
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }
      const { key } = (await res.json()) as { key: string };
      setPendingFiles((prev) =>
        prev.map((f) => (f.localId === localId ? { ...f, storageKey: key, uploading: false } : f)),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setPendingFiles((prev) =>
        prev.map((f) => (f.localId === localId ? { ...f, error: msg, uploading: false } : f)),
      );
    }
  }, []);

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const remaining = 6 - pendingFiles.length;
    if (remaining <= 0) {
      toast.error(t('maxFilesError'));
      return;
    }
    const toAdd = arr.slice(0, remaining);
    const newEntries: PendingFile[] = toAdd.map((file) => {
      const localId = `${Date.now()}-${Math.random()}`;
      const previewUrl = isImage(file.type) ? URL.createObjectURL(file) : null;
      return { localId, file, previewUrl, storageKey: null, uploading: true, error: null };
    });
    setPendingFiles((prev) => [...prev, ...newEntries]);
    for (const entry of newEntries) {
      void uploadFile(entry.localId, entry.file);
    }
  }

  function removeFile(localId: string) {
    setPendingFiles((prev) => {
      const entry = prev.find((f) => f.localId === localId);
      if (entry?.previewUrl !== null && entry?.previewUrl !== undefined) {
        URL.revokeObjectURL(entry.previewUrl);
      }
      return prev.filter((f) => f.localId !== localId);
    });
  }

  // ── Drag-and-drop ──
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }
  function onDragLeave() {
    setIsDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }

  // ── Publish schedule helpers ──
  function setSchedule(type: 'now' | 'tomorrow' | 'nextweek') {
    if (type === 'now') {
      setPublishAt(null);
      return;
    }
    const d = new Date();
    if (type === 'tomorrow') {
      d.setDate(d.getDate() + 1);
    } else {
      d.setDate(d.getDate() + ((7 - d.getDay() + 3) % 7) || 7);
    }
    d.setHours(9, 0, 0, 0);
    setPublishAt(d);
  }

  // ── Submit ──
  function save(andPublish: boolean) {
    if (title.trim().length === 0) {
      toast.error(t('titleRequired'));
      return;
    }
    const stillUploading = pendingFiles.some((f) => f.uploading);
    if (stillUploading) {
      toast.error(t('waitForUploads'));
      return;
    }
    const audienceEmpty =
      (audienceMode === 'groups' && selectedGroupIds.length === 0) ||
      (audienceMode === 'sites' && selectedSiteIds.length === 0) ||
      (audienceMode === 'users' && selectedUserIds.length === 0);
    if (audienceEmpty) {
      setAudienceError(true);
      toast.error(t('selectAudience'));
      return;
    }
    const readyAttachments = pendingFiles
      .filter(
        (f): f is typeof f & { storageKey: string } => f.storageKey !== null && f.error === null,
      )
      .map((f) => ({
        storageKey: f.storageKey,
        filename: f.file.name,
        mimeType: f.file.type || 'application/octet-stream',
        sizeBytes: f.file.size,
      }));

    const recipientSpec = JSON.stringify({
      broadcastToAll: audienceMode === 'everyone',
      groupIds: audienceMode === 'groups' ? selectedGroupIds : [],
      siteIds: audienceMode === 'sites' ? selectedSiteIds : [],
      userIds: audienceMode === 'users' ? selectedUserIds : [],
    });

    // Publish immediately only for an unscheduled "Publish"; a scheduled
    // publishAt stays a draft until the schedule fires.
    publishAfterCreateRef.current = andPublish && publishAt === null;

    createMutation.mutate({
      title: title.trim(),
      description: description.trim(),
      engagementLevel,
      requireAcknowledgement: engagementLevel === 'acknowledge' || engagementLevel === 'sign',
      requireSignature: engagementLevel === 'sign',
      allowComments,
      allowReactions,
      publishAt: andPublish && publishAt !== null ? publishAt.toISOString() : undefined,
      attachments: readyAttachments,
      documentIds: selectedDocumentIds,
      recipientSpec,
    });
  }

  const canSave =
    title.trim().length > 0 && !createMutation.isPending && !publishMutation.isPending;

  // ── Preview card ──
  const previewTitle = title.trim().length > 0 ? title : t('previewUntitled');

  return (
    <FocusedPageShell title={t('pageTitle')} backHref={`/${locale}/heads-up`} width="split">
      {/* ── Left: form (480px on desktop, full width on mobile) ── */}
      <div className="flex h-full w-full flex-col overflow-y-auto border-r bg-background md:w-[480px] md:shrink-0">
        {/* Body */}
        <div className="flex-1 space-y-6 px-5 py-6">
          {/* ── Media upload ── */}
          <section>
            <h2 className="mb-2 text-sm font-semibold">{t('addMedia')}</h2>
            <div
              role="button"
              tabIndex={0}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
                isDragging
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-muted/30',
              )}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">{t('dragFiles')}</p>
              <p className="text-xs text-primary underline">{t('browseUpload')}</p>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{t('mediaHint')}</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.mov,.mp4"
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />

            {/* File chips */}
            {pendingFiles.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {pendingFiles.map((pf) => (
                  <li
                    key={pf.localId}
                    className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2"
                  >
                    {pf.previewUrl !== null ? (
                      <img
                        src={pf.previewUrl}
                        alt={pf.file.name}
                        className="h-9 w-9 rounded object-cover"
                      />
                    ) : (
                      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{pf.file.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatBytes(pf.file.size)}
                      </p>
                      {pf.error !== null ? (
                        <p className="text-[10px] text-destructive">{pf.error}</p>
                      ) : null}
                    </div>
                    {pf.uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(pf.localId);
                        }}
                        className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <Separator />

          {/* ── Attach library document (#4) ── */}
          <section>
            <h2 className="mb-1 text-sm font-semibold">{t('attachDocument')}</h2>
            <p className="mb-2 text-xs text-muted-foreground">{t('attachDocumentHint')}</p>
            <Input
              value={docQuery}
              onChange={(e) => setDocQuery(e.target.value)}
              placeholder={t('searchDocuments')}
              className="h-9"
            />
            {documentsError !== null ? (
              <p className="mt-1.5 text-xs text-destructive">{tCommon('error')}</p>
            ) : null}
            {selectedDocumentIds.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedDocumentIds.map((id) => {
                  const d = allDocuments.find((x) => x.id === id);
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs text-primary"
                    >
                      {d?.name ?? tCommon('loading')}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedDocumentIds((prev) => prev.filter((x) => x !== id))
                        }
                        className="rounded-full p-0.5 hover:bg-primary/20"
                        aria-label={tCommon('remove')}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : null}
            {docQuery.trim().length > 0 ? (
              <ul className="mt-2 max-h-44 overflow-y-auto rounded-md border">
                {allDocuments
                  .filter(
                    (d) =>
                      !selectedDocumentIds.includes(d.id) &&
                      d.name.toLowerCase().includes(docQuery.trim().toLowerCase()),
                  )
                  .slice(0, 20)
                  .map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDocumentIds((prev) => [...prev, d.id]);
                          setDocQuery('');
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/60"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{d.name}</span>
                      </button>
                    </li>
                  ))}
                {allDocuments.filter(
                  (d) =>
                    !selectedDocumentIds.includes(d.id) &&
                    d.name.toLowerCase().includes(docQuery.trim().toLowerCase()),
                ).length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted-foreground">{t('noDocuments')}</li>
                ) : null}
              </ul>
            ) : null}
          </section>

          <Separator />

          {/* ── Title ── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="hu-title" className="text-sm font-semibold">
                {t('fields.title')} <span className="text-destructive">*</span>
              </label>
              <span className="text-xs text-muted-foreground">{title.length}/500</span>
            </div>
            <Input
              id="hu-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('fields.titlePlaceholder')}
              maxLength={500}
            />
          </div>

          {/* ── Description ── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="hu-desc" className="text-sm font-semibold">
                {t('fields.description')}
              </label>
              <span className="text-xs text-muted-foreground">{description.length}/5000</span>
            </div>
            <AutoGrowTextarea
              id="hu-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('fields.descriptionPlaceholder')}
              rows={5}
              maxLength={5000}
              className="flex min-h-[112px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <Separator />

          {/* ── Share externally ── */}
          <section>
            <h2 className="mb-0.5 text-sm font-semibold">{t('shareExternally')}</h2>
            <p className="mb-3 text-xs text-muted-foreground">{t('shareExternallyHint')}</p>
            <div className="flex items-center gap-2">
              <QrCode className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="flex-1 text-xs text-muted-foreground italic">
                {t('shareLinkAfterSave')}
              </p>
            </div>
          </section>

          <Separator />

          {/* ── Engagement level ── */}
          <section>
            <h2 className="mb-3 text-sm font-semibold">{t('engagementLevel')}</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {ENGAGEMENT_OPTIONS.map(({ value, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setEngagementLevel(value)}
                  className={cn(
                    'flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors',
                    engagementLevel === value
                      ? 'border-foreground bg-foreground/5'
                      : 'border-input hover:border-foreground/40',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4',
                      engagementLevel === value ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  />
                  <div>
                    <p className="text-xs font-medium">{t(`engagement.${value}`)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {t(`engagementHint.${value}`)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* ── Audience ── */}
          <section>
            <h2 className="mb-2 text-sm font-semibold">{t('fields.audienceLabel')}</h2>

            {/* Mode toggle — 4 options */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['everyone', 'groups', 'sites', 'users'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setAudienceMode(mode);
                    setAudienceError(false);
                    if (mode !== 'groups') setGroupsOpen(false);
                    if (mode !== 'sites') setSitesOpen(false);
                  }}
                  className={cn(
                    'rounded-lg border px-2 py-2 text-center text-xs font-medium transition-colors',
                    audienceMode === mode
                      ? 'border-foreground bg-foreground/5 text-foreground'
                      : 'border-input text-muted-foreground hover:border-foreground/40',
                  )}
                >
                  {mode === 'everyone'
                    ? t('fields.audienceEveryone')
                    : mode === 'groups'
                      ? t('fields.audienceGroups')
                      : mode === 'sites'
                        ? placeTerms.labelPlural
                        : t('fields.audienceUsers')}
                </button>
              ))}
            </div>

            {audienceError ? (
              <p className="mt-2 text-xs text-destructive">{t('selectAudience')}</p>
            ) : null}

            {/* Groups picker */}
            {audienceMode === 'groups' ? (
              <div className="mt-3">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setGroupsOpen((o) => !o)}
                    className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted/40"
                  >
                    <span className={selectedGroupIds.length === 0 ? 'text-muted-foreground' : ''}>
                      {selectedGroupIds.length === 0
                        ? t('fields.assignToPlaceholder')
                        : selectedGroupNames.join(', ')}
                    </span>
                    <span className="ml-2 text-muted-foreground">▾</span>
                  </button>
                  {groupsOpen ? (
                    <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
                      {groups.length === 0 ? (
                        <p className="p-3 text-sm text-muted-foreground">{t('fields.noGroups')}</p>
                      ) : (
                        <ul className="max-h-48 overflow-y-auto py-1">
                          {groups.map((g) => (
                            <li key={g.id}>
                              <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40">
                                <input
                                  type="checkbox"
                                  checked={selectedGroupIds.includes(g.id)}
                                  onChange={() => toggleGroup(g.id)}
                                  className="h-4 w-4"
                                />
                                {g.name}
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
                {groupsError !== null ? (
                  <p className="mt-1.5 text-xs text-destructive">{tCommon('error')}</p>
                ) : null}
                {selectedGroupNames.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selectedGroupNames.map((name) => (
                      <span
                        key={name}
                        className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Sites picker */}
            {audienceMode === 'sites' ? (
              <div className="mt-3">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSitesOpen((o) => !o)}
                    className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted/40"
                  >
                    <span className={selectedSiteIds.length === 0 ? 'text-muted-foreground' : ''}>
                      {selectedSiteIds.length === 0
                        ? placeTerms.addPlaceholder
                        : selectedSiteNames.join(', ')}
                    </span>
                    <span className="ml-2 text-muted-foreground">▾</span>
                  </button>
                  {sitesOpen ? (
                    <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
                      {sites.length === 0 ? (
                        <p className="p-3 text-sm text-muted-foreground">{t('fields.noSites')}</p>
                      ) : (
                        <ul className="max-h-48 overflow-y-auto py-1">
                          {sites.map((s) => (
                            <li key={s.id}>
                              <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40">
                                <input
                                  type="checkbox"
                                  checked={selectedSiteIds.includes(s.id)}
                                  onChange={() => toggleSite(s.id)}
                                  className="h-4 w-4"
                                />
                                {s.name}
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
                {sitesError !== null ? (
                  <p className="mt-1.5 text-xs text-destructive">{tCommon('error')}</p>
                ) : null}
                {selectedSiteNames.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selectedSiteNames.map((name) => (
                      <span
                        key={name}
                        className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Users picker */}
            {audienceMode === 'users' ? (
              <div className="mt-3">
                <GroupUserSelector
                  mode="users"
                  multiple
                  value={selectedUserIds}
                  onChange={(next) => {
                    setAudienceError(false);
                    setSelectedUserIds(next);
                  }}
                  placeholder={t('fields.selectUsersPlaceholder')}
                />
              </div>
            ) : null}
          </section>

          {/* ── Settings ── */}
          <section>
            <h2 className="mb-3 text-sm font-semibold">{t('settingsHeading')}</h2>
            <div className="divide-y rounded-lg border">
              <SettingRow
                label={t('settings.allowComments')}
                checked={allowComments}
                onCheckedChange={setAllowComments}
                id="setting-comments"
              />
              <SettingRow
                label={t('settings.allowReactions')}
                checked={allowReactions}
                onCheckedChange={setAllowReactions}
                id="setting-reactions"
              />
            </div>
          </section>

          {publishAt !== null ? (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {t('scheduledFor')}:{' '}
              <strong>
                {publishAt.toLocaleString(locale, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </strong>
              <button
                type="button"
                className="ml-2 text-destructive hover:underline"
                onClick={() => setPublishAt(null)}
              >
                <X className="inline h-3 w-3" />
              </button>
            </p>
          ) : null}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between gap-3 border-t bg-background px-5 py-4">
          <Button variant="ghost" asChild>
            <Link href={`/${locale}/heads-up`}>{tCommon('cancel')}</Link>
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="outline" disabled={!canSave} onClick={() => save(false)}>
              {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('saveDraft')}
            </Button>

            {/* Publish with schedule dropdown */}
            <div className="flex">
              <Button className="rounded-r-none" disabled={!canSave} onClick={() => save(true)}>
                {t('publish')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="rounded-l-none border-l border-primary-foreground/20 px-2"
                    disabled={!canSave}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                    {t('publishMenu')}:
                  </p>
                  <DropdownMenuItem
                    onClick={() => {
                      setSchedule('tomorrow');
                      toast.info(
                        t('scheduledFor') +
                          ': ' +
                          scheduleLabel('tomorrow', locale, t('publishTime9am')),
                      );
                    }}
                  >
                    <span className="flex-1">{t('publishTomorrow')}</span>
                    <span className="text-xs text-muted-foreground">{t('publishTime9am')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setSchedule('nextweek');
                      toast.info(
                        t('scheduledFor') +
                          ': ' +
                          scheduleLabel('nextweek', locale, t('publishTime9am')),
                      );
                    }}
                  >
                    <span className="flex-1">{t('publishNextWeek')}</span>
                    <span className="text-xs text-muted-foreground">{t('publishTime9am')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: preview ── */}
      <div className="hidden flex-1 flex-col bg-slate-100 dark:bg-slate-900 md:flex">
        <div className="flex items-center justify-between border-b bg-background/80 px-6 py-3">
          <p className="text-sm font-semibold">{t('preview')}</p>
          <div className="flex rounded-md border">
            {(['tablet', 'mobile'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setPreviewDevice(d)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md',
                  previewDevice === d
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {t(`previewDevice.${d}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-1 items-start justify-center overflow-auto p-8">
          <div
            className={cn(
              'rounded-2xl bg-background shadow-xl transition-all duration-200',
              previewDevice === 'mobile' ? 'w-80' : 'w-[520px]',
            )}
          >
            {/* Acknowledge / Sign bar */}
            {engagementLevel !== 'view' ? (
              <div className="flex justify-end rounded-t-2xl border-b bg-muted/40 px-4 py-2">
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground"
                >
                  ✓{' '}
                  {engagementLevel === 'acknowledge'
                    ? t('previewAcknowledge')
                    : t('engagement.sign')}
                </button>
              </div>
            ) : null}

            <div className="p-5">
              {/* Author row */}
              <div className="mb-4 flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {t('previewAuthorInitials')}
                </div>
                <div>
                  <p className="text-xs font-medium">{t('previewAuthorYou')}</p>
                  <p className="text-[10px] text-muted-foreground">{t('previewJustNow')}</p>
                </div>
              </div>

              {/* Title */}
              <h3 className="mb-2 text-base font-semibold">{previewTitle}</h3>

              {/* Description */}
              {description.trim().length > 0 ? (
                <p className="mb-4 whitespace-pre-wrap text-sm text-muted-foreground">
                  {description.trim()}
                </p>
              ) : null}

              {/* Media thumbnails */}
              {pendingFiles.length > 0 ? (
                <div className="mb-4 flex flex-wrap gap-2">
                  {pendingFiles.map((pf) =>
                    pf.previewUrl !== null ? (
                      <img
                        key={pf.localId}
                        src={pf.previewUrl}
                        alt={pf.file.name}
                        className="h-16 w-16 rounded-md object-cover"
                      />
                    ) : (
                      <div
                        key={pf.localId}
                        className="flex h-16 w-16 items-center justify-center rounded-md bg-muted"
                      >
                        <Paperclip className="h-5 w-5 text-muted-foreground" />
                      </div>
                    ),
                  )}
                </div>
              ) : null}

              <Separator className="my-3" />

              {/* Stats row */}
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span>{t('previewStats.views')}</span>
                {engagementLevel === 'acknowledge' || engagementLevel === 'sign' ? (
                  <span>{t('previewStats.acknowledged')}</span>
                ) : null}
                {engagementLevel === 'sign' ? <span>{t('previewStats.signed')}</span> : null}
                {allowComments ? <span>{t('previewStats.comments')}</span> : null}
              </div>

              {/* Reactions */}
              {allowReactions ? (
                <div className="mt-3 flex gap-2">
                  {Object.entries(EMOJI_MAP).map(([key, emoji]) => (
                    <button
                      key={key}
                      type="button"
                      className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted"
                    >
                      {emoji} <span className="text-muted-foreground">1</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
                  >
                    <Smile className="h-3 w-3" />
                  </button>
                </div>
              ) : null}

              {/* Comment prompt */}
              {allowComments ? (
                <div className="mt-4 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground italic">
                  {t('previewCommentPrompt')}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </FocusedPageShell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SettingRow({
  label,
  checked,
  onCheckedChange,
  id,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  id: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <label htmlFor={id} className="cursor-pointer text-sm">
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
