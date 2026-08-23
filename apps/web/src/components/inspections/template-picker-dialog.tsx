'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { useServerErrorToast } from '../../lib/use-server-error';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Skeleton } from '../ui/skeleton';

/**
 * "Start inspection" template picker. Shared between the Inspections list
 * page and the site/project overview — pass `siteId` to pin the new
 * inspection to that place at creation (the create input already accepts
 * it server-side).
 */
export function TemplatePickerDialog({
  open,
  onOpenChange,
  locale,
  siteId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locale: string;
  siteId?: string;
}) {
  const t = useTranslations('inspections.picker');
  const tAccess = useTranslations('inspections.templatePicker');
  const onServerError = useServerErrorToast(t('createError'));
  const router = useRouter();
  const canManageTemplates = useHasPermission('templates.manage');
  const { data: templates, isLoading } = trpc.templates.list.useQuery(
    { status: 'published' },
    { enabled: open },
  );
  const [selected, setSelected] = useState<string>('');

  const published = useMemo(
    () => (templates ?? []).filter((r) => r.currentVersionId !== null && r.archivedAt === null),
    [templates],
  );

  // Only offer templates the caller can actually start (finding #3). `canStart`
  // is computed server-side to mirror the inspections.create gate, so anything
  // filtered out here would otherwise error with "You do not satisfy this
  // template's access rule" on Start.
  const startable = useMemo(() => published.filter((r) => r.canStart), [published]);

  const create = trpc.inspections.create.useMutation({
    onSuccess: (res) => {
      onOpenChange(false);
      router.push(`/${locale}/inspections/${res.inspectionId}`);
    },
    onError: onServerError,
  });

  function onSubmit() {
    if (selected.length !== 26) return;
    create.mutate({ templateId: selected, ...(siteId !== undefined ? { siteId } : {}) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[40vh] overflow-y-auto">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : published.length === 0 ? (
            // A dead end with no route out is what UXW1-16 flagged: offer
            // the template path to those who can build one; tell everyone
            // else who to ask.
            <div className="space-y-2 py-6 text-center text-sm text-muted-foreground">
              <p>{t('empty')}</p>
              {canManageTemplates ? (
                <Link
                  href={`/${locale}/templates`}
                  className="inline-block font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t('emptyCta')}
                </Link>
              ) : (
                <p>{t('emptyAskAdmin')}</p>
              )}
            </div>
          ) : startable.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {tAccess('emptyNoAccess')}
            </p>
          ) : (
            <ul className="space-y-1">
              {startable.map((tpl) => {
                const checked = selected === tpl.id;
                return (
                  <li key={tpl.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm">
                      <input
                        type="radio"
                        name="template"
                        checked={checked}
                        onChange={() => setSelected(tpl.id)}
                        className="h-4 w-4"
                      />
                      <span className="flex-1">
                        <span className="font-medium">{tpl.name}</span>
                        {tpl.description !== null ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {tpl.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={selected.length !== 26 || create.isPending}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
