'use client';

/**
 * Client form for the public QR-scan report page. All copy arrives via the
 * `copy` prop — the server component (`page.tsx`) resolves the visitor's
 * locale from Accept-Language and builds it with next-intl (PF-11: this
 * page used to be hardcoded English — the one page the workforce sees).
 *
 * PF-11 additions:
 *   - photo capture (≤ {@link MAX_PHOTOS}, camera-friendly input) when the
 *     category enables the "media" built-in field — uploads go through the
 *     token-gated `/api/scan-upload/[token]` route; a failed upload keeps
 *     the photo attached for retry instead of dropping it;
 *   - site picker when the category enables the "site" built-in field.
 */
import type {
  IssueCustomQuestion,
  IssueToggleableBuiltInField,
} from '@forma360/shared/issues-schema';
import { Camera, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Input } from '../../../src/components/ui/input';
import { Label } from '../../../src/components/ui/label';
import { Textarea } from '../../../src/components/ui/textarea';
import { trpc } from '../../../src/lib/trpc/client';

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 30_000;
const MAX_LOCATION = 500;
const MAX_NAME = 200;
const MAX_EMAIL = 320;
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export interface ScanPageCopy {
  brandName: string;
  loading: string;
  invalidTitle: string;
  invalidBody: string;
  reportObservation: string;
  fields: {
    titleLabel: string;
    titlePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    reporterNameLabel: string;
    reporterNameSubtitle: string;
    reporterEmailLabel: string;
    reporterEmailSubtitle: string;
    dateOccurredLabel: string;
    locationAddressLabel: string;
    locationAddressPlaceholder: string;
    customQuestionsHeading: string;
    selectPlaceholder: string;
    siteLabel: string;
    siteNone: string;
    photosLabel: string;
    photosSubtitle: string;
    photosAdd: string;
    photosRemove: string;
    photoTooLarge: string;
    photoUploadFailed: string;
  };
  submit: string;
  submitting: string;
  successTitle: string;
  successBody: string;
  successAnother: string;
  errorGeneric: string;
}

interface SuccessState {
  referenceNumber: string;
}

interface PendingPhoto {
  file: File;
  previewUrl: string;
  /** Set once uploaded — a photo with a key is never re-uploaded. */
  uploaded?: { key: string; filename: string; mimeType: string; sizeBytes: number };
  failed?: boolean;
}

export function ScanReportForm({ token, copy }: { token: string; copy: ScanPageCopy }) {
  const COPY = copy;

  const {
    data: category,
    isLoading,
    isError,
  } = trpc.issues.categories.publicGetByShareToken.useQuery(
    { token },
    {
      enabled: token !== '',
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [reporterName, setReporterName] = useState('');
  const [reporterEmail, setReporterEmail] = useState('');
  const [dateOccurred, setDateOccurred] = useState(() => formatLocalDatetime(new Date()));
  const [locationAddress, setLocationAddress] = useState('');
  const [siteId, setSiteId] = useState('');
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [customQuestionResponses, setCustomQuestionResponses] = useState<Record<string, string>>(
    {},
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const create = trpc.issues.issues.createFromShareToken.useMutation({
    onSuccess: (result) => {
      setSuccess({ referenceNumber: result.referenceNumber });
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err.message.length > 0 ? err.message : COPY.errorGeneric);
    },
  });

  const formFingerprint = `${title}|${description}|${reporterName}|${reporterEmail}|${locationAddress}|${siteId}|${JSON.stringify(customQuestionResponses)}`;
  useEffect(() => {
    if (submitError !== null) setSubmitError(null);
  }, [formFingerprint]);

  const customQuestions: ReadonlyArray<IssueCustomQuestion> = (category?.customQuestions ??
    []) as ReadonlyArray<IssueCustomQuestion>;

  const enabledBuiltInFields: ReadonlyArray<IssueToggleableBuiltInField> =
    (category?.enabledBuiltInFields ?? [
      'description',
      'site',
      'media',
      'location',
    ]) as ReadonlyArray<IssueToggleableBuiltInField>;
  const showDescription = enabledBuiltInFields.includes('description');
  const showLocation = enabledBuiltInFields.includes('location');
  const showMedia = enabledBuiltInFields.includes('media');
  const showSite = enabledBuiltInFields.includes('site') && (category?.sites.length ?? 0) > 0;

  const canSubmit = useMemo(
    () =>
      category !== null &&
      category !== undefined &&
      title.trim().length > 0 &&
      title.length <= MAX_TITLE &&
      description.length <= MAX_DESCRIPTION &&
      !create.isPending &&
      !uploadingPhotos,
    [category, title, description, create.isPending, uploadingPhotos],
  );

  function addPhotos(files: FileList | null) {
    if (files === null) return;
    setPhotoError(null);
    const next: PendingPhoto[] = [];
    for (const file of Array.from(files)) {
      if (photos.length + next.length >= MAX_PHOTOS) break;
      if (file.size > MAX_PHOTO_BYTES) {
        setPhotoError(COPY.fields.photoTooLarge);
        continue;
      }
      next.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    if (next.length > 0) setPhotos((prev) => [...prev, ...next]);
    if (fileInputRef.current !== null) fileInputRef.current.value = '';
  }

  function removePhoto(index: number) {
    setPhotos((prev) => {
      const target = prev[index];
      if (target !== undefined) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  /**
   * Upload every photo that doesn't have a key yet. Failures MARK the photo
   * (kept attached, submit shows the retry message) rather than dropping it.
   */
  async function uploadPendingPhotos(current: PendingPhoto[]): Promise<PendingPhoto[] | null> {
    const out = [...current];
    let anyFailed = false;
    for (let i = 0; i < out.length; i += 1) {
      const p = out[i];
      if (p === undefined || p.uploaded !== undefined) continue;
      try {
        const form = new FormData();
        form.append('file', p.file);
        const res = await fetch(`/api/scan-upload/${encodeURIComponent(token)}`, {
          method: 'POST',
          body: form,
        });
        if (!res.ok) throw new Error(`upload ${res.status}`);
        const body = (await res.json()) as {
          key: string;
          filename: string;
          mimeType: string;
          sizeBytes: number;
        };
        out[i] = { ...p, uploaded: body, failed: false };
      } catch {
        out[i] = { ...p, failed: true };
        anyFailed = true;
      }
    }
    setPhotos(out);
    return anyFailed ? null : out;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || category === null || category === undefined) return;

    // Photos first — a failed upload keeps the form intact for retry.
    let uploadedPhotos: PendingPhoto[] = photos;
    if (showMedia && photos.length > 0) {
      setUploadingPhotos(true);
      const result = await uploadPendingPhotos(photos);
      setUploadingPhotos(false);
      if (result === null) {
        setSubmitError(COPY.fields.photoUploadFailed);
        return;
      }
      uploadedPhotos = result;
    }

    const descriptionParts: string[] = [];
    if (showDescription && description.trim().length > 0) {
      descriptionParts.push(description.trim());
    }
    const trimmedName = reporterName.trim();
    const trimmedEmail = reporterEmail.trim();
    if (trimmedName.length > 0 || trimmedEmail.length > 0) {
      const lines: string[] = [];
      if (trimmedName.length > 0) lines.push(`Name: ${trimmedName}`);
      if (trimmedEmail.length > 0) lines.push(`Email: ${trimmedEmail}`);
      descriptionParts.push(lines.join('\n'));
    }
    const combinedDescription = descriptionParts.join('\n\n');

    const input: {
      token: string;
      tenantId: string;
      title: string;
      description?: string;
      dateOccurred?: string;
      locationAddress?: string;
      siteId?: string;
      customQuestionResponses?: Record<string, unknown>;
      media?: Array<{ key: string; filename: string; mimeType: string; sizeBytes: number }>;
    } = {
      token,
      tenantId: category.tenantId,
      title: title.trim(),
    };
    if (combinedDescription.length > 0) input.description = combinedDescription;
    if (dateOccurred !== '') {
      input.dateOccurred = new Date(dateOccurred).toISOString();
    }
    if (showLocation && locationAddress.trim().length > 0) {
      input.locationAddress = locationAddress.trim();
    }
    if (showSite && siteId !== '') input.siteId = siteId;
    const uploaded = uploadedPhotos.flatMap((p) => (p.uploaded === undefined ? [] : [p.uploaded]));
    if (uploaded.length > 0) input.media = uploaded;
    const trimmedQuestionResponses = Object.fromEntries(
      Object.entries(customQuestionResponses).filter(([, v]) => v.length > 0),
    );
    if (Object.keys(trimmedQuestionResponses).length > 0) {
      input.customQuestionResponses = trimmedQuestionResponses;
    }

    create.mutate(input);
  }

  function resetForAnother() {
    setSuccess(null);
    setTitle('');
    setDescription('');
    setReporterName('');
    setReporterEmail('');
    setDateOccurred(formatLocalDatetime(new Date()));
    setLocationAddress('');
    setSiteId('');
    for (const p of photos) URL.revokeObjectURL(p.previewUrl);
    setPhotos([]);
    setPhotoError(null);
    setCustomQuestionResponses({});
    setSubmitError(null);
  }

  // ─── Render branches ────────────────────────────────────────────────

  if (token === '' || isLoading) {
    return (
      <PageShell brandName={COPY.brandName}>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{COPY.loading}</p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (isError || category === null || category === undefined) {
    return (
      <PageShell brandName={COPY.brandName}>
        <Card>
          <CardContent className="space-y-2 p-10 text-center">
            <h1 className="text-lg font-semibold">{COPY.invalidTitle}</h1>
            <p className="text-sm text-muted-foreground">{COPY.invalidBody}</p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (success !== null) {
    return (
      <PageShell brandName={COPY.brandName} tenantName={category.tenantName}>
        <Card>
          <CardContent className="space-y-4 p-8 text-center">
            <h1 className="text-lg font-semibold">{COPY.successTitle}</h1>
            <p className="text-sm text-muted-foreground">{COPY.successBody}</p>
            <p className="rounded-md bg-muted px-3 py-2 text-center font-mono text-sm">
              {success.referenceNumber}
            </p>
            <div className="pt-2">
              <Button type="button" variant="outline" onClick={resetForAnother}>
                {COPY.successAnother}
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell brandName={COPY.brandName} tenantName={category.tenantName}>
      <Card>
        <CardContent className="p-8">
          <header className="space-y-1 pb-6">
            <h1 className="text-xl font-semibold tracking-tight">
              {`${COPY.reportObservation}: ${category.categoryName}`}
            </h1>
          </header>

          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="title">{`${COPY.fields.titleLabel} *`}</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={MAX_TITLE}
                placeholder={COPY.fields.titlePlaceholder}
                required
              />
            </div>

            {showDescription ? (
              <div className="space-y-1.5">
                <Label htmlFor="description">{COPY.fields.descriptionLabel}</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  maxLength={MAX_DESCRIPTION}
                  placeholder={COPY.fields.descriptionPlaceholder}
                />
              </div>
            ) : null}

            {showMedia ? (
              <div className="space-y-1.5">
                <Label>{COPY.fields.photosLabel}</Label>
                <p className="text-xs text-muted-foreground">{COPY.fields.photosSubtitle}</p>
                <div className="flex flex-wrap gap-3">
                  {photos.map((p, i) => (
                    <div
                      key={p.previewUrl}
                      className={`relative h-20 w-20 overflow-hidden rounded-md border ${
                        p.failed === true ? 'border-destructive' : 'border-input'
                      }`}
                    >
                      <img
                        src={p.previewUrl}
                        alt={p.file.name}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        aria-label={COPY.fields.photosRemove}
                        className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 shadow"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  ))}
                  {photos.length < MAX_PHOTOS ? (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-input text-muted-foreground hover:bg-muted/40"
                    >
                      <Camera className="h-5 w-5" aria-hidden />
                      <span className="text-[10px]">{COPY.fields.photosAdd}</span>
                    </button>
                  ) : null}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => addPhotos(e.target.files)}
                />
                {photoError !== null ? (
                  <p className="text-xs text-destructive">{photoError}</p>
                ) : null}
              </div>
            ) : null}

            {showSite ? (
              <div className="space-y-1.5">
                <Label htmlFor="site">{COPY.fields.siteLabel}</Label>
                <select
                  id="site"
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{COPY.fields.siteNone}</option>
                  {category.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="reporter-name">{COPY.fields.reporterNameLabel}</Label>
                <Input
                  id="reporter-name"
                  value={reporterName}
                  onChange={(e) => setReporterName(e.target.value)}
                  maxLength={MAX_NAME}
                />
                <p className="text-xs text-muted-foreground">{COPY.fields.reporterNameSubtitle}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reporter-email">{COPY.fields.reporterEmailLabel}</Label>
                <Input
                  id="reporter-email"
                  type="email"
                  value={reporterEmail}
                  onChange={(e) => setReporterEmail(e.target.value)}
                  maxLength={MAX_EMAIL}
                />
                <p className="text-xs text-muted-foreground">{COPY.fields.reporterEmailSubtitle}</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="date-occurred">{COPY.fields.dateOccurredLabel}</Label>
              <Input
                id="date-occurred"
                type="datetime-local"
                value={dateOccurred}
                onChange={(e) => setDateOccurred(e.target.value)}
              />
            </div>

            {showLocation ? (
              <div className="space-y-1.5">
                <Label htmlFor="location">{COPY.fields.locationAddressLabel}</Label>
                <Input
                  id="location"
                  value={locationAddress}
                  onChange={(e) => setLocationAddress(e.target.value)}
                  maxLength={MAX_LOCATION}
                  placeholder={COPY.fields.locationAddressPlaceholder}
                />
              </div>
            ) : null}

            {customQuestions.length > 0 ? (
              <div className="space-y-3 border-t pt-5">
                <h2 className="text-sm font-medium">{COPY.fields.customQuestionsHeading}</h2>
                {customQuestions.map((q) => (
                  <div key={q.id} className="space-y-1.5">
                    <Label htmlFor={`cq-${q.id}`}>{`${q.prompt}${q.required ? ' *' : ''}`}</Label>
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
                        <option value="">{COPY.fields.selectPlaceholder}</option>
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

            {submitError !== null ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {submitError}
              </div>
            ) : null}

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={!canSubmit}>
                {create.isPending || uploadingPhotos ? COPY.submitting : COPY.submit}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function PageShell({
  children,
  brandName,
  tenantName,
}: {
  children: React.ReactNode;
  brandName: string;
  tenantName?: string;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-10">
      <header className="mb-6 flex flex-col items-center gap-1 text-center">
        <span className="text-xl font-semibold tracking-tight">{brandName}</span>
        {tenantName !== undefined && tenantName.length > 0 ? (
          <span className="text-sm text-muted-foreground">{tenantName}</span>
        ) : null}
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function formatLocalDatetime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
