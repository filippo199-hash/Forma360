'use client';

/**
 * Visibility + sharing (ADR 0018): private / selected people & groups /
 * everyone. Publishing status is separate — a shared draft stays
 * invisible until published (DH-E13).
 *
 * "Selected" picks through GroupUserSelector (server-side user search —
 * the TR-A2 lesson: a capped checkbox list silently hides everyone past
 * the cap). Group grants resolve through live group membership at read
 * time, so sharing with "Night shift" keeps working as the shift roster
 * changes.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { GroupUserSelector } from '../selectors/group-user-selector';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

type Visibility = 'private' | 'selected' | 'tenant';

export function ShareDialog({
  open,
  onOpenChange,
  dashboardId,
  visibility,
  shares,
  shareGroups,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboardId: string;
  visibility: Visibility;
  shares: ReadonlyArray<{ userId: string; name: string | null }>;
  shareGroups: ReadonlyArray<{ groupId: string; name: string | null }>;
  onSaved: () => Promise<unknown>;
}) {
  const t = useTranslations('dashboards');
  const [choice, setChoice] = useState<Visibility>(visibility);
  const [userIds, setUserIds] = useState<string[]>(shares.map((s) => s.userId));
  const [groupIds, setGroupIds] = useState<string[]>(shareGroups.map((s) => s.groupId));
  useEffect(() => {
    setChoice(visibility);
    setUserIds(shares.map((s) => s.userId));
    setGroupIds(shareGroups.map((s) => s.groupId));
  }, [visibility, shares, shareGroups, open]);

  const setVisibility = trpc.dashboards.setVisibility.useMutation();

  const save = async () => {
    try {
      await setVisibility.mutateAsync({
        id: dashboardId,
        visibility: choice,
        ...(choice === 'selected' ? { userIds, groupIds } : {}),
      });
      await onSaved();
      toast.success(t('share.saved'));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('share.failed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('share.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {(['private', 'selected', 'tenant'] as const).map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm hover:bg-muted/40"
            >
              <input
                type="radio"
                name="visibility"
                checked={choice === option}
                onChange={() => setChoice(option)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{t(`visibility.${option}`)}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(`share.${option}Hint`)}
                </span>
              </span>
            </label>
          ))}

          {choice === 'selected' ? (
            <div className="space-y-3 rounded-md border p-3">
              <GroupUserSelector
                mode="users"
                value={userIds}
                onChange={setUserIds}
                label={t('share.usersLabel')}
                placeholder={t('share.pickUsers')}
              />
              <GroupUserSelector
                mode="groups"
                value={groupIds}
                onChange={setGroupIds}
                label={t('share.groupsLabel')}
                placeholder={t('share.pickGroups')}
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('share.cancel')}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={
              setVisibility.isPending ||
              (choice === 'selected' && userIds.length === 0 && groupIds.length === 0)
            }
          >
            {t('share.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
