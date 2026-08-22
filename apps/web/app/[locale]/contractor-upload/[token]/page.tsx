'use client';

import { todayIso, validateDocumentPeriod } from '@forma360/shared/contractors';
import { CheckCircle2, FileText, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Checkbox } from '../../../../src/components/ui/checkbox';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * CT-U01: the portal used to send a file and nothing else, so every
 * self-service upload landed with a null expiry — which the compliance
 * derivation reads as "valid forever" and the reminder worker skips
 * entirely. The period of cover is now part of the form, and the route
 * refuses an upload that carries neither a date nor the assertion.
 */
interface PeriodDraft {
  start: string;
  end: string;
  noExpiry: boolean;
}

const EMPTY_PERIOD: PeriodDraft = { start: '', end: '', noExpiry: false };

export default function ContractorUploadPortal() {
  const t = useTranslations('contractors');
  const params = useParams<{ token: string }>();
  const token = params.token ?? '';

  const { data, isLoading, error } = trpc.contractors.publicByToken.useQuery(
    { token },
    { enabled: token !== '', retry: false },
  );

  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [periods, setPeriods] = useState<Record<string, PeriodDraft>>({});
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function periodFor(requirementId: string): PeriodDraft {
    return periods[requirementId] ?? EMPTY_PERIOD;
  }

  function setPeriod(requirementId: string, patch: Partial<PeriodDraft>): void {
    setPeriods((prev) => ({
      ...prev,
      [requirementId]: { ...(prev[requirementId] ?? EMPTY_PERIOD), ...patch },
    }));
  }

  async function upload(
    requirementId: string,
    recurrenceMonths: number | null,
    file: File,
  ): Promise<void> {
    const period = periodFor(requirementId);
    // Mirrors the check in /api/contractor-upload. The route is the
    // enforcement point; this only turns a 400 into a useful sentence.
    const check = validateDocumentPeriod({
      startDate: period.start,
      endDate: period.end,
      noExpiry: period.noExpiry,
      recurrenceMonths,
      today: todayIso(),
      rejectExpired: true,
    });
    if (!check.ok) {
      if (check.error === 'EXPIRY_REQUIRED') {
        toast.error(
          recurrenceMonths !== null
            ? t('portalRenewalNote', { months: recurrenceMonths })
            : t('portalExpiryRequired'),
        );
      } else if (check.error === 'INVALID_PERIOD') {
        toast.error(t('portalExpiryBeforeStart'));
      } else if (check.error === 'EXPIRY_IN_PAST') {
        toast.error(t('portalExpiryInPast'));
      } else {
        toast.error(t('portalInvalidDate'));
      }
      return;
    }

    setUploadingId(requirementId);
    try {
      const form = new FormData();
      form.append('token', token);
      form.append('requirementId', requirementId);
      if (period.start !== '') form.append('startDate', period.start);
      if (period.end !== '') form.append('endDate', period.end);
      form.append('noExpiry', period.end === '' && period.noExpiry ? 'true' : 'false');
      form.append('file', file);
      const res = await fetch('/api/contractor-upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error('upload-failed');
      setDone((prev) => new Set(prev).add(requirementId));
      toast.success(t('portalUploaded'));
    } catch {
      // UXW3-05: name the file and say what actually happened — "Something
      // went wrong." on the one surface outsiders use left them unsure
      // whether the document arrived (IN-A4's rule, applied out here).
      toast.error(t('portalUploadFailed', { filename: file.name }));
    } finally {
      setUploadingId(null);
    }
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-lg px-4 py-10">
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error !== null || data === undefined ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t('portalInvalid')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">{t('portalTitle')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {/* UXW3-04: name WHO is asking — the requester is the company,
                  not the contractor reading the page. */}
              {t('portalIntro', { company: data.companyName, name: data.contractorName })}
            </p>
          </header>

          <div className="space-y-3">
            {data.requirements.map((r) => {
              const isDone = done.has(r.id);
              const period = periodFor(r.id);
              return (
                <Card key={r.id}>
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
                      {isDone ? (
                        <span className="inline-flex items-center gap-1 text-sm text-emerald-600">
                          <CheckCircle2 className="h-4 w-4" />
                          {t('portalDone')}
                        </span>
                      ) : null}
                    </div>

                    {isDone ? null : (
                      <>
                        <fieldset className="space-y-3">
                          <legend className="mb-1 text-xs font-medium text-muted-foreground">
                            {t('portalPeriodHeading')}
                          </legend>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor={`start-${r.id}`}>{t('startDateLabel')}</Label>
                              <Input
                                id={`start-${r.id}`}
                                type="date"
                                value={period.start}
                                onChange={(e) => setPeriod(r.id, { start: e.target.value })}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor={`end-${r.id}`}>{t('endDateLabel')}</Label>
                              <Input
                                id={`end-${r.id}`}
                                type="date"
                                min={todayIso()}
                                value={period.end}
                                disabled={period.noExpiry}
                                onChange={(e) => setPeriod(r.id, { end: e.target.value })}
                              />
                            </div>
                          </div>
                          {r.recurrenceMonths === null ? (
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={`no-expiry-${r.id}`}
                                checked={period.noExpiry}
                                onCheckedChange={(checked) =>
                                  setPeriod(r.id, {
                                    noExpiry: checked,
                                    ...(checked ? { end: '' } : {}),
                                  })
                                }
                              />
                              <Label htmlFor={`no-expiry-${r.id}`} className="font-normal">
                                {t('portalNoExpiry')}
                              </Label>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {t('portalRenewalNote', { months: r.recurrenceMonths })}
                            </p>
                          )}
                        </fieldset>

                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={uploadingId !== null}
                            onClick={() => fileRefs.current[r.id]?.click()}
                          >
                            <Upload className="mr-1 h-3.5 w-3.5" />
                            {uploadingId === r.id ? t('uploading') : t('portalUpload')}
                          </Button>
                        </div>
                        <input
                          ref={(el) => {
                            fileRefs.current[r.id] = el;
                          }}
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.avif"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f !== undefined) void upload(r.id, r.recurrenceMonths, f);
                            e.target.value = '';
                          }}
                        />
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
