'use client';

import { ArrowLeft, Check, FileText, Pencil, Plus, Upload, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../src/components/ui/dialog';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { ContractorAssetsSection } from '../../../../src/components/contractors/contractor-assets';
import { ContractorUsersSection } from '../../../../src/components/contractors/contractor-users';
import { ContractorVisitsSection } from '../../../../src/components/contractors/contractor-visits';
import { cn } from '../../../../src/lib/cn';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

const DOC_BADGE: Record<string, string> = {
  verified: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
};

const STATUS_BADGE: Record<string, string> = {
  compliant: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  non_compliant: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
  suspended: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-100',
  no_requirements: 'bg-muted text-muted-foreground',
};

const OVERRIDE_OPTIONS = ['', 'compliant', 'non_compliant', 'suspended'] as const;

export default function ContractorDetailPage() {
  const t = useTranslations('contractors');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const params = useParams<{ locale: string; contractorId: string }>();
  const locale = params.locale ?? 'en';
  const contractorId = params.contractorId ?? '';
  const canManage = useHasPermission('contractors.manage');
  const canVerify = useHasPermission('contractors.verifyDocs');
  const utils = trpc.useUtils();
  const router = useRouter();

  const { data, isLoading } = trpc.contractors.get.useQuery(
    { id: contractorId },
    { enabled: contractorId !== '' },
  );

  const invalidate = () => void utils.contractors.get.invalidate({ id: contractorId });
  const onErr = (err: { message: string }) =>
    toast.error(err.message.length > 0 ? err.message : t('error'));

  const addRequirement = trpc.contractors.addRequirement.useMutation({
    onSuccess: () => {
      invalidate();
      setReqOpen(false);
      setReqName('');
      setReqBlocking(true);
    },
    onError: onErr,
  });
  const removeRequirement = trpc.contractors.removeRequirement.useMutation({
    onSuccess: invalidate,
    onError: onErr,
  });
  const addDocument = trpc.contractors.addDocument.useMutation({
    onSuccess: () => {
      toast.success(t('uploadedToast'));
      invalidate();
      setUploadReqId(null);
      setUpStart('');
      setUpEnd('');
    },
    onError: onErr,
  });
  const verifyDocument = trpc.contractors.verifyDocument.useMutation({
    onSuccess: () => {
      toast.success(t('verifiedToast'));
      invalidate();
    },
    onError: onErr,
  });
  const rejectDocument = trpc.contractors.rejectDocument.useMutation({
    onSuccess: () => {
      toast.success(t('rejectedToast'));
      invalidate();
    },
    onError: onErr,
  });
  const archive = trpc.contractors.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archivedToast'));
      router.push(`/${locale}/contractors`);
    },
    onError: onErr,
  });
  const update = trpc.contractors.update.useMutation({
    onSuccess: () => {
      toast.success(t('savedToast'));
      invalidate();
      setEditOpen(false);
    },
    onError: onErr,
  });
  const applyTemplates = trpc.contractors.applyTemplates.useMutation({
    onSuccess: (res) => {
      toast.success(t('appliedToast', { count: res.applied }));
      invalidate();
    },
    onError: onErr,
  });
  const regenLink = trpc.contractors.regenerateUploadLink.useMutation({
    onSuccess: async ({ token }) => {
      const url = `${window.location.origin}/${locale}/contractor-upload/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success(t('uploadLinkCopied'));
      } catch {
        window.prompt(t('copyUploadLink'), url);
      }
    },
    onError: onErr,
  });
  const setOverride = trpc.contractors.setComplianceOverride.useMutation({
    onSuccess: () => {
      toast.success(t('savedToast'));
      invalidate();
      setOverrideOpen(false);
    },
    onError: onErr,
  });

  // Compliance-override dialog
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [ovValue, setOvValue] = useState<string>('');
  const [ovReason, setOvReason] = useState('');

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [edName, setEdName] = useState('');
  const [edCategory, setEdCategory] = useState('');
  const [edContactName, setEdContactName] = useState('');
  const [edContactEmail, setEdContactEmail] = useState('');
  const [edNotes, setEdNotes] = useState('');

  // Add-requirement dialog
  const [reqOpen, setReqOpen] = useState(false);
  const [reqName, setReqName] = useState('');
  const [reqBlocking, setReqBlocking] = useState(true);

  // Upload-document dialog
  const [uploadReqId, setUploadReqId] = useState<string | null>(null);
  const [upStart, setUpStart] = useState('');
  const [upEnd, setUpEnd] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file === undefined || uploadReqId === null) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('contractorId', contractorId);
      const res = await fetch('/api/upload/contractor-doc', { method: 'POST', body: form });
      if (!res.ok) throw new Error('upload-failed');
      const body = (await res.json()) as {
        storageKey: string;
        filename: string;
        mimeType: string;
        sizeBytes: number;
      };
      addDocument.mutate({
        requirementId: uploadReqId,
        storageKey: body.storageKey,
        filename: body.filename,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        ...(upStart !== '' ? { startDate: upStart } : {}),
        ...(upEnd !== '' ? { endDate: upEnd } : {}),
      });
    } catch {
      toast.error(t('error'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  if (isLoading || data === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { contractor, requirements, complianceStatus } = data;
  const isOverridden = contractor.complianceOverride !== null;

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/contractors`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('backToList')}
      </Link>

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{contractor.name}</h1>
        <button
          type="button"
          disabled={!canManage}
          onClick={() => {
            setOvValue(contractor.complianceOverride ?? '');
            setOvReason(contractor.complianceOverrideReason ?? '');
            setOverrideOpen(true);
          }}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            STATUS_BADGE[complianceStatus] ?? 'bg-muted text-muted-foreground',
            canManage ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
          )}
          title={canManage ? t('override.editTitle') : undefined}
        >
          {t(`status_${complianceStatus}` as 'status_compliant')}
          {isOverridden ? <Pencil className="h-3 w-3 opacity-70" /> : null}
        </button>
        {isOverridden ? (
          <span
            className="text-xs text-muted-foreground"
            title={contractor.complianceOverrideReason ?? undefined}
          >
            {t('override.manualIndicator')}
          </span>
        ) : null}
        {contractor.category !== null && contractor.category !== '' ? (
          <span className="rounded-md border bg-background px-2 py-0.5 text-xs text-muted-foreground">
            {contractor.category}
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canManage && contractor.category !== null && contractor.category !== '' ? (
            <Button
              variant="outline"
              size="sm"
              disabled={applyTemplates.isPending}
              onClick={() => applyTemplates.mutate({ id: contractorId })}
            >
              {t('applyTemplate', { category: contractor.category })}
            </Button>
          ) : null}
          {canManage ? (
            <Button
              variant="outline"
              size="sm"
              disabled={regenLink.isPending}
              onClick={() => regenLink.mutate({ id: contractorId })}
            >
              {regenLink.isPending ? t('uploadLinkGenerating') : t('copyUploadLink')}
            </Button>
          ) : null}
          {canManage ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEdName(contractor.name);
                setEdCategory(contractor.category ?? '');
                setEdContactName(contractor.primaryContactName ?? '');
                setEdContactEmail(contractor.primaryContactEmail ?? '');
                setEdNotes(contractor.notes ?? '');
                setEditOpen(true);
              }}
            >
              {t('editContractor')}
            </Button>
          ) : null}
          {canManage ? (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (window.confirm(t('archiveConfirm'))) archive.mutate({ id: contractorId });
              }}
            >
              {t('archiveButton')}
            </Button>
          ) : null}
        </div>
      </header>

      {/* Compliance-override dialog */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('override.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('override.intro')}</p>
            <div className="space-y-1.5">
              {OVERRIDE_OPTIONS.map((opt) => (
                <label key={opt || 'auto'} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="ov"
                    className="mt-0.5"
                    checked={ovValue === opt}
                    onChange={() => setOvValue(opt)}
                  />
                  <span>
                    {opt === ''
                      ? t('override.auto', {
                          status: t(
                            `status_${data.derivedComplianceStatus}` as 'status_compliant',
                          ),
                        })
                      : t(`status_${opt}` as 'status_compliant')}
                  </span>
                </label>
              ))}
            </div>
            {ovValue !== '' ? (
              <div className="space-y-1.5">
                <Label htmlFor="ov-reason">{t('override.reasonLabel')}</Label>
                <Input
                  id="ov-reason"
                  value={ovReason}
                  onChange={(e) => setOvReason(e.target.value)}
                  maxLength={1000}
                  placeholder={t('override.reasonPlaceholder')}
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOverrideOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              disabled={setOverride.isPending}
              onClick={() =>
                setOverride.mutate({
                  id: contractorId,
                  override:
                    ovValue === ''
                      ? null
                      : (ovValue as 'compliant' | 'non_compliant' | 'suspended'),
                  ...(ovValue !== '' && ovReason.trim() !== '' ? { reason: ovReason.trim() } : {}),
                })
              }
            >
              {t('saveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('editTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ed-name">{t('fieldName')}</Label>
              <Input
                id="ed-name"
                value={edName}
                onChange={(e) => setEdName(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-cat">{t('fieldCategory')}</Label>
              <Input
                id="ed-cat"
                value={edCategory}
                onChange={(e) => setEdCategory(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ed-cn">{t('fieldContactName')}</Label>
                <Input
                  id="ed-cn"
                  value={edContactName}
                  onChange={(e) => setEdContactName(e.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ed-ce">{t('fieldContactEmail')}</Label>
                <Input
                  id="ed-ce"
                  type="email"
                  value={edContactEmail}
                  onChange={(e) => setEdContactEmail(e.target.value)}
                  maxLength={200}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-notes">{t('fieldNotes')}</Label>
              <textarea
                id="ed-notes"
                value={edNotes}
                onChange={(e) => setEdNotes(e.target.value)}
                rows={3}
                maxLength={5000}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              disabled={update.isPending || edName.trim() === ''}
              onClick={() =>
                update.mutate({
                  id: contractorId,
                  name: edName.trim(),
                  category: edCategory.trim() === '' ? null : edCategory.trim(),
                  primaryContactName: edContactName.trim() === '' ? null : edContactName.trim(),
                  primaryContactEmail: edContactEmail.trim() === '' ? null : edContactEmail.trim(),
                  notes: edNotes.trim() === '' ? null : edNotes.trim(),
                })
              }
            >
              {t('saveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {contractor.primaryContactName !== null ||
      contractor.primaryContactEmail !== null ||
      (contractor.notes !== null && contractor.notes !== '') ? (
        <Card>
          <CardContent className="grid gap-x-8 gap-y-2 p-4 text-sm sm:grid-cols-2">
            {contractor.primaryContactName !== null || contractor.primaryContactEmail !== null ? (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('contactLabel')}
                </p>
                <p>{contractor.primaryContactName ?? '—'}</p>
                {contractor.primaryContactEmail !== null ? (
                  <p className="text-muted-foreground">{contractor.primaryContactEmail}</p>
                ) : null}
              </div>
            ) : null}
            {contractor.notes !== null && contractor.notes !== '' ? (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('notesLabel')}
                </p>
                <p className="whitespace-pre-wrap">{contractor.notes}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Requirements */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{t('requirementsHeading')}</h2>
            <p className="text-sm text-muted-foreground">{t('requirementsSubtitle')}</p>
          </div>
          {canManage ? (
            <Button variant="outline" size="sm" onClick={() => setReqOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('addRequirement')}
            </Button>
          ) : null}
        </div>

        {requirements.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {t('noRequirements')}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {requirements.map((r) => (
              <Card key={r.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    {r.blocking ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                        {t('reqBlocking')}
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {t('reqAdvisory')}
                      </span>
                    )}
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        r.satisfied
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
                      )}
                    >
                      {r.satisfied ? t('reqSatisfied') : t('reqMissing')}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      {canManage ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => {
                            setUploadReqId(r.id);
                            setUpStart('');
                            setUpEnd('');
                          }}
                        >
                          <Upload className="mr-1 h-3.5 w-3.5" />
                          {t('uploadDocument')}
                        </Button>
                      ) : null}
                      {canManage ? (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            if (window.confirm(t('reqRemoveConfirm')))
                              removeRequirement.mutate({ id: r.id });
                          }}
                        >
                          {t('reqRemove')}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {r.documents.length > 0 ? (
                    <ul className="divide-y rounded-md border">
                      {r.documents.map((d) => (
                        <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate">{d.filename}</p>
                            <p className="text-xs text-muted-foreground">
                              {d.endDate !== null
                                ? t('expires', {
                                    date: format.dateTime(new Date(`${d.endDate}T00:00:00`), {
                                      dateStyle: 'medium',
                                    }),
                                  })
                                : t('noExpiry')}
                              {d.status === 'rejected' && d.rejectReason !== null
                                ? ` · ${d.rejectReason}`
                                : ''}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                              DOC_BADGE[d.status] ?? 'bg-muted text-muted-foreground',
                            )}
                          >
                            {t(`docStatus_${d.status}` as 'docStatus_pending')}
                          </span>
                          {canVerify && d.status !== 'verified' ? (
                            <button
                              type="button"
                              title={t('verifyButton')}
                              className="shrink-0 rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                              onClick={() => verifyDocument.mutate({ id: d.id })}
                            >
                              <Check className="h-4 w-4" />
                            </button>
                          ) : null}
                          {canVerify && d.status !== 'rejected' ? (
                            <button
                              type="button"
                              title={t('rejectButton')}
                              className="shrink-0 rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                              onClick={() => {
                                const reason = window.prompt(t('rejectReasonPrompt')) ?? '';
                                rejectDocument.mutate({ id: d.id, reason });
                              }}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Visits (Phase 2a) */}
      <ContractorVisitsSection contractorId={contractorId} canManage={canManage} />

      {/* Serviced assets (Phase 3) */}
      <ContractorAssetsSection contractorId={contractorId} canManage={canManage} />

      {/* Portal users (Phase 4) */}
      <ContractorUsersSection contractorId={contractorId} canManage={canManage} />

      {/* Add-requirement dialog */}
      <Dialog open={reqOpen} onOpenChange={setReqOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('addRequirement')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="req-name">{t('fieldName')}</Label>
              <Input
                id="req-name"
                value={reqName}
                onChange={(e) => setReqName(e.target.value)}
                placeholder={t('reqNamePlaceholder')}
                maxLength={200}
                autoFocus
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={reqBlocking}
                onChange={(e) => setReqBlocking(e.target.checked)}
              />
              {t('reqBlocking')}
            </label>
            <p className="text-xs text-muted-foreground">{t('templateBlockingHelp')}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReqOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              disabled={addRequirement.isPending || reqName.trim() === ''}
              onClick={() =>
                addRequirement.mutate({
                  contractorId,
                  name: reqName.trim(),
                  blocking: reqBlocking,
                })
              }
            >
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload-document dialog */}
      <Dialog open={uploadReqId !== null} onOpenChange={(o) => !o && setUploadReqId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('uploadDocument')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="up-start">{t('startDateLabel')}</Label>
                <Input
                  id="up-start"
                  type="date"
                  value={upStart}
                  onChange={(e) => setUpStart(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="up-end">{t('endDateLabel')}</Label>
                <Input
                  id="up-end"
                  type="date"
                  value={upEnd}
                  onChange={(e) => setUpEnd(e.target.value)}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || addDocument.isPending}
              className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition-colors hover:border-primary/60 hover:bg-muted/40 disabled:opacity-60"
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              {uploading || addDocument.isPending ? t('uploading') : t('chooseFile')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={handleFile}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
