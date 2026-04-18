'use client';

/**
 * Reusable ArchiveDialog — Phase 2 PR 33.
 *
 * Shows a confirmation dialog for a destructive admin action (archive a
 * template, a group, a site, ...). On open, queries
 * `admin.previewDependents` for the target entity and renders a bullet
 * list of affected modules + counts so the operator can see the cascade
 * before committing.
 *
 * The parent component owns the mutation itself — this component only
 * handles the preview + confirm flow. `onConfirm` fires when the operator
 * clicks the primary button; the parent is expected to run its archive
 * mutation and close the dialog.
 */
import { useTranslations } from 'next-intl';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Skeleton } from './ui/skeleton';
import { trpc } from '../lib/trpc/client';

export type ArchiveDialogEntity =
  | 'tenant'
  | 'group'
  | 'site'
  | 'user'
  | 'permissionSet'
  | 'customUserField'
  | 'accessRule'
  | 'template'
  | 'inspection'
  | 'action';

export interface ArchiveDialogProps {
  entity: ArchiveDialogEntity;
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
  /** Busy state while the parent's archive mutation is in flight. */
  pending?: boolean;
}

export function ArchiveDialog({
  entity,
  id,
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  pending = false,
}: ArchiveDialogProps) {
  const t = useTranslations('common.archiveDialog');
  const tModules = useTranslations('common.archiveDialog.modules');

  const query = trpc.admin.previewDependents.useQuery(
    { entity, id },
    { enabled: open && id.length > 0 },
  );

  const deps = query.data ?? [];
  const hasDeps = deps.some((d) => d.count > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title ?? t('defaultTitle')}</DialogTitle>
          <DialogDescription>{description ?? t('defaultDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">{t('impactHeading')}</p>
          {query.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : !hasDeps ? (
            <p className="rounded-md bg-muted/40 px-3 py-2 text-muted-foreground">
              {t('noDependents')}
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

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t('cancel')}
          </Button>
          <Button type="button" onClick={onConfirm} disabled={pending || query.isLoading}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
