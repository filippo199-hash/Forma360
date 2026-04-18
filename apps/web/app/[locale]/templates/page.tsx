'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { ArchiveDialog } from '../../../src/components/archive-dialog';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../src/components/ui/dialog';
import { Input } from '../../../src/components/ui/input';
import { Label } from '../../../src/components/ui/label';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { Textarea } from '../../../src/components/ui/textarea';
import { trpc } from '../../../src/lib/trpc/client';

/**
 * Templates list. Admin-only (see layout). Shows every non-archived
 * template, surfaces draft/published status, and lets the operator:
 *
 *   - create a new template (modal → redirects into the editor)
 *   - duplicate an existing one
 *   - archive / unarchive
 *   - toggle the archived filter
 *
 * Mutations invalidate the list query so the table stays in sync.
 */
export default function TemplatesListPage() {
  const t = useTranslations('templates');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const utils = trpc.useUtils();

  const [includeArchived, setIncludeArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);

  const { data: rows, isLoading } = trpc.templates.list.useQuery({ includeArchived });

  const duplicate = trpc.templates.duplicate.useMutation({
    onSuccess: () => utils.templates.list.invalidate(),
  });
  const archive = trpc.templates.archive.useMutation({
    onSuccess: () => {
      setArchiveTarget(null);
      void utils.templates.list.invalidate();
    },
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="h-4 w-4"
              aria-label={t('showArchived')}
            />
            <span>{t('showArchived')}</span>
          </label>
          <Button
            variant="outline"
            onClick={() => setShowExport(true)}
            aria-label={t('export.button')}
          >
            {t('export.button')}
          </Button>
          <Button onClick={() => setShowCreate(true)} aria-label={t('newButton')}>
            {t('newButton')}
          </Button>
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">{t('table.name')}</th>
                <th className="px-3 py-2 font-medium">{t('table.status')}</th>
                <th className="px-3 py-2 font-medium">{t('table.updated')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="p-4">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ) : (rows ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground">
                    {t('empty')}
                  </td>
                </tr>
              ) : (
                (rows ?? []).map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <Link
                        href={`/${locale}/templates/${r.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatRelative(r.updatedAt)}
                    </td>
                    <td className="space-x-1 px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => duplicate.mutate({ templateId: r.id })}
                        aria-label={t('duplicateButton')}
                      >
                        {t('duplicateButton')}
                      </Button>
                      {r.archivedAt === null ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setArchiveTarget(r.id)}
                          aria-label={t('archiveButton')}
                        >
                          {t('archiveButton')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <CreateTemplateDialog open={showCreate} onOpenChange={setShowCreate} locale={locale} />
      <ArchiveDialog
        entity="template"
        id={archiveTarget ?? ''}
        open={archiveTarget !== null}
        onOpenChange={(v) => {
          if (!v) setArchiveTarget(null);
        }}
        onConfirm={() => {
          if (archiveTarget !== null) archive.mutate({ templateId: archiveTarget });
        }}
        pending={archive.isPending}
      />
      <TemplatesExportDialog open={showExport} onOpenChange={setShowExport} />
    </div>
  );
}

function TemplatesExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useTranslations('templates.export');
  const [running, setRunning] = useState(false);
  const utils = trpc.useUtils();

  async function downloadNow() {
    setRunning(true);
    try {
      const result = await utils.templates.exportAllCsv.fetch();
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `templates-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onOpenChange(false);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={downloadNow} disabled={running}>
            {t('downloadNow')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('templates.status');
  const normalised: 'draft' | 'published' | 'archived' =
    status === 'published' || status === 'archived' ? status : 'draft';
  const colors: Record<typeof normalised, string> = {
    draft: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
    published: 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100',
    archived: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${colors[normalised]}`}>
      {t(normalised)}
    </span>
  );
}

function formatRelative(d: Date): string {
  const ms = Date.now() - new Date(d).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

function CreateTemplateDialog({
  open,
  onOpenChange,
  locale,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locale: string;
}) {
  const t = useTranslations('templates.create');
  const utils = trpc.useUtils();
  const create = trpc.templates.create.useMutation({
    onSuccess: (result) => {
      void utils.templates.list.invalidate();
      onOpenChange(false);
      // Next.js router would be nicer but we're in a client component
      // without access to useRouter here — a hard navigation keeps this
      // simple and reliable.
      window.location.href = `/${locale}/templates/${result.templateId}`;
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            const name = String(data.get('name') ?? '').trim();
            const description = String(data.get('description') ?? '').trim();
            if (name.length === 0) return;
            create.mutate({
              name,
              ...(description.length > 0 ? { description } : {}),
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">{t('nameLabel')}</Label>
            <Input id="tpl-name" name="name" placeholder={t('namePlaceholder')} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-desc">{t('descriptionLabel')}</Label>
            <Textarea id="tpl-desc" name="description" rows={3} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
