'use client';

import { Plus, Users, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../../../../src/components/ui/sheet';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { trpc } from '../../../../src/lib/trpc/client';

type MembershipMode = 'manual' | 'rule_based';

export default function GroupsPage() {
  const t = useTranslations('settings.groups');
  const utils = trpc.useUtils();

  const { data: groups, isLoading } = trpc.groups.list.useQuery();
  const { data: usersData } = trpc.users.list.useQuery({});
  const users = usersData?.users ?? [];

  // Create dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createMode, setCreateMode] = useState<MembershipMode>('manual');

  // Edit dialog state
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  // Members sheet state
  const [membersGroupId, setMembersGroupId] = useState<string | null>(null);
  const [addUserId, setAddUserId] = useState('');

  const membersGroup = (groups ?? []).find((g) => g.id === membersGroupId) ?? null;

  const { data: membersList, isLoading: membersLoading } = trpc.groups.members.useQuery(
    { groupId: membersGroupId ?? '' },
    { enabled: membersGroupId !== null },
  );

  const createGroup = trpc.groups.create.useMutation({
    onSuccess: () => {
      void utils.groups.list.invalidate();
      setShowCreate(false);
      setCreateName('');
      setCreateDesc('');
      setCreateMode('manual');
      toast.success(t('createSuccess'));
    },
    onError: (err) => toast.error(err.message || t('createError')),
  });

  const updateGroup = trpc.groups.update.useMutation({
    onSuccess: () => {
      void utils.groups.list.invalidate();
      setEditingGroupId(null);
      toast.success(t('editSuccess'));
    },
    onError: (err) => toast.error(err.message || t('editError')),
  });

  const archiveGroup = trpc.groups.archive.useMutation({
    onSuccess: () => {
      void utils.groups.list.invalidate();
      toast.success(t('archiveSuccess'));
    },
    onError: (err) => toast.error(err.message || t('archiveError')),
  });

  const addMember = trpc.groups.addMember.useMutation({
    onSuccess: () => {
      void utils.groups.members.invalidate({ groupId: membersGroupId ?? '' });
      setAddUserId('');
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMember = trpc.groups.removeMember.useMutation({
    onSuccess: () => {
      void utils.groups.members.invalidate({ groupId: membersGroupId ?? '' });
    },
    onError: (err) => toast.error(err.message),
  });

  function openEdit(group: { id: string; name: string; description: string | null }) {
    setEditingGroupId(group.id);
    setEditName(group.name);
    setEditDesc(group.description ?? '');
  }

  const memberUserIds = new Set((membersList ?? []).map((m) => m.userId));
  const addableUsers = users.filter((u) => !memberUserIds.has(u.id));

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t('createButton')}
        </Button>
      </header>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium">{t('table.name')}</th>
                  <th className="px-4 py-3 font-medium">{t('table.mode')}</th>
                  <th className="px-4 py-3 font-medium">{t('table.description')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={4} className="p-4">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ) : (groups ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                      {t('empty')}
                    </td>
                  </tr>
                ) : (
                  (groups ?? []).map((group) => (
                    <tr key={group.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{group.name}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            group.membershipMode === 'rule_based'
                              ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {t(`mode.${group.membershipMode}`)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {group.description ?? '—'}
                      </td>
                      <td className="flex items-center justify-end gap-1 px-4 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setMembersGroupId(group.id)}
                        >
                          <Users className="mr-1.5 h-3.5 w-3.5" />
                          {t('membersButton')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(group)}>
                          {t('editButton')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (window.confirm(t('archiveConfirm'))) {
                              archiveGroup.mutate({ id: group.id });
                            }
                          }}
                          disabled={archiveGroup.isPending}
                        >
                          {t('archiveButton')}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Create dialog ───────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="g-name">{t('nameLabel')}</Label>
              <Input
                id="g-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-desc">{t('descriptionLabel')}</Label>
              <Textarea
                id="g-desc"
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-mode">{t('modeLabel')}</Label>
              <select
                id="g-mode"
                value={createMode}
                onChange={(e) => setCreateMode(e.target.value as MembershipMode)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="manual">{t('mode.manual')}</option>
                <option value="rule_based">{t('mode.rule_based')}</option>
              </select>
              <p className="text-xs text-muted-foreground">{t(`modeHint.${createMode}`)}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => {
                if (!createName.trim()) return;
                createGroup.mutate({
                  name: createName.trim(),
                  ...(createDesc.trim() ? { description: createDesc.trim() } : {}),
                  membershipMode: createMode,
                });
              }}
              disabled={!createName.trim() || createGroup.isPending}
            >
              {t('createSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ─────────────────────────────────────────────────── */}
      <Dialog
        open={editingGroupId !== null}
        onOpenChange={(o) => {
          if (!o) setEditingGroupId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('editTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="eg-name">{t('nameLabel')}</Label>
              <Input
                id="eg-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eg-desc">{t('descriptionLabel')}</Label>
              <Textarea
                id="eg-desc"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingGroupId(null)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => {
                if (editingGroupId === null || !editName.trim()) return;
                updateGroup.mutate({
                  id: editingGroupId,
                  name: editName.trim(),
                  description: editDesc.trim() || null,
                });
              }}
              disabled={!editName.trim() || updateGroup.isPending}
            >
              {t('editSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Members sheet ───────────────────────────────────────────────── */}
      <Sheet
        open={membersGroupId !== null}
        onOpenChange={(o) => {
          if (!o) setMembersGroupId(null);
        }}
      >
        <SheetContent className="w-full sm:max-w-lg" side="right">
          <SheetHeader>
            <SheetTitle>
              {membersGroup !== null ? t('members.title', { name: membersGroup.name }) : ''}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {/* Add member */}
            {membersGroup?.membershipMode === 'manual' ? (
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
                    if (!addUserId || !membersGroupId) return;
                    addMember.mutate({ groupId: membersGroupId, userId: addUserId });
                  }}
                  disabled={!addUserId || addMember.isPending}
                >
                  {t('members.addButton')}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('members.ruleBasedNote')}</p>
            )}

            {/* Member list */}
            {membersLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (membersList ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('members.empty')}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {(membersList ?? []).map((m) => (
                  <li key={m.userId} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <p className="text-sm font-medium">{m.userName ?? m.userId}</p>
                      {m.userEmail !== null ? (
                        <p className="text-xs text-muted-foreground">{m.userEmail}</p>
                      ) : null}
                      {m.addedVia !== 'manual' && m.addedVia !== 'invite' ? (
                        <p className="text-xs text-purple-600">{t('members.addedViaRule')}</p>
                      ) : null}
                    </div>
                    {(m.addedVia === 'manual' || m.addedVia === 'invite') &&
                    membersGroup?.membershipMode === 'manual' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-muted-foreground"
                        onClick={() => {
                          if (membersGroupId)
                            removeMember.mutate({ groupId: membersGroupId, userId: m.userId });
                        }}
                        disabled={removeMember.isPending}
                        aria-label={t('members.removeButton')}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
