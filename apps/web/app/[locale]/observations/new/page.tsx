'use client';

import type {
  IssueCustomQuestion,
  IssueToggleableBuiltInField,
} from '@forma360/shared/issues-schema';
import { Image as ImageIcon, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 30_000;
const MAX_LOCATION = 500;

interface PendingFile {
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Report observation form. Progressive disclosure: initially only the
 * Date and the "What type of observation?" selector are visible; the
 * remaining fields appear once a category is chosen. Built-in fields
 * (Description / Site / Add media / Location) are conditionally
 * rendered based on the category's `enabledBuiltInFields`. Custom
 * questions defined on the selected category render type-aware (text =>
 * Textarea, multipleChoice => Select).
 *
 * Add media is now a working file picker (was a placeholder in PR-1).
 * Uploaded files are persisted to R2 with a temporary issue id at upload
 * time, and attached to the real issue post-create via
 * `issues.attachments.create`.
 */
export default function NewObservationPage() {
  const t = useTranslations('issues.new');
  const tAttachments = useTranslations('issues.attachments');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const canReport = useHasPermission('issues.report');

  const [categoryId, setCategoryId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [siteId, setSiteId] = useState<string>('');
  const [dateOccurred, setDateOccurred] = useState(() => formatLocalDatetime(new Date()));
  const [locationAddress, setLocationAddress] = useState('');
  const [customQuestionResponses, setCustomQuestionResponses] = useState<Record<string, string>>(
    {},
  );
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: categories, isLoading: loadingCategories } =
    trpc.issues.categories.list.useQuery({ includeArchived: false });
  const { data: sites } = trpc.sites.list.useQuery();
  const { data: category } = trpc.issues.categories.get.useQuery(
    { categoryId },
    { enabled: categoryId !== '' },
  );

  useEffect(() => {
    if (!canReport) {
      toast.error(tCommon('error'));
      router.push(`/${locale}/observations`);
    }
  }, [canReport, locale, router, tCommon]);

  // Reset dynamic values when category changes so we never leak a value
  // from one category's questions into another's.
  useEffect(() => {
    setCustomQuestionResponses({});
    setPendingFiles([]);
  }, [categoryId]);

  const createIssue = trpc.issues.issues.create.useMutation();
  const createAttachment = trpc.issues.attachments.create.useMutation();

  const enabled: ReadonlyArray<IssueToggleableBuiltInField> = useMemo(
    () =>
      (category?.enabledBuiltInFields ?? [
        'description',
        'site',
        'media',
        'location',
      ]) as ReadonlyArray<IssueToggleableBuiltInField>,
    [category],
  );
  const showDescription = enabled.includes('description');
  const showSite = enabled.includes('site');
  const showMedia = enabled.includes('media');
  const showLocation = enabled.includes('location');

  const canSubmit = useMemo(
    () =>
      categoryId !== '' &&
      title.trim().length > 0 &&
      title.length <= MAX_TITLE &&
      description.length <= MAX_DESCRIPTION &&
      !createIssue.isPending &&
      !uploading,
    [categoryId, title, description, createIssue.isPending, uploading],
  );

  async function uploadOne(file: File): Promise<PendingFile | null> {
    const form = new FormData();
    // The route accepts an `issueId` so we can re-use it for the
    // pre-create staging area too. Use a dummy 26-char placeholder; the
    // bytes land at <tenantId>/issues/<placeholder>/<filename>, and the
    // server records the canonical storage key on attachment-create.
    // We deliberately keep the placeholder unique per upload so two
    // submitters don't collide in R2.
    form.set('issueId', generateStagingId());
    form.set('file', file);
    const res = await fetch('/api/upload/observation-attachment', {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      toast.error(tAttachments('uploadError'));
      return null;
    }
    return (await res.json()) as PendingFile;
  }

  async function handleFiles(files: FileList | null) {
    if (files === null || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const result = await uploadOne(file);
        if (result !== null) {
          setPendingFiles((prev) => [...prev, result]);
        }
      }
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const input: {
      categoryId: string;
      title: string;
      description?: string;
      siteId?: string;
      dateOccurred?: string;
      locationAddress?: string;
      customQuestionResponses?: Record<string, unknown>;
    } = {
      categoryId,
      title: title.trim(),
    };
    if (showDescription && description.trim().length > 0) input.description = description.trim();
    if (showSite && siteId !== '') input.siteId = siteId;
    if (dateOccurred !== '') {
      input.dateOccurred = new Date(dateOccurred).toISOString();
    }
    if (showLocation && locationAddress.trim().length > 0) {
      input.locationAddress = locationAddress.trim();
    }
    const trimmedQuestionResponses = Object.fromEntries(
      Object.entries(customQuestionResponses).filter(([, v]) => v.length > 0),
    );
    if (Object.keys(trimmedQuestionResponses).length > 0) {
      input.customQuestionResponses = trimmedQuestionResponses;
    }
    try {
      const result = await createIssue.mutateAsync(input);
      // Attach any pre-uploaded files now that we know the real issue id.
      for (const file of pendingFiles) {
        try {
          await createAttachment.mutateAsync({
            issueId: result.issueId,
            storageKey: file.storageKey,
            filename: file.filename,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
          });
        } catch {
          // Best-effort — leave the blob orphaned for cleanup.
        }
      }
      toast.success(t('successToast', { ref: result.referenceNumber }));
      router.push(`/${locale}/observations/${result.issueId}`);
    } catch (err) {
      const message = err instanceof Error && err.message.length > 0 ? err.message : t('errorToast');
      toast.error(message);
    }
  }

  const categorySelected = categoryId !== '';
  const customQuestions: ReadonlyArray<IssueCustomQuestion> =
    category?.customQuestions ?? [];

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" type="button">
          <Link href={`/${locale}/observations`}>{t('cancelButton')}</Link>
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <Button type="submit" disabled={!canSubmit}>
          {t('submitButton')}
        </Button>
      </header>

      <Card className="mx-auto max-w-2xl">
        <CardContent className="space-y-5 p-6">
          <div className="space-y-1.5">
            <Label htmlFor="dateOccurred">{t('dateLabel')}</Label>
            <Input
              id="dateOccurred"
              type="datetime-local"
              value={dateOccurred}
              onChange={(e) => setDateOccurred(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category">{t('categoryLabel')}</Label>
            <select
              id="category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
              disabled={loadingCategories}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">{t('categoryPlaceholder')}</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id} disabled={c.archivedAt !== null}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {categorySelected ? (
            <div className="space-y-5 border-t pt-5">
              <div className="space-y-1.5">
                <Label htmlFor="title">{t('titleLabel')}</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={MAX_TITLE}
                  required
                />
              </div>

              {showDescription ? (
                <div className="space-y-1.5">
                  <Label htmlFor="description">{t('descriptionLabel')}</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    maxLength={MAX_DESCRIPTION}
                  />
                  <p className="text-right text-xs text-muted-foreground">
                    {t('descriptionCounter', { count: description.length })}
                  </p>
                </div>
              ) : null}

              {showSite ? (
                <div className="space-y-1.5">
                  <Label htmlFor="site">{t('siteLabel')}</Label>
                  <select
                    id="site"
                    value={siteId}
                    onChange={(e) => setSiteId(e.target.value)}
                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">{t('sitePlaceholder')}</option>
                    {(sites ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {showMedia ? (
                <div className="space-y-1.5">
                  <Label>{t('mediaHeading')}</Label>
                  <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,video/*,application/pdf"
                      className="hidden"
                      onChange={(e) => void handleFiles(e.target.files)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploading}
                      className="mt-1"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <ImageIcon className="mr-1 h-4 w-4" />
                      {uploading ? tAttachments('uploading') : t('mediaButton')}
                    </Button>
                  </div>
                  {pendingFiles.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {pendingFiles.map((f) => (
                        <li
                          key={f.storageKey}
                          className="flex items-center justify-between rounded-md border px-2 py-1 text-xs"
                        >
                          <span className="truncate">{f.filename}</span>
                          <button
                            type="button"
                            aria-label={tAttachments('deleteAction')}
                            className="rounded p-1 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              setPendingFiles((prev) =>
                                prev.filter((x) => x.storageKey !== f.storageKey),
                              )
                            }
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {showLocation ? (
                <div className="space-y-1.5">
                  <Label htmlFor="locationAddress">{t('locationLabel')}</Label>
                  <Input
                    id="locationAddress"
                    value={locationAddress}
                    onChange={(e) => setLocationAddress(e.target.value)}
                    maxLength={MAX_LOCATION}
                  />
                </div>
              ) : null}

              {customQuestions.length > 0 ? (
                <div className="space-y-3 border-t pt-5">
                  <h2 className="text-sm font-medium">{t('customQuestionsHeading')}</h2>
                  {customQuestions.map((q) => (
                    <div key={q.id} className="space-y-1.5">
                      <Label htmlFor={`cq-${q.id}`}>
                        {q.prompt}
                        {q.required ? ' *' : ''}
                      </Label>
                      {q.type === 'multipleChoice' && q.options !== undefined ? (
                        <select
                          id={`cq-${q.id}`}
                          value={customQuestionResponses[q.id] ?? ''}
                          onChange={(e) =>
                            setCustomQuestionResponses((prev) => ({
                              ...prev,
                              [q.id]: e.target.value,
                            }))
                          }
                          required={q.required}
                          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          <option value="">—</option>
                          {q.options.map((o, i) => (
                            <option key={i} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Textarea
                          id={`cq-${q.id}`}
                          value={customQuestionResponses[q.id] ?? ''}
                          onChange={(e) =>
                            setCustomQuestionResponses((prev) => ({
                              ...prev,
                              [q.id]: e.target.value,
                            }))
                          }
                          required={q.required}
                          rows={3}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2 border-t pt-5">
                <Button asChild variant="ghost" type="button">
                  <Link href={`/${locale}/observations`}>{t('cancelButton')}</Link>
                </Button>
                <Button type="submit" disabled={!canSubmit}>
                  {t('submitButton')}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </form>
  );
}

function formatLocalDatetime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Generate a 26-char Crockford-base32 stand-in for an issue id, used as
 * the `issueId` segment in the staging-upload key. We never persist this
 * value — `issues.attachments.create` recomputes the key from the real
 * issue id... actually no, it records whatever key the route returns.
 * Because storage keys are validated by `objectKeySchema`, the staging
 * id must conform to the ULID alphabet.
 */
function generateStagingId(): string {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let out = '';
  for (let i = 0; i < 26; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}
