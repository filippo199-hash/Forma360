'use client';

import { MapPin, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
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
  SheetHeader,
  SheetTitle,
} from '../../../../src/components/ui/sheet';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { trpc } from '../../../../src/lib/trpc/client';

type MembershipMode = 'manual' | 'rule_based';

export default function SitesPage() {
  const t = useTranslations('settings.sites');
  const tMode = useTranslations('settings.groups.mode');
  const utils = trpc.useUtils();

  const { data: sites, isLoading } = trpc.sites.list.useQuery();
  const { data: usersData } = trpc.users.list.useQuery({});
  const users = usersData?.users ?? [];

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createParentId, setCreateParentId] = useState('');
  const [createMode, setCreateMode] = useState<MembershipMode>('manual');
  /** When set, pre-fills the parent field ("+Add sub-site" button) */
  const [createPresetParentId, setCreatePresetParentId] = useState<string | null>(null);

  // Edit dialog
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Members sheet
  const [membersSiteId, setMembersSiteId] = useState<string | null>(null);
  const [addUserId, setAddUserId] = useState('');

  const membersSite = (sites ?? []).find((s) => s.id === membersSiteId) ?? null;

  // Use sites.matrix to get members for the selected site
  const { data: matrixData, isLoading: membersLoading } = trpc.sites.matrix.useQuery(
    { siteIds: membersSiteId !== null ? [membersSiteId] : [] },
    { enabled: membersSiteId !== null },
  );
  const memberEdges = useMemo(
    () => (matrixData?.edges ?? []).filter((e) => e.siteId === membersSiteId),
    [matrixData, membersSiteId],
  );
  const memberUserIds = new Set(memberEdges.map((e) => e.userId));
  const memberUsers = users.filter((u) => memberUserIds.has(u.id));
  const addableUsers = users.filter((u) => !memberUserIds.has(u.id));

  const createSite = trpc.sites.create.useMutation({
    onSuccess: () => {
      void utils.sites.list.invalidate();
      setShowCreate(false);
      setCreateName('');
      setCreateParentId('');
      setCreatePresetParentId(null);
      setCreateMode('manual');
      toast.success(t('createSuccess'));
    },
    onError: (err) => toast.error(err.message || t('createError')),
  });

  const updateSite = trpc.sites.update.useMutation({
    onSuccess: () => {
      void utils.sites.list.invalidate();
      setEditingSiteId(null);
      toast.success(t('editSuccess'));
    },
    onError: (err) => toast.error(err.message || t('editError')),
  });

  const archiveSite = trpc.sites.archive.useMutation({
    onSuccess: () => {
      void utils.sites.list.invalidate();
      toast.success(t('archiveSuccess'));
    },
    onError: (err) => toast.error(err.message || t('archiveError')),
  });

  const addMember = trpc.sites.addMember.useMutation({
    onSuccess: () => {
      void utils.sites.matrix.invalidate();
      setAddUserId('');
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMember = trpc.sites.removeMember.useMutation({
    onSuccess: () => {
      void utils.sites.matrix.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function openCreateChild(parentId: string) {
    setCreatePresetParentId(parentId);
    setCreateParentId(parentId);
    setCreateName('');
    setCreateMode('manual');
    setShowCreate(true);
  }

  function openEdit(site: { id: string; name: string }) {
    setEditingSiteId(site.id);
    setEditName(site.name);
  }

  // Only allow selecting sites that won't exceed depth limit (≤4 depth parent = ≤5 child)
  const selectableSites = (sites ?? []).filter((s) => s.depth < 4);

  const effectiveParentId = createPresetParentId ?? createParentId;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button onClick={() => { setCreatePresetParentId(null); setCreateParentId(''); setShowCreate(true); }}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t('createButton')}
        </Button>
      </header>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium">{t('table.name')}</th>
                <th className="px-4 py-3 font-medium">{t('table.mode')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="p-4">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ) : (sites ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                    {t('empty')}
                  </td>
                </tr>
              ) : (
                (sites ?? []).map((site) => (
                  <tr key={site.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div
                        className="flex items-center gap-2"
                        style={{ paddingLeft: `${site.depth * 1.25}rem` }}
                      >
                        {site.depth > 0 ? (
                          <span className="text-muted-foreground/50">└</span>
                        ) : (
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="font-medium">{site.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          site.membershipMode === 'rule_based'
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {tMode(site.membershipMode)}
                      </span>
                    </td>
                    <td className="flex items-center justify-end gap-1 px-4 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setMembersSiteId(site.id)}
                      >
                        <MapPin className="mr-1.5 h-3.5 w-3.5" />
                        {t('membersButton')}
                      </Button>
                      {site.depth < 4 ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openCreateChild(site.id)}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          {t('addChildButton')}
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(site)}
                      >
                        {t('editButton')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (window.confirm(t('archiveConfirm'))) {
                            archiveSite.mutate({ id: site.id });
                          }
                        }}
                        disabled={archiveSite.isPending}
                      >
                        {t('archiveButton')}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ── Create dialog ───────────────────────────────────────────────── */}
      <Dialog
        open={showCreate}
        onOpenChange={(o) => {
          if (!o) {
            setShowCreate(false);
            setCreatePresetParentId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="s-name">{t('nameLabel')}</Label>
              <Input
                id="s-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
            {createPresetParentId === null ? (
              <div className="space-y-1.5">
                <Label htmlFor="s-parent">{t('parentLabel')}</Label>
                <select
                  id="s-parent"
                  value={createParentId}
                  onChange={(e) => setCreateParentId(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">{t('noParent')}</option>
                  {selectableSites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {'— '.repeat(s.depth)}
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t('parentLabel')}: </span>
                <span className="font-medium">
                  {(sites ?? []).find((s) => s.id === createPresetParentId)?.name ?? ''}
                </span>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="s-mode">{t('modeLabel')}</Label>
              <select
                id="s-mode"
                value={createMode}
                onChange={(e) => setCreateMode(e.target.value as MembershipMode)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="manual">{tMode('manual')}</option>
                <option value="rule_based">{tMode('rule_based')}</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreate(false);
                setCreatePresetParentId(null);
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={() => {
                if (!createName.trim()) return;
                const parentId = effectiveParentId !== '' ? effectiveParentId : null;
                createSite.mutate({
                  name: createName.trim(),
                  ...(parentId !== null ? { parentId } : {}),
                  membershipMode: createMode,
                });
              }}
              disabled={!createName.trim() || createSite.isPending}
            >
              {t('createSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ─────────────────────────────────────────────────── */}
      <Dialog
        open={editingSiteId !== null}
        onOpenChange={(o) => {
          if (!o) setEditingSiteId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('editTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="es-name">{t('nameLabel')}</Label>
              <Input
                id="es-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSiteId(null)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => {
                if (editingSiteId === null || !editName.trim()) return;
                updateSite.mutate({ id: editingSiteId, name: editName.trim() });
              }}
              disabled={!editName.trim() || updateSite.isPending}
            >
              {t('editSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Members sheet ───────────────────────────────────────────────── */}
      <Sheet
        open={membersSiteId !== null}
        onOpenChange={(o) => {
          if (!o) setMembersSiteId(null);
        }}
      >
        <SheetContent className="w-full sm:max-w-lg" side="right">
          <SheetHeader>
            <SheetTitle>
              {membersSite !== null ? t('members.title', { name: membersSite.name }) : ''}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {membersSite?.membershipMode === 'manual' ? (
              <div className="flex gap-2">
                <select
                  value={addUserId}
                  onChange={(e) => setAddUserId(e.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">{t('members.addPlaceholder')}</option>
                  {addableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.email}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  onClick={() => {
                    if (!addUserId || !membersSiteId) return;
                    addMember.mutate({ siteId: membersSiteId, userId: addUserId });
                  }}
                  disabled={!addUserId || addMember.isPending}
                >
                  {t('members.addButton')}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('members.ruleBasedNote')}</p>
            )}

            {membersLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : memberUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('members.empty')}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {memberUsers.map((u) => {
                  const edge = memberEdges.find((e) => e.userId === u.id);
                  return (
                    <li key={u.id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-sm font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                        {edge !== undefined &&
                        edge.addedVia !== 'manual' &&
                        edge.addedVia !== 'invite' ? (
                          <p className="text-xs text-purple-600">{t('members.addedViaRule')}</p>
                        ) : null}
                      </div>
                      {(edge?.addedVia === 'manual' || edge?.addedVia === 'invite') &&
                      membersSite?.membershipMode === 'manual' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-muted-foreground"
                          onClick={() => {
                            if (membersSiteId)
                              removeMember.mutate({ siteId: membersSiteId, userId: u.id });
                          }}
                          disabled={removeMember.isPending}
                          aria-label={t('members.removeButton')}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
