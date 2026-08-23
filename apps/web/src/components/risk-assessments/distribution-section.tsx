'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { formatDate } from '../../lib/format-date';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useServerErrorToast } from '../../../src/lib/use-server-error';

export interface AckEntry {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  distributedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedVersion: number | null;
  versionNumber: number;
  dueAt: Date | null;
}

/** An entry is pending when never acknowledged or acknowledged an older version. */
function isPending(a: AckEntry): boolean {
  return a.acknowledgedAt === null || (a.acknowledgedVersion ?? 0) < a.versionNumber;
}

/**
 * Distribution & acknowledgement — the record that the people doing the
 * work have actually read the assessment. Version-aware (feedback A-1):
 * an acknowledgement of an older version shows as "re-acknowledgement
 * pending", never silently green. Card-less: the detail page hosts it
 * inside the tabbed Review / Distribution card.
 */
export function DistributionSection({
  assessmentId,
  isActive,
  acknowledgements,
  canManage,
  onChanged,
  onShareHeadsUp,
  sharing = false,
}: {
  assessmentId: string;
  isActive: boolean;
  acknowledgements: AckEntry[];
  canManage: boolean;
  /** Jumps to a pre-filled Heads Up compose (active assessments only — T-4). */
  onShareHeadsUp?: () => void;
  sharing?: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('riskAssessments');
  const onServerErrorG0 = useServerErrorToast(t('saveError'));
  const locale = useLocale();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState('');

  const usersQuery = trpc.users.list.useQuery({ limit: 200 }, { enabled: dialogOpen });
  const distribute = trpc.riskAssessments.distribute.useMutation({
    onSuccess: () => {
      setDialogOpen(false);
      setSelected(new Set());
      toast.success(t('distribution.sentToast'));
      onChanged();
    },
    onError: onServerErrorG0,
  });

  function toggle(userId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  const now = Date.now();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('distribution.hint')}</p>
        {canManage && isActive ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
            {t('distribution.distributeButton')}
          </Button>
        ) : null}
      </div>
      <div className="space-y-2">
        {!isActive ? (
          <p className="text-sm text-muted-foreground">{t('distribution.needsActive')}</p>
        ) : acknowledgements.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('distribution.empty')}</p>
        ) : (
          <ul className="divide-y">
            {acknowledgements.map((a) => {
              const pending = isPending(a);
              const reack = pending && a.acknowledgedAt !== null;
              const overdue = pending && a.dueAt !== null && new Date(a.dueAt).getTime() < now;
              return (
                <li key={a.userId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {a.userName ?? a.userEmail ?? a.userId}
                  </span>
                  {a.dueAt !== null && pending ? (
                    <span className="text-xs text-muted-foreground">
                      {t('distribution.dueBy', {
                        date: formatDate(a.dueAt, locale),
                      })}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {formatDate(a.distributedAt, locale)}
                    </span>
                  )}
                  {!pending ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                      {t('distribution.acknowledgedVersion', { version: a.versionNumber })}
                    </span>
                  ) : overdue ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
                      {t('distribution.overdue')}
                    </span>
                  ) : reack ? (
                    <span
                      className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                      title={t('distribution.reackTitle', {
                        version: a.acknowledgedVersion ?? 1,
                      })}
                    >
                      {t('distribution.reackPending')}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      {t('distribution.pending')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {canManage && onShareHeadsUp !== undefined ? (
          <div className="flex flex-col items-end gap-1 pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={sharing || !isActive}
              onClick={onShareHeadsUp}
            >
              {sharing ? t('distribution.sharingHeadsUp') : t('distribution.shareHeadsUp')}
            </Button>
            {!isActive ? (
              <p className="text-xs text-muted-foreground">{t('distribution.shareNeedsPublish')}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('distribution.shareRecordsAcks')}</p>
            )}
          </div>
        ) : null}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('distribution.dialogTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('distribution.selectHint')}</p>
          <label className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-sm font-medium hover:bg-accent">
            <Checkbox
              checked={
                (usersQuery.data?.users.length ?? 0) > 0 &&
                selected.size === (usersQuery.data?.users.length ?? 0)
              }
              onCheckedChange={() => {
                const all = usersQuery.data?.users ?? [];
                setSelected((prev) =>
                  prev.size === all.length ? new Set() : new Set(all.map((u) => u.id)),
                );
              }}
            />
            {t('distribution.selectAll')}
          </label>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {(usersQuery.data?.users ?? []).map((u) => (
              <label
                key={u.id}
                className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-sm hover:bg-accent"
              >
                <Checkbox checked={selected.has(u.id)} onCheckedChange={() => toggle(u.id)} />
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                {/* A `.invalid` address is a try-it-now placeholder that
                    can never receive mail (ADR 0017). The dispatcher
                    already refuses to send to one — but the dialog said
                    "recipients are emailed now and chased automatically
                    until they confirm" while showing the raw
                    `…@sandbox.invalid` string, so the visitor had no way
                    to know nothing would ever arrive. */}
                <span className="truncate text-xs text-muted-foreground">
                  {u.email.trim().toLowerCase().endsWith('.invalid')
                    ? t('distribution.noEmailYet')
                    : u.email}
                </span>
              </label>
            ))}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('distribution.dueDateLabel')}</Label>
            <Input
              type="date"
              className="w-48"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('distribution.dueDateHint')}</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={selected.size === 0 || distribute.isPending}
              onClick={() =>
                distribute.mutate({
                  assessmentId,
                  userIds: [...selected],
                  dueAt: dueDate === '' ? null : new Date(`${dueDate}T23:59:59.000Z`),
                })
              }
            >
              {distribute.isPending ? t('distribution.sending') : t('distribution.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
