'use client';

import { CheckCircle2, Clock, Mail, UserPlus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '../../lib/cn';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const ACTIVITIES = ['inspections', 'observations', 'actions', 'documents'] as const;
type Activity = (typeof ACTIVITIES)[number];

function ActivityChips({ activities }: { activities: string[] }) {
  const t = useTranslations('contractors');
  if (activities.length === 0)
    return <span className="text-xs text-muted-foreground">{t('users.noActivities')}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {activities.map((a) => (
        <span
          key={a}
          className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
        >
          {t(`users.activity_${a}` as 'users.activity_inspections')}
        </span>
      ))}
    </div>
  );
}

function ActivityPicker({
  value,
  onChange,
}: {
  value: Activity[];
  onChange: (next: Activity[]) => void;
}) {
  const t = useTranslations('contractors');
  return (
    <div className="space-y-1.5">
      {ACTIVITIES.map((a) => (
        <label key={a} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.includes(a)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, a] : value.filter((x) => x !== a))
            }
          />
          {t(`users.activity_${a}` as 'users.activity_inspections')}
        </label>
      ))}
    </div>
  );
}

/** "Users" section on the contractor detail page — invite + manage portal users. */
export function ContractorUsersSection({
  contractorId,
  canManage,
}: {
  contractorId: string;
  canManage: boolean;
}) {
  const t = useTranslations('contractors');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();
  const { data } = trpc.contractors.users.list.useQuery({ contractorId });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [activities, setActivities] = useState<Activity[]>(['inspections', 'observations']);

  // Edit-activities dialog for an existing member.
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editActivities, setEditActivities] = useState<Activity[]>([]);

  const refresh = () => void utils.contractors.users.list.invalidate({ contractorId });
  const onErr = (err: { message: string }) =>
    toast.error(err.message.length > 0 ? err.message : t('error'));

  const invite = trpc.contractors.users.invite.useMutation({
    onSuccess: () => {
      toast.success(t('users.invitedToast'));
      refresh();
      setInviteOpen(false);
      setEmail('');
      setName('');
      setActivities(['inspections', 'observations']);
    },
    onError: onErr,
  });
  const updateActivities = trpc.contractors.users.updateActivities.useMutation({
    onSuccess: () => {
      toast.success(t('users.savedToast'));
      refresh();
      setEditUserId(null);
    },
    onError: onErr,
  });
  const remove = trpc.contractors.users.remove.useMutation({ onSuccess: refresh, onError: onErr });
  const cancelInvite = trpc.contractors.users.cancelInvite.useMutation({
    onSuccess: refresh,
    onError: onErr,
  });

  const members = data?.members ?? [];
  const pending = data?.pending ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('users.heading')}</h2>
          <p className="text-sm text-muted-foreground">{t('users.subtitle')}</p>
        </div>
        {canManage ? (
          <Button variant="outline" size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-1 h-4 w-4" />
            {t('users.inviteButton')}
          </Button>
        ) : null}
      </div>

      {members.length === 0 && pending.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('users.empty')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{m.name}</span>
                      {m.deactivatedAt !== null ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] text-red-700 dark:bg-red-900/40 dark:text-red-200">
                          {t('users.revoked')}
                        </span>
                      ) : m.acknowledgedAt !== null ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100">
                          <CheckCircle2 className="h-3 w-3" />
                          {t('users.active')}
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                          {t('users.pendingAck')}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    <div className="mt-1">
                      <ActivityChips activities={m.activities} />
                    </div>
                  </div>
                  {canManage && m.deactivatedAt === null ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => {
                          setEditUserId(m.userId);
                          setEditActivities(
                            m.activities.filter((a): a is Activity =>
                              (ACTIVITIES as readonly string[]).includes(a),
                            ),
                          );
                        }}
                      >
                        {t('users.editActivities')}
                      </Button>
                      <button
                        type="button"
                        aria-label={t('users.remove')}
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (window.confirm(t('users.removeConfirm')))
                            remove.mutate({ userId: m.userId });
                        }}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
              {pending.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{p.email}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {t('users.invited')}
                      </span>
                    </div>
                    <div className="mt-1">
                      <ActivityChips activities={p.activities ?? []} />
                    </div>
                  </div>
                  {canManage ? (
                    <button
                      type="button"
                      aria-label={t('users.cancelInvite')}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                      onClick={() => cancelInvite.mutate({ invitationId: p.id })}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('users.inviteButton')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cu-email">{t('users.emailLabel')}</Label>
              <Input
                id="cu-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={200}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cu-name">{t('users.nameLabel')}</Label>
              <Input
                id="cu-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('users.activitiesLabel')}</Label>
              <ActivityPicker value={activities} onChange={setActivities} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              disabled={invite.isPending || email.trim() === ''}
              onClick={() =>
                invite.mutate({
                  contractorId,
                  email: email.trim(),
                  ...(name.trim() !== '' ? { name: name.trim() } : {}),
                  activities,
                })
              }
            >
              {t('users.sendInvite')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit-activities dialog */}
      <Dialog open={editUserId !== null} onOpenChange={(o) => !o && setEditUserId(null)}>
        <DialogContent className={cn('max-w-sm')}>
          <DialogHeader>
            <DialogTitle>{t('users.editActivities')}</DialogTitle>
          </DialogHeader>
          <ActivityPicker value={editActivities} onChange={setEditActivities} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditUserId(null)}>
              {tCommon('cancel')}
            </Button>
            <Button
              disabled={updateActivities.isPending}
              onClick={() => {
                if (editUserId !== null)
                  updateActivities.mutate({ userId: editUserId, activities: editActivities });
              }}
            >
              {t('saveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
