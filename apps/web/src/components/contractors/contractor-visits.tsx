'use client';

import { AlertTriangle, CalendarClock, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '../../lib/cn';
import { usePlaceTerms } from '../../lib/terminology';
import { SiteSelector } from '../selectors/site-selector';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Skeleton } from '../ui/skeleton';
import { Textarea } from '../ui/textarea';

export type VisitStatus = 'scheduled' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show';

export const VISIT_STATUS_BADGE: Record<VisitStatus, string> = {
  scheduled: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
  checked_in: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  checked_out: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
  cancelled: 'bg-muted text-muted-foreground line-through',
  no_show: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
};

/** Small coloured status pill for a visit. */
export function VisitStatusBadge({ status }: { status: string }) {
  const t = useTranslations('contractors');
  return (
    <span
      className={cn(
        'inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
        VISIT_STATUS_BADGE[status as VisitStatus] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {t(`visits.status_${status}` as 'visits.status_scheduled')}
    </span>
  );
}

/** Local datetime-local string (YYYY-MM-DDTHH:mm) for a given day at 09:00. */
function dayAt9(day: string | undefined): string {
  if (day === undefined) return '';
  return `${day}T09:00`;
}

/**
 * The viewer's own timezone. Visit times are entered via a browser-local
 * `datetime-local` input, so they must be displayed in the same zone (the
 * next-intl provider isn't given a timeZone, so it would otherwise render in
 * UTC and shift the wall-clock time).
 */
const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Create / walk-in dialog. When `fixedContractorId` is set the contractor is
 * locked (used from a contractor's own page); otherwise a picker is shown.
 */
export function VisitCreateDialog({
  open,
  onOpenChange,
  fixedContractorId,
  defaultDay,
  walkIn = false,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fixedContractorId?: string;
  defaultDay?: string;
  walkIn?: boolean;
  onDone: () => void;
}) {
  const t = useTranslations('contractors');
  const tCommon = useTranslations('common');
  const placeTerms = usePlaceTerms();

  const contractorsQ = trpc.contractors.list.useQuery(undefined, {
    enabled: open && fixedContractorId === undefined,
  });

  const [contractorId, setContractorId] = useState(fixedContractorId ?? '');
  const [title, setTitle] = useState('');
  const [visitorName, setVisitorName] = useState('');
  const [siteId, setSiteId] = useState('');
  const [start, setStart] = useState(dayAt9(defaultDay));
  const [end, setEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [authorize, setAuthorize] = useState(true);
  // PF-19: set when the server refused the walk-in for compliance — the
  // dialog then surfaces an override-reason field.
  const [walkInBlocked, setWalkInBlocked] = useState(false);
  const [walkInOverride, setWalkInOverride] = useState('');

  const reset = () => {
    setContractorId(fixedContractorId ?? '');
    setTitle('');
    setVisitorName('');
    setSiteId('');
    setStart(dayAt9(defaultDay));
    setEnd('');
    setWalkInBlocked(false);
    setWalkInOverride('');
    setNotes('');
    setAuthorize(true);
  };

  const onErr = (err: { message: string }) =>
    toast.error(err.message.length > 0 ? err.message : t('error'));

  const create = trpc.contractors.visits.create.useMutation({
    onSuccess: () => {
      toast.success(t('visits.visitCreatedToast'));
      onOpenChange(false);
      reset();
      onDone();
    },
    onError: onErr,
  });
  const createWalkIn = trpc.contractors.visits.createWalkIn.useMutation({
    onSuccess: () => {
      toast.success(t('visits.walkInToast'));
      onOpenChange(false);
      reset();
      onDone();
    },
    // PF-19: a non-compliant contractor needs an explicit override reason.
    onError: (err) => {
      if (err.message === 'contractor_non_compliant') {
        setWalkInBlocked(true);
        toast.error(t('visits.blockedNonCompliant'));
        return;
      }
      onErr(err);
    },
  });

  const pending = create.isPending || createWalkIn.isPending;
  const cid = fixedContractorId ?? contractorId;
  const canSubmit = cid !== '' && title.trim() !== '' && (walkIn || start !== '');

  function submit() {
    if (!canSubmit) return;
    const siteArg = siteId === '' ? {} : { siteId };
    const visitorArg = visitorName.trim() === '' ? {} : { visitorName: visitorName.trim() };
    if (walkIn) {
      createWalkIn.mutate({
        contractorId: cid,
        title: title.trim(),
        ...siteArg,
        ...visitorArg,
        ...(walkInOverride.trim() !== '' ? { overrideReason: walkInOverride.trim() } : {}),
      });
    } else {
      create.mutate({
        contractorId: cid,
        title: title.trim(),
        scheduledStart: new Date(start).toISOString(),
        authorize,
        ...siteArg,
        ...visitorArg,
        ...(end !== '' ? { scheduledEnd: new Date(end).toISOString() } : {}),
        ...(notes.trim() !== '' ? { notes: notes.trim() } : {}),
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{walkIn ? t('visits.walkInTitle') : t('visits.newVisit')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {fixedContractorId === undefined ? (
            <div className="space-y-1.5">
              <Label htmlFor="v-contractor">{t('visits.visitContractorLabel')}</Label>
              <select
                id="v-contractor"
                value={contractorId}
                onChange={(e) => setContractorId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t('visits.selectContractor')}</option>
                {(contractorsQ.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="v-title">{t('visits.visitTitleLabel')}</Label>
            <Input
              id="v-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="v-visitor">{t('visits.visitorLabel')}</Label>
            <Input
              id="v-visitor"
              value={visitorName}
              onChange={(e) => setVisitorName(e.target.value)}
              maxLength={300}
              placeholder={t('visits.visitorPlaceholder')}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{placeTerms.label}</Label>
            <SiteSelector
              value={siteId !== '' ? [siteId] : []}
              onChange={(next) => setSiteId(next[0] ?? '')}
              multiple={false}
              placeholder={placeTerms.noneLabel}
            />
          </div>

          {walkIn && walkInBlocked ? (
            <div className="space-y-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <Label htmlFor="wi-override" className="text-xs font-medium text-destructive">
                {t('visits.blockedNonCompliant')}
              </Label>
              <Textarea
                id="wi-override"
                value={walkInOverride}
                onChange={(e) => setWalkInOverride(e.target.value)}
                placeholder={t('visits.overrideReasonPlaceholder')}
                rows={2}
                maxLength={1000}
              />
            </div>
          ) : null}
          {!walkIn ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="v-start">{t('visits.visitStartLabel')}</Label>
                  <Input
                    id="v-start"
                    type="datetime-local"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="v-end">{t('visits.visitEndLabel')}</Label>
                  <Input
                    id="v-end"
                    type="datetime-local"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-notes">{t('visits.visitNotesLabel')}</Label>
                <textarea
                  id="v-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={5000}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={authorize}
                  onChange={(e) => setAuthorize(e.target.checked)}
                />
                {t('visits.authorizeOnCreate')}
              </label>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={submit} disabled={pending || !canSubmit}>
            {walkIn ? t('visits.walkInButton') : t('visits.createVisitButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Detail dialog with the lifecycle actions for a single visit. */
export function VisitDetailDialog({
  visitId,
  onOpenChange,
  canManage,
  onChanged,
}: {
  visitId: string | null;
  onOpenChange: (o: boolean) => void;
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('contractors');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const placeTerms = usePlaceTerms();
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.contractors.visits.get.useQuery(
    { id: visitId ?? '' },
    { enabled: visitId !== null },
  );
  const gateFieldsQ = trpc.contractors.gateFields.list.useQuery(undefined, {
    enabled: visitId !== null,
  });
  const eventsQ = trpc.contractors.visits.events.useQuery(
    { visitId: visitId ?? '' },
    { enabled: visitId !== null },
  );
  const gateFields = gateFieldsQ.data ?? [];
  const fieldLabel = (id: string) => gateFields.find((f) => f.id === id)?.label ?? id;

  // Check-in form (capture fields + optional staff-override reason).
  const [checkingIn, setCheckingIn] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [overrideReason, setOverrideReason] = useState('');
  const resetCheckIn = () => {
    setCheckingIn(false);
    setAnswers({});
    setOverrideReason('');
  };

  const onErr = (err: { message: string }) =>
    toast.error(err.message.length > 0 ? err.message : t('error'));
  const done = (msg: string) => () => {
    toast.success(msg);
    // Refresh this dialog (actions + audit log) and the parent list.
    if (visitId !== null) {
      void utils.contractors.visits.get.invalidate({ id: visitId });
      void utils.contractors.visits.events.invalidate({ visitId });
    }
    onChanged();
  };

  const authorizeM = trpc.contractors.visits.authorize.useMutation({
    onSuccess: done(t('visits.authorizedToast')),
    onError: onErr,
  });
  const checkInM = trpc.contractors.visits.checkIn.useMutation({
    onSuccess: () => {
      resetCheckIn();
      done(t('visits.checkedInToast'))();
    },
    // PF-19: the server now refuses non-compliant contractors without a
    // recorded override reason — point the user at the field.
    onError: (err) => {
      if (err.message === 'contractor_non_compliant') {
        toast.error(t('visits.blockedNonCompliant'));
        return;
      }
      onErr(err);
    },
  });
  const checkOutM = trpc.contractors.visits.checkOut.useMutation({
    onSuccess: done(t('visits.checkedOutToast')),
    onError: onErr,
  });
  const setStatusM = trpc.contractors.visits.setStatus.useMutation({
    onSuccess: done(t('visits.visitUpdatedToast')),
    onError: onErr,
  });
  const deleteM = trpc.contractors.visits.delete.useMutation({
    onSuccess: () => {
      toast.success(t('visits.visitDeletedToast'));
      onOpenChange(false);
      onChanged();
    },
    onError: onErr,
  });

  const v = data?.visit;
  const busy =
    authorizeM.isPending ||
    checkInM.isPending ||
    checkOutM.isPending ||
    setStatusM.isPending ||
    deleteM.isPending;

  return (
    <Dialog open={visitId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {isLoading ? (
          <div className="space-y-4 py-2">
            <Skeleton className="h-6 w-2/3" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ) : error !== null || data === undefined || v === undefined ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('visits.visitDetailTitle')}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {t('error')}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {tCommon('close')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {v.title}
                <VisitStatusBadge status={v.status} />
                {v.isWalkIn ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                    {t('visits.walkInBadge')}
                  </span>
                ) : null}
              </DialogTitle>
            </DialogHeader>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('visits.visitContractorLabel')}</dt>
                <dd className="text-right font-medium">{data.contractorName}</dd>
              </div>
              {v.visitorName !== null && v.visitorName !== '' ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t('visits.visitorLabel')}</dt>
                  <dd className="text-right">{v.visitorName}</dd>
                </div>
              ) : null}
              {data.siteName !== null ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{placeTerms.label}</dt>
                  <dd className="text-right">{data.siteName}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('visits.visitStartLabel')}</dt>
                <dd className="text-right">
                  {format.dateTime(new Date(v.scheduledStart), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: BROWSER_TZ,
                  })}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('visits.authorisationLabel')}</dt>
                <dd className="text-right">
                  {data.authorizedByName !== null
                    ? t('visits.authorizedBy', { name: data.authorizedByName })
                    : t('visits.notAuthorized')}
                </dd>
              </div>
              {v.notes !== null && v.notes !== '' ? (
                <div>
                  <dt className="text-muted-foreground">{t('visits.visitNotesLabel')}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap">{v.notes}</dd>
                </div>
              ) : null}
            </dl>

            {/* Check-in form: capture fields + optional staff-override reason. */}
            {canManage && checkingIn ? (
              <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                {gateFields.map((f) => (
                  <div key={f.id} className="space-y-1">
                    <Label htmlFor={`ci-${f.id}`} className="text-xs">
                      {f.label}
                      {f.required ? <span className="text-destructive"> *</span> : null}
                    </Label>
                    {f.fieldType === 'yes_no' ? (
                      <select
                        id={`ci-${f.id}`}
                        value={answers[f.id] ?? ''}
                        onChange={(e) => setAnswers((a) => ({ ...a, [f.id]: e.target.value }))}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">—</option>
                        <option value="yes">{t('gate.yes')}</option>
                        <option value="no">{t('gate.no')}</option>
                      </select>
                    ) : (
                      <Input
                        id={`ci-${f.id}`}
                        type={f.fieldType === 'number' ? 'number' : 'text'}
                        value={answers[f.id] ?? ''}
                        onChange={(e) => setAnswers((a) => ({ ...a, [f.id]: e.target.value }))}
                        className="h-9"
                      />
                    )}
                  </div>
                ))}
                <div className="space-y-1">
                  <Label htmlFor="ci-override" className="text-xs">
                    {t('visits.overrideReasonLabel')}
                  </Label>
                  <Textarea
                    id="ci-override"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder={t('visits.overrideReasonPlaceholder')}
                    rows={2}
                    maxLength={1000}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={resetCheckIn}>
                    {t('visits.cancelVisit')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      checkInM.mutate({
                        id: v.id,
                        ...(Object.keys(answers).length > 0 ? { capturedFields: answers } : {}),
                        ...(overrideReason.trim() !== ''
                          ? { overrideReason: overrideReason.trim() }
                          : {}),
                      })
                    }
                  >
                    <LogIn className="mr-1 h-3.5 w-3.5" />
                    {t('visits.checkIn')}
                  </Button>
                </div>
              </div>
            ) : null}

            {canManage && !checkingIn ? (
              <DialogFooter className="flex-wrap gap-2 sm:justify-start">
                {v.authorizedByUserId === null ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => authorizeM.mutate({ id: v.id })}
                  >
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                    {t('visits.authorize')}
                  </Button>
                ) : null}
                {v.checkedInAt === null && v.status !== 'cancelled' ? (
                  <Button size="sm" disabled={busy} onClick={() => setCheckingIn(true)}>
                    <LogIn className="mr-1 h-3.5 w-3.5" />
                    {t('visits.checkIn')}
                  </Button>
                ) : null}
                {v.checkedInAt !== null && v.checkedOutAt === null ? (
                  <Button size="sm" disabled={busy} onClick={() => checkOutM.mutate({ id: v.id })}>
                    <LogOut className="mr-1 h-3.5 w-3.5" />
                    {t('visits.checkOut')}
                  </Button>
                ) : null}
                {v.status === 'scheduled' ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(t('visits.cancelConfirm')))
                          setStatusM.mutate({ id: v.id, status: 'cancelled' });
                      }}
                    >
                      {t('visits.cancelVisit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(t('visits.noShowConfirm')))
                          setStatusM.mutate({ id: v.id, status: 'no_show' });
                      }}
                    >
                      {t('visits.markNoShow')}
                    </Button>
                  </>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(t('visits.deleteVisitConfirm')))
                      deleteM.mutate({ id: v.id });
                  }}
                >
                  {t('visits.deleteVisit')}
                </Button>
              </DialogFooter>
            ) : null}

            {/* Gate audit log */}
            {(eventsQ.data ?? []).length > 0 ? (
              <div className="mt-2 border-t pt-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('visits.eventLog')}
                </p>
                <ul className="space-y-2 text-xs">
                  {(eventsQ.data ?? []).map((ev) => (
                    <li key={ev.id} className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {t(`visits.event_${ev.eventType}` as 'visits.event_check_in')}
                        </span>
                        <span className="text-muted-foreground">
                          {format.dateTime(new Date(ev.at), {
                            dateStyle: 'short',
                            timeStyle: 'short',
                            timeZone: BROWSER_TZ,
                          })}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                          {ev.method === 'self_scan'
                            ? t('visits.method_self_scan')
                            : (ev.actorName ?? t('visits.method_staff'))}
                        </span>
                      </div>
                      {ev.overrideReason !== null && ev.overrideReason !== '' ? (
                        <span className="text-muted-foreground">
                          {t('visits.overrideReasonLabel')}: {ev.overrideReason}
                        </span>
                      ) : null}
                      {ev.capturedFields !== null && Object.keys(ev.capturedFields).length > 0 ? (
                        <span className="text-muted-foreground">
                          {Object.entries(ev.capturedFields)
                            .map(([fid, val]) => `${fieldLabel(fid)}: ${val}`)
                            .join(' · ')}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Visits list + scheduling controls embedded on a contractor's detail page. */
export function ContractorVisitsSection({
  contractorId,
  canManage,
}: {
  contractorId: string;
  canManage: boolean;
}) {
  const t = useTranslations('contractors');
  const format = useFormatter();
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.contractors.visits.listForContractor.useQuery({
    contractorId,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const refresh = () => {
    void utils.contractors.visits.listForContractor.invalidate({ contractorId });
    void utils.contractors.visits.list.invalidate();
  };

  const visits = data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('visits.visitsHeading')}</h2>
          <p className="text-sm text-muted-foreground">{t('visits.visitsSubtitle')}</p>
        </div>
        {canManage ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setWalkInOpen(true)}>
              <LogIn className="mr-1 h-4 w-4" />
              {t('visits.logWalkIn')}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <CalendarClock className="mr-1 h-4 w-4" />
              {t('visits.newVisit')}
            </Button>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-4 w-4 shrink-0 rounded" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : error !== null ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t('error')}
          </CardContent>
        </Card>
      ) : visits.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('visits.noVisits')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {visits.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => setDetailId(v.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/40"
                  >
                    <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium" title={v.title}>
                        {v.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format.dateTime(new Date(v.scheduledStart), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: BROWSER_TZ,
                        })}
                        {v.siteName !== null ? ` · ${v.siteName}` : ''}
                      </p>
                    </div>
                    <VisitStatusBadge status={v.status} />
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <VisitCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        fixedContractorId={contractorId}
        onDone={refresh}
      />
      <VisitCreateDialog
        open={walkInOpen}
        onOpenChange={setWalkInOpen}
        fixedContractorId={contractorId}
        walkIn
        onDone={refresh}
      />
      <VisitDetailDialog
        visitId={detailId}
        onOpenChange={(o) => !o && setDetailId(null)}
        canManage={canManage}
        onChanged={refresh}
      />
    </section>
  );
}
