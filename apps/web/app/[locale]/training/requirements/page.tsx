'use client';

/**
 * The requirement catalogue and its assignments (FreeHS B7).
 *
 * This is the screen that makes the matrix maintainable at 800 people:
 * requirements are driven **by role, not typed per person**. Add someone
 * to "Machine operator" and their three requirements — and therefore
 * their gaps — appear on their own. Nair calls this the single feature
 * the module lives or dies by, so assignment is on the same screen as
 * the requirement rather than buried in a settings page.
 */
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useState } from 'react';
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
import { TrainingTabs } from '../../../../src/components/training/training-tabs';
import { trpc } from '../../../../src/lib/trpc/client';
import { TRAINING_OBLIGATIONS } from '@forma360/shared/training';

export default function TrainingRequirementsPage() {
  const t = useTranslations('training');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const utils = trpc.useUtils();

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [obligation, setObligation] = useState<(typeof TRAINING_OBLIGATIONS)[number]>('mandatory');
  const [validityMonths, setValidityMonths] = useState('');
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [roleName, setRoleName] = useState('');

  const { data: requirements, isLoading } = trpc.training.listRequirements.useQuery({});
  const { data: assignments } = trpc.training.listAssignments.useQuery({});

  const createRequirement = trpc.training.createRequirement.useMutation({
    onSuccess: () => {
      void utils.training.listRequirements.invalidate();
      setAddOpen(false);
      setName('');
      setCategory('');
      setValidityMonths('');
    },
    onError: () => toast.error(tCommon('error')),
  });

  const addAssignment = trpc.training.addAssignment.useMutation({
    onSuccess: () => {
      void utils.training.listAssignments.invalidate();
      void utils.training.gaps.invalidate();
      setAssignFor(null);
      setRoleName('');
    },
    onError: () => toast.error(tCommon('error')),
  });

  const removeAssignment = trpc.training.removeAssignment.useMutation({
    onSuccess: () => {
      void utils.training.listAssignments.invalidate();
      void utils.training.gaps.invalidate();
    },
    onError: () => toast.error(tCommon('error')),
  });

  const archive = trpc.training.archiveRequirement.useMutation({
    onSuccess: () => void utils.training.listRequirements.invalidate(),
    onError: () => toast.error(tCommon('error')),
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      <TrainingTabs activeTab="requirements" locale={locale} />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('requirements.title')}</h1>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          {t('requirements.add')}
        </Button>
      </header>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </CardContent>
        </Card>
      ) : (requirements ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            {t('requirements.empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(requirements ?? []).map((r) => {
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => archive.mutate({ id: r.id })}
                      className="text-destructive"
                    >
                      {t('requirements.archive')}
                    </Button>
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
                          {t(`requirements.scope.${a.scope}` as never)}:{' '}
                          {a.roleName ?? a.groupId ?? a.siteId ?? a.userId}
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

      {/* Add requirement */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('requirements.add')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="req-name">{t('requirements.name')}</Label>
              <Input id="req-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="req-category">{t('requirements.category')}</Label>
              <Input
                id="req-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="req-obligation">{t('requirements.obligation')}</Label>
                <select
                  id="req-obligation"
                  value={obligation}
                  onChange={(e) =>
                    setObligation(e.target.value as (typeof TRAINING_OBLIGATIONS)[number])
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
                  value={validityMonths}
                  onChange={(e) => setValidityMonths(e.target.value)}
                  placeholder={t('requirements.noExpiry')}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              {t('requirements.cancel')}
            </Button>
            <Button
              disabled={name.trim() === '' || createRequirement.isPending}
              onClick={() =>
                createRequirement.mutate({
                  name: name.trim(),
                  category: category.trim() === '' ? null : category.trim(),
                  obligation,
                  validityMonths: validityMonths === '' ? null : Number(validityMonths),
                  renewalLeadDays: 60,
                  evidenceNote: null,
                  description: null,
                })
              }
            >
              {t('requirements.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign by role — the scope that makes the matrix maintainable. */}
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
          <div className="space-y-1">
            <Label htmlFor="assign-role">{t('requirements.scope.role')}</Label>
            <Input
              id="assign-role"
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssignFor(null)}>
              {t('requirements.cancel')}
            </Button>
            <Button
              disabled={roleName.trim() === '' || addAssignment.isPending}
              onClick={() => {
                if (assignFor === null) return;
                addAssignment.mutate({
                  requirementId: assignFor,
                  scope: 'role',
                  roleName: roleName.trim(),
                  groupId: null,
                  siteId: null,
                  userId: null,
                });
              }}
            >
              {t('requirements.addAssignment')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
