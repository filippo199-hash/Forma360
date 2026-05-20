'use client';

import { FileUp, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FocusedPageShell } from '../../../../src/components/focused-page-shell';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { trpc } from '../../../../src/lib/trpc/client';

const MAX_BYTES = 50 * 1024 * 1024;

const REMINDER_OPTIONS = [1, 7, 14, 30, 60, 90] as const;

type UploadedFile = {
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

type ResponsibleType = 'none' | 'user' | 'group';

export default function DocumentNewPage() {
  const t = useTranslations('documents.upload');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  // File upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [folderId, setFolderId] = useState<string>('');
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [responsibleType, setResponsibleType] = useState<ResponsibleType>('none');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [responsibleGroupId, setResponsibleGroupId] = useState('');
  const [reminderDays, setReminderDays] = useState<number[]>([]);
  const [freshnessDays, setFreshnessDays] = useState('');

  // Data queries
  const { data: folders = [], isLoading: foldersLoading } =
    trpc.documentFolders.list.useQuery({});
  const { data: labels = [], isLoading: labelsLoading } =
    trpc.documentLabels.list.useQuery();
  const { data: usersData, isLoading: usersLoading } = trpc.users.list.useQuery({});
  const users = usersData?.users ?? [];
  const { data: groups = [], isLoading: groupsLoading } = trpc.groups.list.useQuery();

  const createDocument = trpc.documents.create.useMutation({
    onSuccess: ({ documentId }) => {
      toast.success(t('successToast'));
      router.push(`/${locale}/documents/${documentId}`);
    },
    onError: (err) =>
      toast.error(err.message.length > 0 ? err.message : t('errorToast')),
  });

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
        throw new Error(body.error ?? 'upload-failed');
      }
      const result = (await res.json()) as UploadedFile;
      setUploadedFile(result);
      if (name.trim().length === 0) {
        // Strip extension for the default document name
        const base = result.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        setName(base.trim());
      }
    } catch {
      toast.error(t('errorToast'));
    } finally {
      setIsUploading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file !== undefined) void uploadFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
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
      labelIds: selectedLabelIds,
      startDate: startDate.length > 0 ? new Date(startDate).toISOString() : null,
      expiresAt: expiresAt.length > 0 ? new Date(expiresAt).toISOString() : null,
      responsibleUserId:
        responsibleType === 'user' && responsibleUserId.length > 0
          ? responsibleUserId
          : null,
      responsibleGroupId:
        responsibleType === 'group' && responsibleGroupId.length > 0
          ? responsibleGroupId
          : null,
      reminderDays,
      freshnessDays: parsed !== undefined && !isNaN(parsed) ? parsed : undefined,
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
        {/* File drop zone */}
        <Card>
          <CardContent className="p-4">
            <Label className="mb-2 block">{t('fileLabel')}</Label>

            {uploadedFile === null ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
                  isDragging
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/60 hover:bg-muted/40'
                }`}
              >
                {isUploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <span className="text-sm text-muted-foreground">
                      {t('uploadingText')}
                    </span>
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
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
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
          </CardContent>
        </Card>

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

            {/* Labels */}
            <div className="space-y-1.5">
              <Label>{t('labelsLabel')}</Label>
              {labelsLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : labels.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('labelsPlaceholder')}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {labels.map((lbl) => {
                    const selected = selectedLabelIds.includes(lbl.id);
                    return (
                      <button
                        key={lbl.id}
                        type="button"
                        onClick={() => toggleLabel(lbl.id)}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                          selected
                            ? 'border-transparent text-white shadow-sm'
                            : 'border-border bg-background text-foreground hover:bg-muted'
                        }`}
                        style={selected ? { backgroundColor: lbl.color } : {}}
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: lbl.color }}
                        />
                        {lbl.name}
                      </button>
                    );
                  })}
                </div>
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

            {/* Responsible party */}
            <div className="space-y-2">
              <Label>{t('responsibleLabel')}</Label>
              <div className="flex gap-3 text-sm">
                {(['none', 'user', 'group'] as const).map((rt) => (
                  <label key={rt} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      name="responsible-type"
                      value={rt}
                      checked={responsibleType === rt}
                      onChange={() => setResponsibleType(rt)}
                      className="h-4 w-4"
                    />
                    {rt === 'none'
                      ? '—'
                      : rt === 'user'
                        ? t('responsibleUserLabel')
                        : t('responsibleGroupLabel')}
                  </label>
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
                    <option value="">—</option>
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
                    <option value="">—</option>
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
                    <label
                      key={days}
                      className="flex cursor-pointer items-center gap-1.5 text-sm"
                    >
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
              uploadedFile === null ||
              name.trim().length === 0 ||
              isUploading ||
              isSubmitting
            }
          >
            {isSubmitting ? t('uploadingText') : t('uploadButton')}
          </Button>
        </div>
      </form>
    </FocusedPageShell>
  );
}
