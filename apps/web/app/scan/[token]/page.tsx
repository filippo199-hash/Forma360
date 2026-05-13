'use client';

/**
 * Public QR-scan landing page.
 *
 * Resolves the opaque token against `issue_categories.public_share_token`
 * via the public `issues.categories.publicGetByShareToken` query, then
 * renders an unauthenticated report form. On submit the page calls the
 * public `issues.issues.createFromShareToken` mutation. The flow never
 * requires a session — possession of the token is the only
 * authorisation.
 *
 * Hard error states surface in the same card:
 *   - Loading           — initial spinner while the token is being looked up.
 *   - Invalid token     — token revoked, category archived, or 404.
 *   - Submit error      — inline message, form values preserved.
 *   - Success           — confirmation panel with the reference number.
 *
 * Lives outside `[locale]` to avoid forcing a locale segment on a URL
 * printed onto physical signage. Copy is hardcoded English (see
 * `scan-page-copy.ts`) because the locale-independent route cannot use
 * `next-intl`.
 */
import type {
  IssueCustomQuestion,
  IssueToggleableBuiltInField,
} from '@forma360/shared/issues-schema';
import { Loader2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Input } from '../../../src/components/ui/input';
import { Label } from '../../../src/components/ui/label';
import { Textarea } from '../../../src/components/ui/textarea';
import { trpc } from '../../../src/lib/trpc/client';
import { SCAN_PAGE_COPY } from '../../../src/server/scan-page-copy';

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 30_000;
const MAX_LOCATION = 500;
const MAX_NAME = 200;
const MAX_EMAIL = 320;

interface SuccessState {
  referenceNumber: string;
}

export default function ScanReportPage() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? '';
  const COPY = SCAN_PAGE_COPY;

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
  const [dateOccurred, setDateOccurred] = useState(() =>
    formatLocalDatetime(new Date()),
  );
  const [locationAddress, setLocationAddress] = useState('');
  const [customQuestionResponses, setCustomQuestionResponses] = useState<
    Record<string, string>
  >({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const create = trpc.issues.issues.createFromShareToken.useMutation({
    onSuccess: (result) => {
      setSuccess({ referenceNumber: result.referenceNumber });
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(err.message.length > 0 ? err.message : COPY.errorGeneric);
    },
  });

  // Clear any prior submit error as soon as the user starts editing
  // again. Using `useEffect` here would either over-fire or require
  // an exhaustive-deps escape — wiring it into each onChange below
  // would be noisy, so we drive it from a sentinel value built off
  // the form contents.
  const formFingerprint = `${title}|${description}|${reporterName}|${reporterEmail}|${locationAddress}|${JSON.stringify(customQuestionResponses)}`;
  useEffect(() => {
    if (submitError !== null) setSubmitError(null);
  }, [formFingerprint, submitError]);

  const customQuestions: ReadonlyArray<IssueCustomQuestion> =
    (category?.customQuestions ?? []) as ReadonlyArray<IssueCustomQuestion>;

  const enabledBuiltInFields: ReadonlyArray<IssueToggleableBuiltInField> =
    (category?.enabledBuiltInFields ?? [
      'description',
      'site',
      'media',
      'location',
    ]) as ReadonlyArray<IssueToggleableBuiltInField>;
  const showDescription = enabledBuiltInFields.includes('description');
  const showLocation = enabledBuiltInFields.includes('location');

  const canSubmit = useMemo(
    () =>
      category !== null &&
      category !== undefined &&
      title.trim().length > 0 &&
      title.length <= MAX_TITLE &&
      description.length <= MAX_DESCRIPTION &&
      !create.isPending,
    [category, title, description, create.isPending],
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || category === null || category === undefined) return;

    const descriptionParts: string[] = [];
    if (showDescription && description.trim().length > 0) {
      descriptionParts.push(description.trim());
    }
    // Public form: surface optional reporter contact info inside the
    // description body so it's visible to staff even though the report
    // is technically anonymous (no userId is attached).
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
      customQuestionResponses?: Record<string, unknown>;
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
    setCustomQuestionResponses({});
    setSubmitError(null);
  }

  // ─── Render branches ────────────────────────────────────────────────

  if (token === '' || isLoading) {
    return (
      <PageShell>
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
      <PageShell>
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
      <PageShell tenantName={category.tenantName}>
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
    <PageShell tenantName={category.tenantName}>
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

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="reporter-name">{COPY.fields.reporterNameLabel}</Label>
                <Input
                  id="reporter-name"
                  value={reporterName}
                  onChange={(e) => setReporterName(e.target.value)}
                  maxLength={MAX_NAME}
                />
                <p className="text-xs text-muted-foreground">
                  {COPY.fields.reporterNameSubtitle}
                </p>
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
                <p className="text-xs text-muted-foreground">
                  {COPY.fields.reporterEmailSubtitle}
                </p>
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
                <h2 className="text-sm font-medium">
                  {COPY.fields.customQuestionsHeading}
                </h2>
                {customQuestions.map((q) => (
                  <div key={q.id} className="space-y-1.5">
                    <Label htmlFor={`cq-${q.id}`}>
                      {`${q.prompt}${q.required ? ' *' : ''}`}
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
                {create.isPending ? COPY.submitting : COPY.submit}
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
  tenantName,
}: {
  children: React.ReactNode;
  tenantName?: string;
}) {
  const COPY = SCAN_PAGE_COPY;
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-10">
      <header className="mb-6 flex flex-col items-center gap-1 text-center">
        <span className="text-xl font-semibold tracking-tight">{COPY.brandName}</span>
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
