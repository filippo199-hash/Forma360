'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

export interface AckEntry {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  distributedAt: Date;
  acknowledgedAt: Date | null;
}

/**
 * Distribution & acknowledgement — the record that the people doing the
 * work have actually read the assessment. Card-less: the detail page
 * hosts it inside the tabbed Review / Distribution card.
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
  onChanged: () => void;
  /** Publishes (when needed) and jumps to a pre-filled Heads Up compose. */
  onShareHeadsUp?: () => void;
  sharing?: boolean;
}) {
  const t = useTranslations('riskAssessments');
  const locale = useLocale();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const usersQuery = trpc.users.list.useQuery({ limit: 200 }, { enabled: dialogOpen });
  const distribute = trpc.riskAssessments.distribute.useMutation({
    onSuccess: () => {
      setDialogOpen(false);
      setSelected(new Set());
      onChanged();
    },
    onError: () => toast.error(t('saveError')),
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
            {acknowledgements.map((a) => (
              <li key={a.userId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {a.userName ?? a.userEmail ?? a.userId}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(a.distributedAt).toLocaleDateString(locale)}
                </span>
                {a.acknowledgedAt !== null ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                    {t('distribution.acknowledged')}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                    {t('distribution.pending')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && onShareHeadsUp !== undefined ? (
          <div className="flex justify-end pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={sharing}
              onClick={onShareHeadsUp}
            >
              {sharing ? t('distribution.sharingHeadsUp') : t('distribution.shareHeadsUp')}
            </Button>
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
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {(usersQuery.data?.users ?? []).map((u) => (
              <label
                key={u.id}
                className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-sm hover:bg-accent"
              >
                <Checkbox checked={selected.has(u.id)} onCheckedChange={() => toggle(u.id)} />
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                <span className="truncate text-xs text-muted-foreground">{u.email}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={selected.size === 0 || distribute.isPending}
              onClick={() => distribute.mutate({ assessmentId, userIds: [...selected] })}
            >
              {distribute.isPending ? t('distribution.sending') : t('distribution.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
