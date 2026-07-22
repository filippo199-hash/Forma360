'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { cn } from '../../lib/cn';

type Kind = 'site' | 'project';
type Status = 'planning' | 'active' | 'on_hold' | 'completed';

interface SiteHeaderActionsProps {
  site: {
    id: string;
    name: string;
    kind: string;
    status: string | null;
    client: string | null;
    startDate: string | null;
    endDate: string | null;
  };
  counts: {
    observations: number;
    inspections: number;
    actions: number;
    assets: number;
    documents: number;
    media: number;
    plans: number;
    members: number;
  };
}

export function SiteHeaderActions({ site, counts }: SiteHeaderActionsProps) {
  const t = useTranslations('sites');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('sites.manage');
  const utils = trpc.useUtils();

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveMode, setArchiveMode] = useState<'dissociate' | 'delete'>('dissociate');

  const [name, setName] = useState(site.name);
  const [kind, setKind] = useState<Kind>(site.kind === 'project' ? 'project' : 'site');
  const [status, setStatus] = useState<Status>(
    site.status === 'planning' ||
      site.status === 'active' ||
      site.status === 'on_hold' ||
      site.status === 'completed'
      ? site.status
      : 'active',
  );
  const [client, setClient] = useState(site.client ?? '');
  const [startDate, setStartDate] = useState(site.startDate ?? '');
  const [endDate, setEndDate] = useState(site.endDate ?? '');

  const update = trpc.sites.update.useMutation({
    onSuccess: () => {
      void utils.sites.getHub.invalidate({ id: site.id });
      void utils.sites.hub.invalidate();
      toast.success(t('editSavedToast'));
      setEditOpen(false);
    },
    onError: () => toast.error(tCommon('error')),
  });

  const archive = trpc.sites.archiveWithMode.useMutation({
    onSuccess: () => {
      void utils.sites.hub.invalidate();
      toast.success(t('archivedToast'));
      router.push(`/${locale}/sites`);
    },
    onError: () => toast.error(tCommon('error')),
  });

  function save() {
    if (name.trim().length === 0) return;
    update.mutate({
      id: site.id,
      name: name.trim(),
      kind,
      ...(kind === 'project'
        ? {
            status,
            client: client.trim() === '' ? null : client.trim(),
            startDate: startDate === '' ? null : startDate,
            endDate: endDate === '' ? null : endDate,
          }
        : { status: null, client: null, startDate: null, endDate: null }),
    });
  }

  if (!canManage) return null;

  const depRows: Array<{ key: string; label: string; value: number }> = [
    { key: 'observations', label: t('countObservations'), value: counts.observations },
    { key: 'inspections', label: t('countInspections'), value: counts.inspections },
    { key: 'actions', label: t('countActions'), value: counts.actions },
    { key: 'assets', label: t('countAssets'), value: counts.assets },
    { key: 'documents', label: t('countDocuments'), value: counts.documents },
    { key: 'media', label: t('countMedia'), value: counts.media },
    { key: 'plans', label: t('countPlans'), value: counts.plans },
    { key: 'members', label: t('countMembers'), value: counts.members },
  ].filter((r) => r.value > 0);

  return (
    <div className="ml-auto flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
        <Pencil className="mr-1.5 h-3.5 w-3.5" />
        {t('editButton')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setArchiveOpen(true)}
      >
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
        {t('archiveButton')}
      </Button>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('editTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-left">
            <div className="grid grid-cols-2 gap-2">
              {(['project', 'site'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                    kind === k
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-input text-muted-foreground hover:text-foreground',
                  )}
                >
                  {k === 'project' ? t('kindProject') : t('kindSite')}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-name">{t('fieldName')}</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
            </div>

            {kind === 'project' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-client">{t('fieldClient')}</Label>
                  <Input
                    id="edit-client"
                    value={client}
                    onChange={(e) => setClient(e.target.value)}
                    maxLength={200}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-start">{t('fieldStart')}</Label>
                    <Input
                      id="edit-start"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-end">{t('fieldEnd')}</Label>
                    <Input
                      id="edit-end"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-status">{t('fieldStatus')}</Label>
                  <select
                    id="edit-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Status)}
                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="planning">{t('status_planning')}</option>
                    <option value="active">{t('status_active')}</option>
                    <option value="on_hold">{t('status_on_hold')}</option>
                    <option value="completed">{t('status_completed')}</option>
                  </select>
                </div>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={save} disabled={update.isPending || name.trim().length === 0}>
              {t('editSaveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive dialog */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('archiveTitle', { name: site.name })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-left text-sm">
            <p className="text-muted-foreground">{t('archiveIntro')}</p>
            {depRows.length > 0 ? (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <p className="font-medium">{t('archiveDepsTitle')}</p>
                <ul className="space-y-0.5">
                  {depRows.map((r) => (
                    <li key={r.key} className="flex justify-between">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className="font-medium">{r.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {depRows.length > 0 ? (
              <div className="space-y-2">
                <p className="font-medium">{t('archiveModeQuestion')}</p>
                {(['dissociate', 'delete'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setArchiveMode(m)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md border p-3 text-left transition-colors',
                      archiveMode === m
                        ? m === 'delete'
                          ? 'border-destructive bg-destructive/5'
                          : 'border-primary bg-primary/5'
                        : 'border-input hover:bg-muted/40',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                        archiveMode === m
                          ? m === 'delete'
                            ? 'border-destructive'
                            : 'border-primary'
                          : 'border-muted-foreground',
                      )}
                    >
                      {archiveMode === m ? (
                        <span
                          className={cn(
                            'h-2 w-2 rounded-full',
                            m === 'delete' ? 'bg-destructive' : 'bg-primary',
                          )}
                        />
                      ) : null}
                    </span>
                    <span>
                      <span className="block font-medium">
                        {m === 'dissociate' ? t('archiveModeDissociate') : t('archiveModeDelete')}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {m === 'dissociate'
                          ? t('archiveModeDissociateHelp')
                          : t('archiveModeDeleteHelp')}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">{t('archiveNoDeps')}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiveOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => archive.mutate({ id: site.id, mode: archiveMode })}
              disabled={archive.isPending}
            >
              {archiveMode === 'delete' ? t('archiveConfirmDelete') : t('archiveConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
