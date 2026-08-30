'use client';

/**
 * The wallet (FreeHS B7 — TR-A4).
 *
 * Whitfield's screen, and the half of the module that did not ship first
 * time round: *"A grid is a manager's artefact. What I actually need,
 * three times a week, is to stand at a client's gate and show that this
 * specific bloke holds a valid CSCS card. That's not a matrix, it's a
 * wallet."*
 *
 * So this is card-shaped rather than row-shaped: a number, an expiry, and
 * the photograph of the physical thing, which is what a gate person wants
 * to see. It doubles as the personal door (TR-A5) — a standard user
 * opening `/training/me` sees only their own cards, never a colleague's
 * shortfalls.
 */
import { ArrowLeft, BadgeCheck, FileWarning, Plus, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { RecordDialog, type RecordPrefill } from './record-dialog';
import { StatusChip } from './status-chip';
import { useHasPermission } from '../../lib/permissions-context';
import { formatDate } from '../../lib/format-date';
import { trpc } from '../../lib/trpc/client';
import { useServerErrorToast } from '../../../src/lib/use-server-error';

export function PersonWallet({
  userId,
  personName,
  heading,
  backHref,
}: {
  userId?: string | undefined;
  personName?: string | undefined;
  /** Falls back to the name the server resolved, so an id-only route works. */
  heading?: string | undefined;
  /** Where "back" leads — the wallet routes were dead ends (round 4). */
  backHref?: string | undefined;
}) {
  const t = useTranslations('training.person');
  const tRecord = useTranslations('training.record');
  const tErr = useTranslations('training.errors');
  const onServerError = useServerErrorToast(tErr('generic'));
  const locale = useLocale();
  const utils = trpc.useUtils();
  const canVerify = useHasPermission('training.verify');
  const canRecord = useHasPermission('training.record');
  const [voiding, setVoiding] = useState<string | null>(null);
  // Renewal (round 4): the primary flow when a certificate lapses is
  // recording the NEW one — verify/void alone read as a dead end.
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordPrefill, setRecordPrefill] = useState<RecordPrefill | undefined>(undefined);

  // No props at all = "me". Sending `{ personName: '' }` here is what made
  // /training/me an empty wallet for every user — the server's
  // default-to-caller branch needs the field ABSENT, not empty (TR-B2).
  const query = trpc.training.person.useQuery(
    userId !== undefined ? { userId } : personName !== undefined ? { personName } : {},
  );

  const verify = trpc.training.verifyRecord.useMutation({
    onSuccess: () => void utils.training.invalidate(),
    onError: onServerError,
  });
  const supersede = trpc.training.supersedeRecord.useMutation({
    onSuccess: () => {
      setVoiding(null);
      void utils.training.invalidate();
    },
    onError: onServerError,
  });

  // UXW2-11: house convention (format-date.ts), not raw ICU — 'en'
  // resolves to en-US and printed "Aug 21, 2026" on a UK product.
  const fmt = (d: Date | null): string => (d === null ? '—' : formatDate(new Date(d), locale));

  if (query.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    );
  }

  // A failed query must never render as "no records" — the safe-looking
  // state is the lie (TR-A14).
  if (query.isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
          <FileWarning className="h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="text-sm font-medium">{tErr('loadFailed')}</p>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {tErr('retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const records = query.data?.records ?? [];
  const cells = query.data?.cells ?? [];
  const statusFor = (requirementId: string) =>
    cells.find((c) => c.requirementId === requirementId)?.status ?? 'not_required';

  const resolvedName = query.data?.personName ?? personName ?? '';
  // The server resolves the wallet's user id (null only for a free-text
  // person) — deriving it client-side from a separate "me" query linked
  // a /training/me renewal to a DUPLICATE free-text person whenever that
  // query lagged behind the click.
  const linkUserId = userId ?? query.data?.userId ?? undefined;
  const basePrefill: RecordPrefill = {
    ...(linkUserId !== undefined ? { userId: linkUserId } : { userId: null }),
    ...(resolvedName !== '' ? { personName: resolvedName } : {}),
  };

  return (
    <div className="space-y-4">
      {backHref !== undefined ? (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t('backLink')}
        </Link>
      ) : null}
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {heading !== undefined && heading !== ''
            ? heading
            : (query.data?.personName ?? t('title'))}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          {query.data !== undefined ? (
            <p className="text-xs text-muted-foreground">
              {t('asAt', { date: fmt(query.data.asOf) })}
            </p>
          ) : null}
          {canRecord ? (
            <Button
              size="sm"
              onClick={() => {
                setRecordPrefill(basePrefill);
                setRecordOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              {t('recordCertificate')}
            </Button>
          ) : null}
        </div>
      </header>
      {canRecord || canVerify ? (
        <p className="text-xs text-muted-foreground">{t('actionsHint')}</p>
      ) : null}

      {records.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            {t('noRecords')}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {records.map((r) => {
            const superseded = r.supersededAt !== null;
            return (
              <Card key={r.id} className={superseded ? 'opacity-60' : undefined}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate font-medium">
                      {cells.find((c) => c.requirementId === r.requirementId)?.requirementName ??
                        r.certificateNumber ??
                        ''}
                    </p>
                    {superseded ? (
                      <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {t('voided')}
                      </span>
                    ) : (
                      <StatusChip status={statusFor(r.requirementId)} />
                    )}
                  </div>

                  {r.certificateNumber !== null ? (
                    <p className="font-mono text-xs text-muted-foreground">{r.certificateNumber}</p>
                  ) : null}

                  <dl className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                    <div>
                      <dt className="font-medium text-foreground">{tRecord('achievedAt')}</dt>
                      <dd>{fmt(r.achievedAt)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">{tRecord('expiresAt')}</dt>
                      <dd>{r.expiresAt === null ? t('noExpiry') : fmt(r.expiresAt)}</dd>
                    </div>
                  </dl>

                  {r.awardingBody !== null ? (
                    <p className="text-xs text-muted-foreground">{r.awardingBody}</p>
                  ) : null}

                  {/* The evidence itself — the answer to the auditor's
                      third question. */}
                  {r.evidenceKey !== null ? (
                    <a
                      href={`/api/files?key=${encodeURIComponent(r.evidenceKey)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      {r.evidenceFilename ?? tRecord('evidence')}
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t('noEvidence')}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] ${
                        r.verificationStatus === 'verified'
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-muted-foreground'
                      }`}
                    >
                      <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      {r.verificationStatus === 'verified' ? t('verified') : t('unverified')}
                    </span>
                    {canVerify && r.verificationStatus !== 'verified' && !superseded ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={verify.isPending}
                        onClick={() =>
                          verify.mutate({ id: r.id, decision: 'verified', note: null })
                        }
                      >
                        {t('verify')}
                      </Button>
                    ) : null}
                    {canRecord ? (
                      // The renewal path (round 4): a new certificate with
                      // its own dates. The old card stays as evidence.
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRecordPrefill({ ...basePrefill, requirementId: r.requirementId });
                          setRecordOpen(true);
                        }}
                      >
                        {t('renew')}
                      </Button>
                    ) : null}
                    {canRecord && !superseded ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setVoiding(r.id)}
                      >
                        {t('void')}
                      </Button>
                    ) : null}
                  </div>

                  {/* Correcting an append-only record means superseding it,
                      and the reason is part of the evidence (TR-A8). */}
                  {voiding === r.id ? (
                    <form
                      className="flex items-center gap-2 pt-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const value = new FormData(e.currentTarget).get('reason');
                        const reason = typeof value === 'string' ? value.trim() : '';
                        if (reason === '') return;
                        supersede.mutate({ id: r.id, reason });
                      }}
                    >
                      <input
                        name="reason"
                        required
                        placeholder={t('voidReason')}
                        aria-label={t('voidReason')}
                        className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                      />
                      <Button size="sm" type="submit" disabled={supersede.isPending}>
                        {t('void')}
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant="ghost"
                        onClick={() => setVoiding(null)}
                      >
                        {tRecord('cancel')}
                      </Button>
                    </form>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <RecordDialog open={recordOpen} onOpenChange={setRecordOpen} prefill={recordPrefill} />
    </div>
  );
}
