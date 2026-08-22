'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { PermissionMatrix } from '../../../../src/components/settings/permission-matrix';
import { Button } from '../../../../src/components/ui/button';
import { appConfirm } from '../../../../src/components/ui/app-confirm';
import { TooltipIconButton } from '../../../../src/components/ui/tooltip-icon-button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../src/components/ui/dialog';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../../../../src/components/ui/sheet';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';
import { useServerErrorToast } from '../../../../src/lib/use-server-error';

type PermissionSet = {
  id: string;
  name: string;
  description: string | null;
  permissions: readonly string[];
  isSystem: boolean;
  userCount: number;
};

/**
 * Permission sets — full CRUD. Lists the tenant's sets, creates new custom
 * sets, and edits their permission grid through a slide-over matrix. System
 * sets (Administrator / Manager / Standard) are rendered read-only: the
 * router blocks renaming them, and we refuse to mutate their bundled keys.
 */
export default function PermissionsPage() {
  const t = useTranslations('settings.permissions');
  const onServerError = useServerErrorToast(t('createError'));
  const onServerError0_1 = useServerErrorToast(t('editError'));
  const onServerError0_2 = useServerErrorToast(t('deleteError'));
  const utils = trpc.useUtils();
  const canManage = useHasPermission('permissions.manage');

  const { data, isLoading, error } = trpc.permissions.list.useQuery();
  const sets: PermissionSet[] = data ?? [];

  // Create dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');

  // NR3-03: Cancel/Escape must not keep the typed text for the next open.
  function closeCreate() {
    setCreateName('');
    setCreateDesc('');
    setShowCreate(false);
  }

  // Edit sheet state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [draft, setDraft] = useState<Set<string>>(new Set());

  const editingSet = sets.find((s) => s.id === editingId) ?? null;
  const editReadOnly = editingSet?.isSystem ?? false;

  const createSet = trpc.permissions.create.useMutation({
    onSuccess: () => {
      void utils.permissions.list.invalidate();
      closeCreate();
      toast.success(t('createSuccess'));
    },
    onError: onServerError,
  });

  const updateSet = trpc.permissions.update.useMutation({
    onSuccess: () => {
      void utils.permissions.list.invalidate();
      setEditingId(null);
      toast.success(t('editSuccess'));
    },
    onError: onServerError0_1,
  });

  const deleteSet = trpc.permissions.delete.useMutation({
    onSuccess: () => {
      void utils.permissions.list.invalidate();
      toast.success(t('deleteSuccess'));
    },
    onError: onServerError0_2,
  });

  function openEdit(set: PermissionSet) {
    setEditingId(set.id);
    setEditName(set.name);
    setEditDesc(set.description ?? '');
    setDraft(new Set(set.permissions));
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canManage ? (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('createButton')}
          </Button>
        ) : null}
      </header>

      <Card>
        <CardContent className="p-0">
          {/* ── Desktop table ─────────────────────────────────────────────── */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium">{t('table.name')}</th>
                  <th className="px-4 py-3 font-medium">{t('table.description')}</th>
                  <th className="px-4 py-3 font-medium">{t('table.permissions')}</th>
                  <th className="px-4 py-3 font-medium">{t('table.users')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="p-4">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-destructive">
                      {t('loadError')}
                    </td>
                  </tr>
                ) : sets.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center">
                      <p className="text-muted-foreground">{t('empty')}</p>
                      {canManage ? (
                        <Button className="mt-4" size="sm" onClick={() => setShowCreate(true)}>
                          <Plus className="mr-1.5 h-4 w-4" />
                          {t('createButton')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ) : (
                  sets.map((set) => (
                    <tr key={set.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2 font-medium">
                          {set.name}
                          {set.isSystem ? (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                              {t('systemBadge')}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{set.description ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {t('permissionsCount', { count: set.permissions.length })}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {t('usersBadge', { count: set.userCount })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canManage ? (
                            <TooltipIconButton
                              icon={Pencil}
                              label={t('editButton')}
                              onClick={() => openEdit(set)}
                            />
                          ) : null}
                          {canManage ? (
                            <TooltipIconButton
                              icon={Trash2}
                              label={t('deleteButton')}
                              variant="destructive"
                              disabled={set.isSystem || set.userCount > 0 || deleteSet.isPending}
                              onClick={() => {
                                void appConfirm({
                                  description: t('deleteConfirm'),
                                  destructive: true,
                                }).then((ok) => {
                                  if (ok) deleteSet.mutate({ id: set.id });
                                });
                              }}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* ── Mobile card list ──────────────────────────────────────────── */}
          <div className="md:hidden">
            {isLoading ? (
              <div className="p-4">
                <Skeleton className="h-24 w-full" />
              </div>
            ) : error ? (
              <p className="px-4 py-10 text-center text-sm text-destructive">{t('loadError')}</p>
            ) : sets.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-muted-foreground">{t('empty')}</p>
                {canManage ? (
                  <Button className="mt-4" size="sm" onClick={() => setShowCreate(true)}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    {t('createButton')}
                  </Button>
                ) : null}
              </div>
            ) : (
              <ul className="divide-y">
                {sets.map((set) => (
                  <li key={set.id} className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{set.name}</p>
                      {set.isSystem ? (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                          {t('systemBadge')}
                        </span>
                      ) : null}
                    </div>
                    {set.description !== null ? (
                      <p className="text-sm text-muted-foreground">{set.description}</p>
                    ) : null}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{t('permissionsCount', { count: set.permissions.length })}</span>
                      <span>{t('usersBadge', { count: set.userCount })}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {canManage ? (
                        <TooltipIconButton
                          icon={Pencil}
                          label={t('editButton')}
                          onClick={() => openEdit(set)}
                        />
                      ) : null}
                      {canManage ? (
                        <TooltipIconButton
                          icon={Trash2}
                          label={t('deleteButton')}
                          variant="destructive"
                          disabled={set.isSystem || set.userCount > 0 || deleteSet.isPending}
                          onClick={() => {
                            void appConfirm({
                              description: t('deleteConfirm'),
                              destructive: true,
                            }).then((ok) => {
                              if (ok) deleteSet.mutate({ id: set.id });
                            });
                          }}
                        />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Create dialog ───────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={(o) => (o ? setShowCreate(true) : closeCreate())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">{t('nameLabel')}</Label>
              <Input
                id="p-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-desc">{t('descriptionLabel')}</Label>
              <Textarea
                id="p-desc"
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCreate}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => {
                if (!createName.trim()) return;
                createSet.mutate({
                  name: createName.trim(),
                  ...(createDesc.trim() ? { description: createDesc.trim() } : {}),
                  permissions: [],
                });
              }}
              disabled={!createName.trim() || createSet.isPending}
            >
              {t('createSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit sheet (matrix) ─────────────────────────────────────────── */}
      <Sheet
        open={editingId !== null}
        onOpenChange={(o) => {
          if (!o) setEditingId(null);
        }}
      >
        <SheetContent className="flex w-full flex-col sm:max-w-xl" side="right">
          <SheetHeader>
            <SheetTitle>{t('edit.title')}</SheetTitle>
          </SheetHeader>

          <div className="mt-6 flex-1 space-y-6 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label htmlFor="ep-name">{t('edit.nameLabel')}</Label>
              <Input
                id="ep-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={120}
                disabled={editReadOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-desc">{t('edit.descriptionLabel')}</Label>
              <Textarea
                id="ep-desc"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={2}
                maxLength={500}
                disabled={editReadOnly}
              />
            </div>

            {editReadOnly ? (
              <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                {t('edit.systemReadOnlyNote')}
              </p>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('edit.permissionsLabel')}</Label>
                <span className="text-xs text-muted-foreground">
                  {t('edit.selectedCount', { count: draft.size })}
                </span>
              </div>
              <PermissionMatrix draft={draft} onChange={setDraft} readOnly={editReadOnly} />
            </div>
          </div>

          <SheetFooter className="mt-4">
            <Button variant="outline" onClick={() => setEditingId(null)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => {
                if (editingId === null || !editName.trim()) return;
                updateSet.mutate({
                  id: editingId,
                  name: editName.trim(),
                  description: editDesc.trim() || null,
                  permissions: [...draft],
                });
              }}
              disabled={editReadOnly || !editName.trim() || updateSet.isPending}
            >
              {t('edit.saveButton')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
