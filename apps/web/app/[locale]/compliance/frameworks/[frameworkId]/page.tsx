'use client';

import { ArrowLeft, Plus, Archive, ArchiveRestore, RefreshCw, Download, FileCheck, AlertTriangle, Pencil, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../src/components/ui/card';
import { Input } from '../../../../../src/components/ui/input';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../../src/lib/permissions-context';
import { trpc } from '../../../../../src/lib/trpc/client';

function StatusBadge({ status, neverEvaluatedLabel }: { status: string | null; neverEvaluatedLabel: string }) {
  if (status === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        {neverEvaluatedLabel}
      </span>
    );
  }
  const colours: Record<string, string> = {
    compliant: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    due_soon: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    non_compliant: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    not_evaluable: 'bg-muted text-muted-foreground',
  };
  const labels: Record<string, string> = {
    compliant: 'Compliant',
    due_soon: 'Due soon',
    non_compliant: 'Non-compliant',
    not_evaluable: 'Not evaluable',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colours[status] ?? colours['not_evaluable']}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  once: 'Once',
};

// ── Attestation dialog ────────────────────────────────────────────────────────

interface AttestDialogProps {
  ruleId: string;
  ruleName: string;
  onClose: () => void;
}

function AttestDialog({ ruleId, ruleName, onClose }: AttestDialogProps) {
  const t = useTranslations('compliance.frameworks.detail.attestation');
  const tCommon = useTranslations('common');
  const [attestedAt, setAttestedAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const utils = trpc.useUtils();

  const create = trpc.compliance.attestations.create.useMutation({
    onSuccess: () => {
      toast.success(t('successToast'));
      void utils.compliance.attestations.list.invalidate({ ruleId });
      onClose();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-xl bg-background p-6 shadow-xl">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-semibold">{t('dialogTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('dialogDescription')}</p>
        <p className="mt-1 text-sm font-medium">{ruleName}</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ ruleId, attestedAt, notes });
          }}
          className="mt-5 space-y-4"
        >
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('attestedAtLabel')}</label>
            <Input
              type="date"
              value={attestedAt}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setAttestedAt(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('notesLabel')}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('notesPlaceholder')}
              rows={3}
              maxLength={5000}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>{tCommon('cancel')}</Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t('submitting') : t('submitButton')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Certification card ────────────────────────────────────────────────────────

interface CertificationCardProps {
  frameworkId: string;
  canManage: boolean;
}

function CertificationCard({ frameworkId, canManage }: CertificationCardProps) {
  const t = useTranslations('compliance.frameworks.detail.certification');
  const tCommon = useTranslations('common');
  const [editing, setEditing] = useState(false);
  const utils = trpc.useUtils();

  const { data: cert } = trpc.compliance.certifications.get.useQuery({ frameworkId });

  const [certifyingBody, setCertifyingBody] = useState('');
  const [certificationNumber, setCertificationNumber] = useState('');
  const [certifiedAt, setCertifiedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [nextAuditAt, setNextAuditAt] = useState('');
  const [notes, setNotes] = useState('');

  function openEdit() {
    setCertifyingBody(cert?.certifyingBody ?? '');
    setCertificationNumber(cert?.certificationNumber ?? '');
    setCertifiedAt(cert?.certifiedAt ?? '');
    setExpiresAt(cert?.expiresAt ?? '');
    setNextAuditAt(cert?.nextAuditAt ?? '');
    setNotes(cert?.notes ?? '');
    setEditing(true);
  }

  const upsert = trpc.compliance.certifications.upsert.useMutation({
    onSuccess: () => {
      toast.success(t('successToast'));
      void utils.compliance.certifications.get.invalidate({ frameworkId });
      setEditing(false);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{t('sectionTitle')}</CardTitle>
          {canManage && !editing ? (
            <Button type="button" variant="outline" size="sm" onClick={openEdit}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              {t('editButton')}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {!editing ? (
          cert === null || cert === undefined ? (
            <p className="text-sm text-muted-foreground">{t('noCertification')}</p>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2">
              {cert.certifyingBody.length > 0 ? (
                <div>
                  <dt className="text-xs text-muted-foreground">{t('certifyingBodyLabel')}</dt>
                  <dd className="text-sm font-medium">{cert.certifyingBody}</dd>
                </div>
              ) : null}
              {cert.certificationNumber.length > 0 ? (
                <div>
                  <dt className="text-xs text-muted-foreground">{t('certificationNumberLabel')}</dt>
                  <dd className="text-sm font-medium">{cert.certificationNumber}</dd>
                </div>
              ) : null}
              {cert.certifiedAt !== null ? (
                <div>
                  <dt className="text-xs text-muted-foreground">{t('certifiedAtLabel')}</dt>
                  <dd className="text-sm">{cert.certifiedAt}</dd>
                </div>
              ) : null}
              {cert.expiresAt !== null ? (
                <div>
                  <dt className="text-xs text-muted-foreground">{t('expiresAtLabel')}</dt>
                  <dd className="text-sm">{cert.expiresAt}</dd>
                </div>
              ) : null}
              {cert.nextAuditAt !== null ? (
                <div>
                  <dt className="text-xs text-muted-foreground">{t('nextAuditAtLabel')}</dt>
                  <dd className="text-sm">{cert.nextAuditAt}</dd>
                </div>
              ) : null}
              {cert.notes.length > 0 ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">{t('notesLabel')}</dt>
                  <dd className="text-sm">{cert.notes}</dd>
                </div>
              ) : null}
            </dl>
          )
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              upsert.mutate({
                frameworkId,
                certifyingBody,
                certificationNumber,
                certifiedAt: certifiedAt.length > 0 ? certifiedAt : null,
                expiresAt: expiresAt.length > 0 ? expiresAt : null,
                nextAuditAt: nextAuditAt.length > 0 ? nextAuditAt : null,
                notes,
              });
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('certifyingBodyLabel')}</label>
                <Input value={certifyingBody} onChange={(e) => setCertifyingBody(e.target.value)} maxLength={500} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('certificationNumberLabel')}</label>
                <Input value={certificationNumber} onChange={(e) => setCertificationNumber(e.target.value)} maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('certifiedAtLabel')}</label>
                <Input type="date" value={certifiedAt} onChange={(e) => setCertifiedAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('expiresAtLabel')}</label>
                <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('nextAuditAtLabel')}</label>
                <Input type="date" value={nextAuditAt} onChange={(e) => setNextAuditAt(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t('notesLabel')}</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={10000}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={upsert.isPending}>
                {upsert.isPending ? t('saving') : t('saveButton')}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FrameworkDetailPage() {
  const t = useTranslations('compliance.frameworks.detail');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; frameworkId: string }>();
  const locale = params.locale ?? 'en';
  const frameworkId = params.frameworkId ?? '';
  const utils = trpc.useUtils();

  const canManage = useHasPermission('compliance.manage');
  const canManageFrameworks = useHasPermission('compliance.frameworks.manage');

  const { data: fw, isLoading: fwLoading } = trpc.compliance.frameworks.get.useQuery({
    frameworkId,
  });
  const { data: rulesData, isLoading: rulesLoading } = trpc.compliance.rules.list.useQuery({
    frameworkId,
  });
  const rules = rulesData ?? [];

  const [attestingRuleId, setAttestingRuleId] = useState<string | null>(null);
  const attestingRule = rules.find((r) => r.id === attestingRuleId);

  const archive = trpc.compliance.frameworks.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archivedToast'));
      // Invalidate everything that lists frameworks — the dashboard's
      // active-framework cards, the catalogue list, and this detail page
      // all need to refetch.
      void utils.compliance.frameworks.get.invalidate({ frameworkId });
      void utils.compliance.frameworks.list.invalidate();
      void utils.compliance.dashboard.overview.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const restore = trpc.compliance.frameworks.restore.useMutation({
    onSuccess: () => {
      toast.success(t('restoredToast'));
      void utils.compliance.frameworks.get.invalidate({ frameworkId });
      void utils.compliance.frameworks.list.invalidate();
      void utils.compliance.dashboard.overview.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const evaluateRule = trpc.compliance.rules.evaluate.useMutation({
    onSuccess: () => {
      toast.success(t('evaluateEnqueued'));
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const createAction = trpc.actions.createStandalone.useMutation({
    onSuccess: () => {
      toast.success(t('remediate.successToast'));
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  // Export report handler
  const exportReport = trpc.compliance.frameworks.exportReport.useQuery(
    { frameworkId },
    { enabled: false },
  );

  async function handleExport() {
    const result = await exportReport.refetch();
    if (result.data === undefined) return;
    const { csv, filename } = result.data;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(t('exportToast'));
  }

  function handleRemediate(rule: typeof rules[0]) {
    createAction.mutate({
      title: t('remediate.actionTitle', { ruleName: rule.name }),
      description: t('remediate.actionDescription', {
        frameworkName: fw?.name ?? '',
        clauseRef: rule.clauseRef,
      }),
      priority: 'high',
    });
  }

  if (fwLoading || fw === undefined) {
    return <Skeleton className="m-6 h-96 w-full" />;
  }

  const isArchived = fw.archivedAt !== null;

  return (
    <div className="space-y-6 p-6">
      {attestingRuleId !== null && attestingRule !== undefined ? (
        <AttestDialog
          ruleId={attestingRuleId}
          ruleName={attestingRule.name}
          onClose={() => setAttestingRuleId(null)}
        />
      ) : null}

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <Link
          href={`/${locale}/compliance`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
        <div className="flex items-center gap-2">
          {!isArchived ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exportReport.isFetching}
            >
              <Download className="mr-1 h-4 w-4" />
              {t('exportButton')}
            </Button>
          ) : null}
          {canManageFrameworks && !isArchived ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => archive.mutate({ frameworkId })}
              disabled={archive.isPending}
            >
              <Archive className="mr-1 h-4 w-4" />
              {tCommon('archive')}
            </Button>
          ) : null}
          {canManageFrameworks && isArchived ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => restore.mutate({ frameworkId })}
              disabled={restore.isPending}
            >
              <ArchiveRestore className="mr-1 h-4 w-4" />
              {t('restoreButton')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Framework info */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{fw.name}</h1>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
            {fw.type.replace('_', ' ')}
          </span>
          {isArchived ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {t('archived')}
            </span>
          ) : null}
        </div>
        {fw.description.length > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{fw.description}</p>
        ) : null}

        {/* Metadata badges row */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/* Scope */}
          {Array.isArray(fw.applicableSites) && (fw.applicableSites as string[]).length > 0 ? (
            <span className="inline-flex items-center rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
              {t('scopeSites', { count: (fw.applicableSites as string[]).length })}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
              {t('scopeCompanyWide')}
            </span>
          )}
          {/* Jurisdiction */}
          {fw.jurisdiction !== null && fw.jurisdiction.length > 0 ? (
            <span className="inline-flex items-center rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
              {t('jurisdictionLabel')}: {fw.jurisdiction}
            </span>
          ) : null}
          {/* Owner */}
          {'ownerName' in fw && fw.ownerName !== null ? (
            <span className="inline-flex items-center rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
              {t('ownerLabel')}: {fw.ownerName as string}
            </span>
          ) : null}
          {/* Target score */}
          {fw.targetScore !== null ? (
            <span className="inline-flex items-center rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
              {t('targetScore')}: {fw.targetScore}%
            </span>
          ) : null}
        </div>
      </div>

      {/* Rules table */}
      <div>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{t('rulesTitle')}</h2>
          {canManage && !isArchived ? (
            <Button asChild size="sm">
              <Link href={`/${locale}/compliance/frameworks/${frameworkId}/rules/new`}>
                <Plus className="mr-1 h-4 w-4" />
                {t('addRuleButton')}
              </Link>
            </Button>
          ) : null}
        </div>

        {rulesLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rules.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {t('noRules')}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">{t('table.name')}</th>
                      <th className="px-4 py-3 text-left font-medium">{t('table.clauseRef')}</th>
                      <th className="px-4 py-3 text-left font-medium">{t('table.frequency')}</th>
                      <th className="px-4 py-3 text-left font-medium">{t('table.status')}</th>
                      <th className="px-4 py-3 text-left font-medium">{t('table.nextDue')}</th>
                      <th className="px-4 py-3 text-left font-medium">{t('table.responsible')}</th>
                      {canManage ? (
                        <th className="px-4 py-3 text-right font-medium">{t('table.actions')}</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rules.map((rule) => (
                      <tr key={rule.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium">{rule.name}</p>
                          {rule.description.length > 0 ? (
                            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                              {rule.description}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {rule.clauseRef.length > 0 ? rule.clauseRef : '—'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {FREQUENCY_LABELS[rule.frequency] ?? rule.frequency}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={rule.latestEvalStatus} neverEvaluatedLabel={t('neverEvaluated')} />
                          {rule.latestEvaluatedAt !== null ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {new Date(rule.latestEvaluatedAt).toLocaleDateString()}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {rule.nextDueAt !== null ? rule.nextDueAt : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {rule.responsibleUserName !== null ? rule.responsibleUserName : '—'}
                        </td>
                        {canManage ? (
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              {/* Evaluate */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => evaluateRule.mutate({ ruleId: rule.id })}
                                disabled={evaluateRule.isPending || isArchived}
                                title={t('evaluateRuleButton')}
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </Button>
                              {/* Manual attestation */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setAttestingRuleId(rule.id)}
                                disabled={isArchived}
                                title={t('attestation.buttonLabel')}
                              >
                                <FileCheck className="h-3.5 w-3.5" />
                              </Button>
                              {/* Gap analysis → action */}
                              {rule.latestEvalStatus === 'non_compliant' ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRemediate(rule)}
                                  disabled={createAction.isPending || isArchived}
                                  title={t('remediate.buttonLabel')}
                                >
                                  <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Certification tracking */}
      <CertificationCard frameworkId={frameworkId} canManage={canManage} />
    </div>
  );
}
