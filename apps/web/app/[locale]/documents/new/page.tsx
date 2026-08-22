'use client';

import { FileUp, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { FocusedPageShell } from '../../../../src/components/focused-page-shell';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { cn } from '../../../../src/lib/cn';
import { usePlaceTerms } from '../../../../src/lib/terminology';
import { GroupUserSelector } from '../../../../src/components/selectors/group-user-selector';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { trpc } from '../../../../src/lib/trpc/client';
import { useSubmitGuard } from '../../../../src/lib/use-submit-guard';
import { useServerErrorToast } from '../../../../src/lib/use-server-error';

const MAX_BYTES = 50 * 1024 * 1024;

const REMINDER_OPTIONS = [1, 7, 14, 30, 60, 90] as const;

/** Curated palette for the inline label creator — same spectrum the
 *  default seed picks from, but presented as click-to-pick swatches. */
const LABEL_COLORS = [
  '#6366f1', // indigo
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#84cc16', // lime
  '#eab308', // yellow
  '#f97316', // orange
  '#ef4444', // red
  '#ec4899', // pink
  '#a855f7', // purple
  '#64748b', // slate
] as const;

type UploadedFile = {
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

type ResponsibleType = 'none' | 'user' | 'group';

export default function DocumentNewPage() {
  const t = useTranslations('documents.upload');
  const { label: placeLabel, noneLabel: placeNone } = usePlaceTerms();
  const tCommon = useTranslations('common');
  // The visibility copy already exists on the detail page's Access tab.
  const tDetail = useTranslations('documents.detail');
  const onServerError = useServerErrorToast(t('errorToast'));
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();
  const searchParams = useSearchParams();

  // File upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [folderId, setFolderId] = useState<string>('');
  const [siteId, setSiteId] = useState<string>(() => searchParams.get('site') ?? '');
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [responsibleType, setResponsibleType] = useState<ResponsibleType>('none');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [responsibleGroupId, setResponsibleGroupId] = useState('');
  // DC-S05: the schema default is `[]` = visible to everyone, and this form
  // had no visibility control at all — so a restricted contract was readable
  // by the whole tenant, and returned by search and the Heads-Up picker, from
  // the moment it was uploaded until someone remembered the Access tab.
  const [visGroupIds, setVisGroupIds] = useState<string[]>([]);
  const [visSiteIds, setVisSiteIds] = useState<string[]>([]);
  const [reminderDays, setReminderDays] = useState<number[]>([]);
  const [freshnessDays, setFreshnessDays] = useState('');

  // Inline label-creator state
  const [labelCreatorOpen, setLabelCreatorOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState<string>(LABEL_COLORS[0]);

  // Data queries
  const utils = trpc.useUtils();
  const { data: folders = [], isLoading: foldersLoading } = trpc.documentFolders.list.useQuery({});
  const { data: labels = [], isLoading: labelsLoading } = trpc.documentLabels.list.useQuery();
  const { data: usersData, isLoading: usersLoading } = trpc.users.list.useQuery({});
  const users = usersData?.users ?? [];
  const { data: groups = [], isLoading: groupsLoading } = trpc.groups.list.useQuery();

  const createLabel = trpc.documentLabels.create.useMutation({
    onSuccess: ({ labelId }) => {
      // Auto-select the newly created label so the user doesn't have to
      // click twice.
      setSelectedLabelIds((prev) => [...prev, labelId]);
      setNewLabelName('');
      setLabelCreatorOpen(false);
      void utils.documentLabels.list.invalidate();
    },
    onError: onServerError,
  });

  const submitGuard = useSubmitGuard();
  const createDocument = trpc.documents.create.useMutation({
    onSettled: submitGuard.release,
    onSuccess: ({ documentId }) => {
      toast.success(t('successToast'));
      router.push(`/${locale}/documents/${documentId}`);
    },
    onError: onServerError,
  });

  function submitNewLabel() {
    const name = newLabelName.trim();
    if (name.length === 0 || createLabel.isPending) return;
    createLabel.mutate({ name, color: newLabelColor });
  }

  const isSubmitting = createDocument.isPending;

  async function uploadFile(file: File): Promise<void> {
    if (file.size > MAX_BYTES) {
      toast.error(t('fileSizeError'));
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        // Empty sentinel so the catch below falls back to the generic
        // key when the server gave us no specific reason.
        throw new Error(body.error ?? '');
      }
      const result = (await res.json()) as UploadedFile;
      setUploadedFile(result);
      if (name.trim().length === 0) {
        // Strip extension for the default document name
        const base = result.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        setName(base.trim());
      }
    } catch (error) {
      // Surface the server's specific reason when present; fall back to the
      // generic toast only when there's no message to show.
      const message = error instanceof Error ? error.message.trim() : '';
      toast.error(message.length > 0 ? message : t('errorToast'));
    } finally {
      setIsUploading(false);
    }
  }

  // A document is one file + metadata, so we only ever take the first file.
  // If several are dropped/selected, hint that the rest are ignored.
  function takeFirstFile(files: FileList): File | undefined {
    if (files.length > 1) toast(t('oneFileHint'));
    return files[0];
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files === null) return;
    const file = takeFirstFile(e.target.files);
    if (file !== undefined) void uploadFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = takeFirstFile(e.dataTransfer.files);
    if (file !== undefined) void uploadFile(file);
  }

  function toggleLabel(id: string) {
    setSelectedLabelIds((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id],
    );
  }

  function toggleReminder(days: number) {
    setReminderDays((prev) =>
      prev.includes(days) ? prev.filter((d) => d !== days) : [...prev, days],
    );
  }

  function handleSubmit(e: React.FormEvent) {
    if (!submitGuard.take()) return;
    e.preventDefault();
    if (uploadedFile === null) return;
    if (name.trim().length === 0) return;

    const parsed = freshnessDays.trim().length > 0 ? parseInt(freshnessDays, 10) : undefined;

    createDocument.mutate({
      storageKey: uploadedFile.storageKey,
      filename: uploadedFile.filename,
      mimeType: uploadedFile.mimeType,
      sizeBytes: uploadedFile.sizeBytes,
      name: name.trim(),
      description: description.trim(),
      folderId: folderId.length > 0 ? folderId : undefined,
      siteId: siteId.length > 0 ? siteId : undefined,
      labelIds: selectedLabelIds,
      startDate: startDate.length > 0 ? new Date(startDate).toISOString() : null,
      expiresAt: expiresAt.length > 0 ? new Date(expiresAt).toISOString() : null,
      responsibleUserId:
        responsibleType === 'user' && responsibleUserId.length > 0 ? responsibleUserId : null,
      responsibleGroupId:
        responsibleType === 'group' && responsibleGroupId.length > 0 ? responsibleGroupId : null,
      reminderDays,
      freshnessDays: parsed !== undefined && !isNaN(parsed) ? parsed : undefined,
      visibleToGroupIds: visGroupIds,
      visibleToSiteIds: visSiteIds,
    });
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <FocusedPageShell title={t('title')} backHref={`/${locale}/documents`} width="form">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* File drop zone (single box — no outer Card wrapper) */}
        <div className="space-y-2">
          <Label>{t('fileLabel')}</Label>
          {uploadedFile === null ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed bg-background px-6 py-10 text-center transition-colors',
                isDragging
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/60 hover:bg-muted/40',
              )}
            >
              {isUploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <span className="text-sm text-muted-foreground">{t('uploadingText')}</span>
                </div>
              ) : (
                <>
                  <FileUp className="mb-3 h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">{t('filePlaceholder')}</p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileChange}
                disabled={isUploading}
              />
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border bg-background px-4 py-3">
              <div className="flex items-center gap-3">
                <FileUp className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{uploadedFile.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(uploadedFile.sizeBytes)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUploadedFile(null);
                  if (fileInputRef.current !== null) fileInputRef.current.value = '';
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Metadata — shown after file is chosen */}
        <div className="grid gap-6 md:grid-cols-[1fr_320px]">
          {/* Left column */}
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="doc-name">{t('nameLabel')}</Label>
              <Input
                id="doc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={500}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="doc-desc">{t('descriptionLabel')}</Label>
              <Textarea
                id="doc-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={5000}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="doc-folder">{t('folderLabel')}</Label>
              {foldersLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <select
                  id="doc-folder"
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">{t('noFolder')}</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>{placeLabel}</Label>
              <SiteSelector
                value={siteId !== '' ? [siteId] : []}
                onChange={(next) => setSiteId(next[0] ?? '')}
                multiple={false}
                placeholder={placeNone}
              />
            </div>

            {/* DC-S05: restrict it now, not after it has been readable by
                everyone for however long it takes to remember. */}
            <div className="space-y-3">
              <div>
                <Label>{tDetail('visibilityHeading')}</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {visGroupIds.length === 0 && visSiteIds.length === 0
                    ? tDetail('visibleToEveryone')
                    : tDetail('visibilityHelp')}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <GroupUserSelector
                  value={visGroupIds}
                  onChange={setVisGroupIds}
                  mode="groups"
                  label={tDetail('visGroupsLabel')}
                />
                <SiteSelector value={visSiteIds} onChange={setVisSiteIds} label={placeLabel} />
              </div>
            </div>

            {/* Labels */}
            <div className="space-y-2">
              <Label>{t('labelsLabel')}</Label>
              {labelsLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {labels.map((lbl) => {
                      const selected = selectedLabelIds.includes(lbl.id);
                      return (
                        <button
                          key={lbl.id}
                          type="button"
                          onClick={() => toggleLabel(lbl.id)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
                            selected
                              ? 'border-transparent text-white shadow-sm'
                              : 'border-border bg-background text-foreground hover:bg-muted',
                          )}
                          style={selected ? { backgroundColor: lbl.color } : undefined}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: lbl.color }}
                          />
                          {lbl.name}
                        </button>
                      );
                    })}
                    {!labelCreatorOpen ? (
                      <button
                        type="button"
                        onClick={() => setLabelCreatorOpen(true)}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                      >
                        <Plus className="h-3 w-3" />
                        {labels.length === 0 ? t('labelsCreateFirst') : t('labelsCreate')}
                      </button>
                    ) : null}
                  </div>

                  {labelCreatorOpen ? (
                    <div className="space-y-2 rounded-lg border bg-background p-3">
                      <div className="flex items-center gap-2">
                        <Input
                          autoFocus
                          value={newLabelName}
                          onChange={(e) => setNewLabelName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              submitNewLabel();
                            }
                            if (e.key === 'Escape') setLabelCreatorOpen(false);
                          }}
                          placeholder={t('labelsNamePlaceholder')}
                          maxLength={60}
                          className="h-8 text-sm"
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={submitNewLabel}
                          disabled={newLabelName.trim().length === 0 || createLabel.isPending}
                        >
                          {t('labelsCreateButton')}
                        </Button>
                        <button
                          type="button"
                          onClick={() => setLabelCreatorOpen(false)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {LABEL_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setNewLabelColor(c)}
                            aria-label={c}
                            className={cn(
                              'h-6 w-6 rounded-full border-2 transition-all',
                              newLabelColor === c
                                ? 'border-foreground scale-110'
                                : 'border-transparent hover:scale-105',
                            )}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {/* Right column — lifecycle */}
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="start-date">{t('startDateLabel')}</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expires-at">{t('expiresAtLabel')}</Label>
              <Input
                id="expires-at"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>

            {/* Responsible party — segmented control + conditional select */}
            <div className="space-y-2">
              <Label>{t('responsibleLabel')}</Label>
              <div className="flex w-full rounded-md border bg-muted/30 p-0.5 text-sm">
                {(
                  [
                    { value: 'none', label: t('responsibleNoneLabel') },
                    { value: 'user', label: t('responsibleUserLabel') },
                    { value: 'group', label: t('responsibleGroupLabel') },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setResponsibleType(opt.value)}
                    className={cn(
                      'flex-1 rounded px-3 py-1.5 text-center transition-colors',
                      responsibleType === opt.value
                        ? 'bg-background font-medium text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {responsibleType === 'user' ? (
                usersLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <select
                    value={responsibleUserId}
                    onChange={(e) => setResponsibleUserId(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">{t('responsibleSelectUser')}</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name ?? u.email}
                      </option>
                    ))}
                  </select>
                )
              ) : null}

              {responsibleType === 'group' ? (
                groupsLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <select
                    value={responsibleGroupId}
                    onChange={(e) => setResponsibleGroupId(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">{t('responsibleSelectGroup')}</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                )
              ) : null}
            </div>

            {/* Reminder days — only when expiresAt is set */}
            {expiresAt.length > 0 ? (
              <div className="space-y-1.5">
                <Label>{t('reminderDaysLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('reminderDaysHint')}</p>
                <div className="flex flex-wrap gap-2">
                  {REMINDER_OPTIONS.map((days) => (
                    <label key={days} className="flex cursor-pointer items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={reminderDays.includes(days)}
                        onChange={() => toggleReminder(days)}
                        className="h-4 w-4 rounded"
                      />
                      {t('reminderDayOption', { days: String(days) })}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Freshness */}
            <div className="space-y-1.5">
              <Label htmlFor="freshness">{t('freshnessLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('freshnessHint')}</p>
              <Input
                id="freshness"
                type="number"
                min={1}
                max={3650}
                placeholder="—"
                value={freshnessDays}
                onChange={(e) => setFreshnessDays(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3 border-t pt-4">
          <Button type="button" variant="ghost" asChild>
            <Link href={`/${locale}/documents`}>{tCommon('cancel')}</Link>
          </Button>
          <Button
            type="submit"
            disabled={
              uploadedFile === null || name.trim().length === 0 || isUploading || isSubmitting
            }
          >
            {isSubmitting ? t('uploadingText') : t('uploadButton')}
          </Button>
        </div>
      </form>
    </FocusedPageShell>
  );
}
