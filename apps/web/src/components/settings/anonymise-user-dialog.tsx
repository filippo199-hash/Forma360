'use client';

/**
 * AnonymiseUserDialog — the S-E09 destructive confirmation flow.
 *
 * Mirrors {@link ArchiveDialog}: on open it queries
 * `admin.previewDependents` for the target user and lists the affected
 * modules + counts so the operator sees the cascade before committing.
 *
 * Anonymising is irreversible, so on top of the preview this dialog adds:
 *   - a destructive warning callout, and
 *   - a type-the-email gate — the operator must retype the user's current
 *     email (case-insensitive) before the confirm button unlocks.
 *
 * The parent owns the mutation itself; `onConfirm` fires when the operator
 * clicks the destructive button and the email matches.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Skeleton } from '../ui/skeleton';
import { trpc } from '../../lib/trpc/client';

export interface AnonymiseUserDialogProps {
  userId: string;
  userName: string;
  userEmail: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  /** Busy state while the parent's anonymise mutation is in flight. */
  pending?: boolean;
}

export function AnonymiseUserDialog({
  userId,
  userName,
  userEmail,
  open,
  onOpenChange,
  onConfirm,
  pending = false,
}: AnonymiseUserDialogProps) {
  const t = useTranslations('settings.users.anonymise');
  const tArchive = useTranslations('common.archiveDialog');
  const tModules = useTranslations('common.archiveDialog.modules');

  const query = trpc.admin.previewDependents.useQuery(
    { entity: 'user', id: userId },
    { enabled: open && userId !== '' },
  );

  const deps = query.data ?? [];
  const hasDeps = deps.some((d) => d.count > 0);

  const [typed, setTyped] = useState('');
  // Reset the gate each time the dialog opens so a stale value from a prior
  // target never pre-satisfies the confirmation.
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const matches = typed.trim().toLowerCase() === userEmail.trim().toLowerCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle', { name: userName })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="space-y-3">
            <p className="text-muted-foreground">{tArchive('impactHeading')}</p>
            {query.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : !hasDeps ? (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-muted-foreground">
                {tArchive('noDependents')}
              </p>
            ) : (
              <ul className="space-y-1 rounded-md border bg-muted/20 p-3">
                {deps
                  .filter((d) => d.count > 0)
                  .map((d) => (
                    <li key={d.module} className="flex items-center justify-between">
                      <span>{tModules(d.module as never)}</span>
                      <span className="font-mono text-xs text-muted-foreground">{d.count}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
            {t('warning')}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="anon-confirm">{t('confirmLabel')}</Label>
            <p className="font-mono text-xs text-muted-foreground">{userEmail}</p>
            <Input
              id="anon-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              disabled={pending}
            />
            {typed.trim() !== '' && !matches ? (
              <p className="text-xs text-destructive">{t('confirmMismatch')}</p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {tArchive('cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={!matches || pending}
          >
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
