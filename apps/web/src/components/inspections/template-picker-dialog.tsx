'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
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
  const router = useRouter();
  const { data: templates, isLoading } = trpc.templates.list.useQuery(
    { status: 'published' },
    { enabled: open },
  );
  const [selected, setSelected] = useState<string>('');

  const published = useMemo(
    () => (templates ?? []).filter((r) => r.currentVersionId !== null && r.archivedAt === null),
    [templates],
  );

  const create = trpc.inspections.create.useMutation({
    onSuccess: (res) => {
      onOpenChange(false);
      router.push(`/${locale}/inspections/${res.inspectionId}`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : t('createError')),
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
            <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="space-y-1">
              {published.map((tpl) => {
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
