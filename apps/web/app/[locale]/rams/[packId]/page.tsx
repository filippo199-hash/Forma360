'use client';

/**
 * The RAMS pack page — the job as a worked file.
 *
 * Opens with the issue-gate checklist when the pack is still a draft
 * (the author sees exactly what stands between them and issuing, all at
 * once rather than one error at a time), and with the briefing status
 * once it is issued. Everything else — bindings, steps, documents,
 * client acceptance, version history, timeline — reads below.
 */
import { ClipboardCheck, Download, FileWarning, Link2, PenLine, Send, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { RAMS_AUTHOR_ATTESTATION } from '@forma360/shared/rams';
import {
  BriefingChip,
  HoldPointChip,
  PackStatusChip,
} from '../../../../src/components/rams/chips';
import {
  ClientLinkRow,
  isStaleClientLink,
} from '../../../../src/components/rams/client-link-row';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';
import { formatDateTime } from '../../../../src/lib/format-date';

export default function RamsPackPage() {
  const t = useTranslations('rams');
  const params = useParams<{ locale: string; packId: string }>();
  const { locale, packId } = params;
  const canIssue = useHasPermission('rams.issue');
  const canCreate = useHasPermission('rams.create');
  const canBrief = useHasPermission('rams.brief');

  const utils = trpc.useUtils();
  const pack = trpc.rams.packs.get.useQuery({ packId });

  const [attested, setAttested] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [showWithdraw, setShowWithdraw] = useState(false);
  // RS-A5: re-issue is a signing event, not a button.
  const [showReissue, setShowReissue] = useState(false);
  const [reissueAttested, setReissueAttested] = useState(false);
  const [reissueNote, setReissueNote] = useState('');

  // RS-A13: the author reads the declaration in their own language.
  // The canonical English wording is still what the router snapshots
  // onto the version and what the PDF prints, so the record is identical
  // everywhere (ADR 0015) — the translation is for comprehension, and a
  // non-English author is told so explicitly.
  const attestationText = t('gate.attestationText');
  const attestationIsTranslated = attestationText !== RAMS_AUTHOR_ATTESTATION;
  const [clientName, setClientName] = useState('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const invalidate = (): void => {
    void utils.rams.packs.get.invalidate({ packId });
    void utils.rams.packs.list.invalidate();
    void utils.rams.packs.overview.invalidate();
  };

  // RS-A14: these mutations swallowed their errors — issuing a pack that
  // silently did not issue is the worst kind of quiet failure in a module
  // whose whole job is proving what was in force.
  const issue = trpc.rams.packs.issue.useMutation({
    onSuccess: () => {
      setActionError(null);
      // NR3-07: a signature tick must never persist past its signing
      // event, and the re-issue form must not sit open one click away
      // from issuing v(n+2). The stale share-URL box goes too — it
      // shows the previous version's link.
      setAttested(false);
      setShowReissue(false);
      setReissueAttested(false);
      setReissueNote('');
      setShareUrl(null);
      invalidate();
    },
    onError: (err) => setActionError(err.message),
  });
  const withdraw = trpc.rams.packs.withdraw.useMutation({
    onSuccess: () => {
      setActionError(null);
      setShowWithdraw(false);
      invalidate();
    },
    onError: (err) => setActionError(err.message),
  });
  const createLink = trpc.rams.client.createLink.useMutation({
    onSuccess: (r) => {
      setClientError(null);
      setShareUrl(r.url);
      invalidate();
    },
    onError: (err) => setClientError(err.message),
  });
  const revokeLink = trpc.rams.client.revokeLink.useMutation({
    onSuccess: () => {
      setClientError(null);
      setShareUrl(null);
      invalidate();
    },
    onError: (err) => setClientError(err.message),
  });

  async function showLinkUrl(linkId: string): Promise<void> {
    try {
      const result = await utils.rams.client.getLinkUrl.fetch({ linkId });
      setClientError(null);
      setShareUrl(result.url);
    } catch (err) {
      setClientError(err instanceof Error ? err.message : String(err));
    }
  }

  if (pack.isPending) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-3 px-4 py-6">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }
  if (pack.error !== null) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-6">
        <p className="text-destructive">{pack.error.message}</p>
      </main>
    );
  }

  const data = pack.data;
  const p = data.pack;
  const gateErrors = data.issueGate.errors.filter((e) => e !== 'attestation-not-confirmed');
  const readyToIssue = gateErrors.length === 0;
  const briefedOnCurrent = data.briefings.filter((b) => b.current).length;
  const briefedOnOld = data.briefings.length - briefedOnCurrent;
  const hasStaleClientLink = data.clientLinks.some((l) => isStaleClientLink(l, p.currentVersion));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm">{p.referenceNumber ?? p.id.slice(-6)}</span>
          <PackStatusChip status={p.status} />
          {p.currentVersion > 0 ? (
            <span className="text-muted-foreground text-sm">
              {t('versionLabel', { version: p.currentVersion })}
            </span>
          ) : null}
        </div>
        <h1 className="mt-1 text-2xl font-semibold">{p.title}</h1>
        <p className="text-muted-foreground text-sm">
          {p.clientName} · {data.site?.name ?? t('fields.noSite')} · {p.locationText}
        </p>
      </header>

      {p.status === 'withdrawn' ? (
        <Card className="border-destructive mb-5">
          <CardContent className="py-4">
            <p className="text-destructive font-medium">{t('withdrawnBanner')}</p>
            <p className="text-sm">{p.withdrawnReason}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* NR3-04: the pack has been edited since it was issued. Editing an
          issued pack is deliberate (the builder stays open); shipping the
          drift silently is not — briefings and client links still refer
          to the frozen version. Mirrors the RA module's A-1 banner. */}
      {data.hasUnpublishedChanges && (canCreate || canIssue) ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-200">
          <span>{t('unpublishedChangesBanner', { version: p.currentVersion })}</span>
          {canCreate ? (
            <Button asChild type="button" size="sm" variant="outline">
              <Link href={`/${locale}/rams/${packId}/build`}>{t('openBuilder')}</Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* RS-A14: issue / re-issue / withdraw failures are shown, not swallowed. */}
      {actionError !== null ? (
        <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {actionError}
        </p>
      ) : null}

      {/* Draft: the issue-gate checklist is the primary content. */}
      {p.status === 'draft' ? (
        <Card className="mb-5">
          <CardContent className="py-4">
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              <ClipboardCheck className="h-4 w-4" aria-hidden />
              {t('gate.title')}
            </h2>
            {readyToIssue ? (
              <p className="mb-3 text-sm text-emerald-700 dark:text-emerald-300">
                {t('gate.allClear')}
              </p>
            ) : (
              <ul className="mb-3 space-y-1 text-sm">
                {gateErrors.map((code) => (
                  <li key={code} className="flex items-start gap-2">
                    <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                    <span>{t(`errors.${code}`)}</span>
                  </li>
                ))}
              </ul>
            )}

            {data.issueGate.unreferenced.length > 0 ? (
              <div className="bg-muted mb-3 rounded-md p-3 text-sm">
                <p className="mb-1 font-medium">{t('gate.unreferencedTitle')}</p>
                <ul className="list-inside list-disc">
                  {data.issueGate.unreferenced.map((h) => (
                    <li key={`${h.raVersionId}-${h.hazardIndex}`}>
                      {h.hazard}{' '}
                      <span className="text-muted-foreground">
                        ({h.assessmentTitle} · {t(`band.${h.band}`)})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {canCreate ? (
                <Button asChild type="button" variant="outline" size="sm">
                  <Link href={`/${locale}/rams/${packId}/build`}>
                    <PenLine className="mr-1.5 h-4 w-4" aria-hidden />
                    {t('openBuilder')}
                  </Link>
                </Button>
              ) : null}
            </div>

            {canIssue && readyToIssue ? (
              <div className="mt-4 border-t pt-4">
                <p className="mb-2 text-sm font-medium">{t('gate.attestationTitle')}</p>
                <p className="text-muted-foreground mb-2 text-sm">{attestationText}</p>
                {attestationIsTranslated ? (
                  <p className="text-muted-foreground mb-2 text-xs">
                    {t('gate.attestationCanonical')}
                  </p>
                ) : null}
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={attested}
                    onChange={(e) => setAttested(e.target.checked)}
                  />
                  <span>{t('gate.attestationConfirm')}</span>
                </label>
                {issue.error !== null ? (
                  <p className="text-destructive mt-2 text-sm">{issue.error.message}</p>
                ) : null}
                <Button
                  type="button"
                  className="mt-3"
                  disabled={!attested || issue.isPending}
                  onClick={() => issue.mutate({ packId, confirmAttestation: true })}
                >
                  {t('issuePack')}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Issued: briefing status leads. */}
      {p.status === 'issued' ? (
        <Card className="mb-5">
          <CardContent className="py-4">
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              <Users className="h-4 w-4" aria-hidden />
              {t('briefing.title')}
            </h2>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <BriefingChip onCurrent={briefedOnCurrent} currentVersion={p.currentVersion} />
              {briefedOnOld > 0 ? (
                <span className="text-muted-foreground text-sm">
                  {t('briefing.onSuperseded', { count: briefedOnOld })}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {canBrief ? (
                <Button asChild type="button" size="sm">
                  <Link href={`/${locale}/rams/${packId}/brief`}>{t('briefing.open')}</Link>
                </Button>
              ) : null}
              <Button asChild type="button" variant="outline" size="sm">
                <a href={`/api/exports/rams-pdf?packId=${packId}`} target="_blank" rel="noreferrer">
                  <Download className="mr-1.5 h-4 w-4" aria-hidden />
                  {t('downloadPdf')}
                </a>
              </Button>
              {canIssue ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowReissue((v) => !v)}
                  >
                    {t('reissuePack')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowWithdraw((v) => !v)}
                  >
                    {t('withdrawPack')}
                  </Button>
                </>
              ) : null}
            </div>

            {/* RS-A5: re-issue signs the author's declaration exactly as
                the first issue does — the text in full and an explicit
                tick. It previously fired the mutation with
                confirmAttestation hardcoded true, so the record claimed a
                named person had attested a declaration they were never
                shown. It also warns what version n+1 costs: every
                briefing against the current version stops counting. */}
            {showReissue ? (
              <div className="mt-3 space-y-2 border-t pt-3">
                <p className="text-sm font-medium">{t('reissue.title')}</p>
                <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  {t('reissue.invalidatesWarning', { count: briefedOnCurrent })}
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="reissue-note">{t('reissue.note')}</Label>
                  <Textarea
                    id="reissue-note"
                    rows={2}
                    value={reissueNote}
                    onChange={(e) => setReissueNote(e.target.value)}
                    placeholder={t('reissue.notePlaceholder')}
                  />
                </div>
                <p className="text-sm font-medium">{t('gate.attestationTitle')}</p>
                <p className="text-muted-foreground text-sm">{attestationText}</p>
                {attestationIsTranslated ? (
                  <p className="text-muted-foreground text-xs">{t('gate.attestationCanonical')}</p>
                ) : null}
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={reissueAttested}
                    onChange={(e) => setReissueAttested(e.target.checked)}
                  />
                  <span>{t('gate.attestationConfirm')}</span>
                </label>
                {issue.error !== null ? (
                  <p className="text-destructive text-sm">{issue.error.message}</p>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  disabled={!reissueAttested || issue.isPending}
                  onClick={() =>
                    issue.mutate({
                      packId,
                      confirmAttestation: true,
                      ...(reissueNote.trim() !== '' ? { reissueNote: reissueNote.trim() } : {}),
                    })
                  }
                >
                  {t('reissue.confirm')}
                </Button>
              </div>
            ) : null}

            {showWithdraw ? (
              <div className="mt-3 border-t pt-3">
                <Label htmlFor="withdraw-reason">{t('withdrawReason')}</Label>
                <Textarea
                  id="withdraw-reason"
                  rows={2}
                  value={withdrawReason}
                  onChange={(e) => setWithdrawReason(e.target.value)}
                />
                {withdraw.error !== null ? (
                  <p className="text-destructive mt-1 text-sm">{withdraw.error.message}</p>
                ) : null}
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="mt-2"
                  disabled={withdrawReason.trim().length === 0 || withdraw.isPending}
                  onClick={() => withdraw.mutate({ packId, reason: withdrawReason.trim() })}
                >
                  {t('confirmWithdraw')}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Client issue */}
      {p.status === 'issued' && canIssue ? (
        <Card className="mb-5">
          <CardContent className="py-4">
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              <Send className="h-4 w-4" aria-hidden />
              {t('client.title')}
            </h2>
            {data.clientLinks.length > 0 ? (
              <ul className="mb-3 space-y-1 text-sm">
                {data.clientLinks.map((l) => (
                  <ClientLinkRow
                    key={l.id}
                    link={l}
                    currentVersion={p.currentVersion}
                    revokePending={revokeLink.isPending}
                    onShowLink={(linkId) => void showLinkUrl(linkId)}
                    onRevoke={(linkId) => revokeLink.mutate({ linkId })}
                  />
                ))}
              </ul>
            ) : null}
            {/* NR3-07: a live link pinned to a superseded version means
                the client is still looking at old work. createLink mints
                against the current version, so the fix is one click. */}
            {hasStaleClientLink ? (
              <p className="mb-2 text-sm text-amber-700 dark:text-amber-300">
                {t('client.staleLinkPrompt', { current: p.currentVersion })}
              </p>
            ) : null}
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="client-name">{t('client.issuedTo')}</Label>
                <Input
                  id="client-name"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="max-w-xs"
                />
              </div>
              <Button
                type="button"
                size="sm"
                disabled={createLink.isPending}
                onClick={() => createLink.mutate({ packId, issuedToName: clientName.trim() })}
              >
                <Link2 className="mr-1.5 h-4 w-4" aria-hidden />
                {t('client.createLink')}
              </Button>
            </div>
            {clientError !== null ? (
              <p className="mt-2 text-sm text-red-700 dark:text-red-400">{clientError}</p>
            ) : null}
            {shareUrl !== null ? (
              <div className="bg-muted mt-2 flex items-center gap-2 rounded p-2">
                <p className="flex-1 font-mono text-xs break-all">{shareUrl}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(shareUrl);
                  }}
                >
                  {t('client.copyLink')}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Bindings */}
      <Card className="mb-5">
        <CardContent className="py-4">
          <h2 className="mb-2 font-semibold">{t('bindings.title')}</h2>
          {data.riskAssessments.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('bindings.noRas')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.riskAssessments.map((ra) => (
                <li key={ra.raVersionId}>
                  <Link
                    className="hover:underline"
                    href={`/${locale}/risk-assessments/${ra.assessmentId}`}
                  >
                    {ra.referenceNumber ?? ''} {ra.title}
                  </Link>{' '}
                  <span className="text-muted-foreground">
                    {t('versionLabel', { version: ra.versionNumber })} ·{' '}
                    {t('bindings.hazardCount', { count: ra.hazards.length })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.coshh.length > 0 ? (
            <>
              <h3 className="mt-3 mb-1 text-sm font-medium">{t('bindings.coshh')}</h3>
              <ul className="space-y-1 text-sm">
                {data.coshh.map((c) => (
                  <li key={c.id}>
                    {c.substanceName ?? ''} — {c.taskDescription}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Steps preview */}
      <Card className="mb-5">
        <CardContent className="py-4">
          <h2 className="mb-2 font-semibold">{t('steps.title')}</h2>
          {p.draftContent.steps.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('steps.none')}</p>
          ) : (
            <ol className="space-y-3">
              {p.draftContent.steps.map((s) => (
                <li key={s.id} className="border-l-2 pl-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {s.sequence}. {s.title}
                    </span>
                    {s.holdPoint !== null ? <HoldPointChip /> : null}
                  </div>
                  {s.description.length > 0 ? (
                    <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                      {s.description}
                    </p>
                  ) : null}
                  {s.holdPoint !== null ? (
                    <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                      {s.holdPoint.description}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Version history */}
      {data.versions.length > 0 ? (
        <Card className="mb-5">
          <CardContent className="py-4">
            <h2 className="mb-2 font-semibold">{t('versions.title')}</h2>
            <ul className="space-y-1 text-sm">
              {data.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {t('versionLabel', { version: v.versionNumber })}
                  </span>
                  <span className="text-muted-foreground">
                    {formatDateTime(v.issuedAt)}
                    {v.issuedByName !== null ? ` · ${v.issuedByName}` : ''}
                    {v.supersededAt !== null ? ` · ${t('versions.superseded')}` : ''}
                  </span>
                  <a
                    className="text-primary hover:underline"
                    href={`/api/exports/rams-pdf?packId=${packId}&packVersionId=${v.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('downloadPdf')}
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* Timeline */}
      <Card>
        <CardContent className="py-4">
          <h2 className="mb-2 font-semibold">{t('timeline.title')}</h2>
          <ul className="space-y-1 text-sm">
            {data.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-2">
                <span className="text-muted-foreground font-mono text-xs">
                  {formatDateTime(e.createdAt)}
                </span>
                <span>{t(`events.${e.kind}`)}</span>
                {e.detail.length > 0 ? (
                  <span className="text-muted-foreground">{e.detail}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
