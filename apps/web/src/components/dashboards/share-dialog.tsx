'use client';

/**
 * Visibility + sharing (ADR 0018): private / selected users / everyone.
 * Publishing status is separate — a shared draft stays invisible until
 * published (DH-E13).
 */
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

type Visibility = 'private' | 'selected' | 'tenant';

export function ShareDialog({
  open,
  onOpenChange,
  dashboardId,
  visibility,
  shares,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboardId: string;
  visibility: Visibility;
  shares: ReadonlyArray<{ userId: string; name: string | null }>;
  onSaved: () => Promise<unknown>;
}) {
  const t = useTranslations('dashboards');
  const [choice, setChoice] = useState<Visibility>(visibility);
  const [userIds, setUserIds] = useState<readonly string[]>(shares.map((s) => s.userId));
  useEffect(() => {
    setChoice(visibility);
    setUserIds(shares.map((s) => s.userId));
  }, [visibility, shares, open]);

  const users = trpc.users.list.useQuery({ limit: 200 }, { enabled: open && choice === 'selected' });
  const setVisibility = trpc.dashboards.setVisibility.useMutation();

  const save = async () => {
    try {
      await setVisibility.mutateAsync({
        id: dashboardId,
        visibility: choice,
        ...(choice === 'selected' ? { userIds: [...userIds] } : {}),
      });
      await onSaved();
      toast.success(t('share.saved'));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('share.failed'));
    }
  };

  const userRows = users.data?.users ?? [];

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
            <div className="max-h-56 overflow-y-auto rounded-md border p-2">
              {users.isLoading ? (
                <p className="p-2 text-sm text-muted-foreground">{t('share.loadingUsers')}</p>
              ) : userRows.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">{t('share.noUsers')}</p>
              ) : (
                userRows.map((row) => {
                  const checked = userIds.includes(row.id);
                  return (
                    <label
                      key={row.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          setUserIds((prev) =>
                            next === true
                              ? [...prev, row.id]
                              : prev.filter((id) => id !== row.id),
                          )
                        }
                      />
                      <span className="truncate">{row.name}</span>
                    </label>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('share.cancel')}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={setVisibility.isPending || (choice === 'selected' && userIds.length === 0)}
          >
            {t('share.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
