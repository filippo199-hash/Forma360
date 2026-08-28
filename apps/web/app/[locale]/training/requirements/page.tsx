'use client';

/**
 * The requirement catalogue and its assignments (FreeHS B7).
 *
 * This is the screen that makes the matrix maintainable at 800 people:
 * requirements are driven **by role, not typed per person**.
 *
 * Review fixes (TR-A11): the catalogue can now express itself. The chase
 * window is editable rather than hardcoded to 60 days — *"a CSCS card
 * needs chasing months out and a toolbox talk does not"* was the column's
 * own justification and could not be stated. Requirements are editable
 * after creation, and `evidenceNote` / `description` are reachable.
 * Assignment offers all four scopes — role, group, site and person — so
 * the composable union the model was built for actually composes.
 * Archive asks first (TR-A14), and the route is permission-guarded rather
 * than relying on the tab being hidden.
 */
import { FileWarning, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { TRAINING_ASSIGNMENT_SCOPES, TRAINING_OBLIGATIONS } from '@forma360/shared/training';
import { ModuleHeader } from '../../../../src/components/module-header';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../src/components/ui/dialog';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';
import { useServerErrorMessage } from '../../../../src/lib/use-server-error';

type Scope = (typeof TRAINING_ASSIGNMENT_SCOPES)[number];

interface Draft {
  id?: string;
  name: string;
  category: string;
  obligation: (typeof TRAINING_OBLIGATIONS)[number];
  validityMonths: string;
  renewalLeadDays: string;
  evidenceNote: string;
  description: string;
}

const EMPTY: Draft = {
  name: '',
  category: '',
  obligation: 'mandatory',
  validityMonths: '',
  renewalLeadDays: '60',
  evidenceNote: '',
  description: '',
};

export default function TrainingRequirementsPage() {
  const t = useTranslations('training');
  const tErr = useTranslations('training.errors');
  const tCommon = useTranslations('common');
  const resolveServerError = useServerErrorMessage();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const utils = trpc.useUtils();
  const canManage = useHasPermission('training.manage');

  const [draft, setDraft] = useState<Draft | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('role');
  const [roleName, setRoleName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [userId, setUserId] = useState('');
  const [archiving, setArchiving] = useState<{ id: string; name: string } | null>(null);

  const requirementsQuery = trpc.training.listRequirements.useQuery({});
  const { data: assignments } = trpc.training.listAssignments.useQuery({});
  const { data: groups } = trpc.groups.list.useQuery();
  const { data: sites } = trpc.sites.list.useQuery();
  const { data: usersData } = trpc.users.list.useQuery({ limit: 200 });

  const onErr = (err: { message: string }) => toast.error(resolveServerError(err, tErr('generic')));
  const refresh = () => {
    void utils.training.invalidate();
  };

  const createRequirement = trpc.training.createRequirement.useMutation({
    onSuccess: () => {
      refresh();
      setDraft(null);
    },
    onError: onErr,
  });
  const updateRequirement = trpc.training.updateRequirement.useMutation({
    onSuccess: () => {
      refresh();
      setDraft(null);
    },
    onError: onErr,
  });
  const addAssignment = trpc.training.addAssignment.useMutation({
    onSuccess: () => {
      refresh();
      setAssignFor(null);
      setRoleName('');
      setGroupId('');
      setSiteId('');
      setUserId('');
    },
    onError: onErr,
  });
  const removeAssignment = trpc.training.removeAssignment.useMutation({
    onSuccess: refresh,
    onError: onErr,
  });
  const archive = trpc.training.archiveRequirement.useMutation({
    onSuccess: () => {
      refresh();
      setArchiving(null);
    },
    onError: onErr,
  });

  // The server is the source of truth; this is the UX half (ground rule 6).
  if (!canManage) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            {tErr('noPermission')}
          </CardContent>
        </Card>
      </div>
    );
  }

  function assignmentLabel(a: {
    scope: string;
    roleName: string | null;
    groupId: string | null;
    siteId: string | null;
    userId: string | null;
  }): string {
    if (a.scope === 'group') {
      return (groups ?? []).find((g) => g.id === a.groupId)?.name ?? a.groupId ?? '';
    }
    if (a.scope === 'site') {
      return (sites ?? []).find((s) => s.id === a.siteId)?.name ?? a.siteId ?? '';
    }
    if (a.scope === 'person') {
      return (usersData?.users ?? []).find((u) => u.id === a.userId)?.name ?? a.userId ?? '';
    }
    return a.roleName ?? '';
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <ModuleHeader title={t('requirements.title')}>
        <Button onClick={() => setDraft({ ...EMPTY })}>
          <Plus className="mr-1 h-4 w-4" />
          {t('requirements.add')}
        </Button>
      </ModuleHeader>

      {requirementsQuery.isPending ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </CardContent>
        </Card>
      ) : requirementsQuery.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <FileWarning className="h-6 w-6 text-destructive" aria-hidden="true" />
            {/* UXW2-10: a permission refusal must explain itself, not pose as
             * a transient failure with a retry that can never succeed. */}
            {(requirementsQuery.error as { data?: { code?: string } } | null)?.data?.code ===
            'FORBIDDEN' ? (
              <>
                <p className="font-medium">{tErr('noAccess')}</p>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/${locale}/training/me`}>{tErr('goToMine')}</Link>
                </Button>
              </>
            ) : (
              <>
                <p className="font-medium">{tErr('loadFailed')}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void requirementsQuery.refetch()}
                >
                  {tErr('retry')}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (requirementsQuery.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            {t('requirements.empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(requirementsQuery.data ?? []).map((r) => {
            const mine = (assignments ?? []).filter((a) => a.requirementId === r.id);
            return (
              <Card key={r.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t(`obligation.${r.obligation}` as never)}
                        {' · '}
                        {r.validityMonths === null
                          ? t('requirements.noExpiry')
                          : t('requirements.validityMonths', { months: r.validityMonths })}
                        {' · '}
                        {t('requirements.leadDays', { days: r.renewalLeadDays })}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setDraft({
                            id: r.id,
                            name: r.name,
                            category: r.category ?? '',
                            obligation: r.obligation,
                            validityMonths:
                              r.validityMonths === null ? '' : String(r.validityMonths),
                            renewalLeadDays: String(r.renewalLeadDays),
                            evidenceNote: r.evidenceNote ?? '',
                            description: r.description ?? '',
                          })
                        }
                      >
                        {t('requirements.edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setArchiving({ id: r.id, name: r.name })}
                      >
                        {t('requirements.archive')}
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t('requirements.assignments')}:
                    </span>
                    {mine.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      mine.map((a) => (
                        <span
                          key={a.id}
                          className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs"
                        >
                          {t(`requirements.scope.${a.scope}` as never)}: {assignmentLabel(a)}
                          <button
                            type="button"
                            onClick={() => removeAssignment.mutate({ id: a.id })}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={tCommon('delete')}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </span>
                      ))
                    )}
                    <Button size="sm" variant="outline" onClick={() => setAssignFor(r.id)}>
                      {t('requirements.addAssignment')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Create / edit ─────────────────────────────────────────────── */}
      <Dialog
        open={draft !== null}
        onOpenChange={(v) => {
          if (!v) setDraft(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {draft?.id === undefined ? t('requirements.add') : t('requirements.edit')}
            </DialogTitle>
          </DialogHeader>
          {draft !== null ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="req-name">{t('requirements.name')}</Label>
                <Input
                  id="req-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="req-category">{t('requirements.category')}</Label>
                <Input
                  id="req-category"
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="req-obligation">{t('requirements.obligation')}</Label>
                  <select
                    id="req-obligation"
                    value={draft.obligation}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        obligation: e.target.value as (typeof TRAINING_OBLIGATIONS)[number],
                      })
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {TRAINING_OBLIGATIONS.map((o) => (
                      <option key={o} value={o}>
                        {t(`obligation.${o}` as never)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="req-validity">{t('requirements.validity')}</Label>
                  <Input
                    id="req-validity"
                    type="number"
                    min={1}
                    value={draft.validityMonths}
                    onChange={(e) => setDraft({ ...draft, validityMonths: e.target.value })}
                    placeholder={t('requirements.noExpiry')}
                  />
                </div>
              </div>
              {/* The chase window, per requirement — the column's own reason
                  to exist, and previously unreachable. */}
              <div className="space-y-1">
                <Label htmlFor="req-lead">{t('requirements.leadLabel')}</Label>
                <Input
                  id="req-lead"
                  type="number"
                  min={0}
                  max={365}
                  value={draft.renewalLeadDays}
                  onChange={(e) => setDraft({ ...draft, renewalLeadDays: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="req-evidence">{t('requirements.evidenceNote')}</Label>
                <Input
                  id="req-evidence"
                  value={draft.evidenceNote}
                  onChange={(e) => setDraft({ ...draft, evidenceNote: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="req-description">{t('requirements.description')}</Label>
                <Input
                  id="req-description"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('requirements.cancel')}
            </Button>
            <Button
              disabled={
                draft === null ||
                draft.name.trim() === '' ||
                createRequirement.isPending ||
                updateRequirement.isPending
              }
              onClick={() => {
                if (draft === null) return;
                const payload = {
                  name: draft.name.trim(),
                  category: draft.category.trim() === '' ? null : draft.category.trim(),
                  obligation: draft.obligation,
                  validityMonths: draft.validityMonths === '' ? null : Number(draft.validityMonths),
                  renewalLeadDays:
                    draft.renewalLeadDays === '' ? 60 : Number(draft.renewalLeadDays),
                  evidenceNote: draft.evidenceNote.trim() === '' ? null : draft.evidenceNote.trim(),
                  description: draft.description.trim() === '' ? null : draft.description.trim(),
                };
                if (draft.id === undefined) createRequirement.mutate(payload);
                else updateRequirement.mutate({ id: draft.id, ...payload });
              }}
            >
              {t('requirements.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Assign: all four scopes ───────────────────────────────────── */}
      <Dialog
        open={assignFor !== null}
        onOpenChange={(v) => {
          if (!v) setAssignFor(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('requirements.assignments')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="assign-scope">{t('requirements.scopeLabel')}</Label>
              <select
                id="assign-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as Scope)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {TRAINING_ASSIGNMENT_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {t(`requirements.scope.${s}` as never)}
                  </option>
                ))}
              </select>
            </div>

            {scope === 'role' ? (
              <div className="space-y-1">
                <Label htmlFor="assign-role">{t('requirements.scope.role')}</Label>
                <Input
                  id="assign-role"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                />
              </div>
            ) : null}

            {scope === 'group' ? (
              <div className="space-y-1">
                <Label htmlFor="assign-group">{t('requirements.scope.group')}</Label>
                <select
                  id="assign-group"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">—</option>
                  {(groups ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {scope === 'site' ? (
              <div className="space-y-1">
                <Label htmlFor="assign-site">{t('requirements.scope.site')}</Label>
                <SiteSelector
                  value={siteId !== '' ? [siteId] : []}
                  onChange={(next) => setSiteId(next[0] ?? '')}
                  multiple={false}
                  placeholder="—"
                />
              </div>
            ) : null}

            {scope === 'person' ? (
              <div className="space-y-1">
                <Label htmlFor="assign-person">{t('requirements.scope.person')}</Label>
                <select
                  id="assign-person"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">—</option>
                  {(usersData?.users ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssignFor(null)}>
              {t('requirements.cancel')}
            </Button>
            <Button
              disabled={
                addAssignment.isPending ||
                (scope === 'role' && roleName.trim() === '') ||
                (scope === 'group' && groupId === '') ||
                (scope === 'site' && siteId === '') ||
                (scope === 'person' && userId === '')
              }
              onClick={() => {
                if (assignFor === null) return;
                addAssignment.mutate({
                  requirementId: assignFor,
                  scope,
                  roleName: scope === 'role' ? roleName.trim() : null,
                  groupId: scope === 'group' ? groupId : null,
                  siteId: scope === 'site' ? siteId : null,
                  userId: scope === 'person' ? userId : null,
                });
              }}
            >
              {t('requirements.addAssignment')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Archive asks first (TR-A14) ───────────────────────────────── */}
      <Dialog
        open={archiving !== null}
        onOpenChange={(v) => {
          if (!v) setArchiving(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('requirements.archiveTitle')}</DialogTitle>
            <DialogDescription>
              {t('requirements.archiveBody', { name: archiving?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiving(null)}>
              {t('requirements.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={archive.isPending}
              onClick={() => {
                if (archiving !== null) archive.mutate({ id: archiving.id });
              }}
            >
              {t('requirements.archive')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
