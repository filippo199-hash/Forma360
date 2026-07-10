'use client';

import { Users, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '../../lib/cn';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Skeleton } from '../ui/skeleton';

type MembershipMode = 'manual' | 'rule_based';

/**
 * Team & access tab for a site/project. This is where a site's people live
 * now — membership used to be a standalone "Sites" grouping tab in Settings,
 * which collided with "Groups". Unifying: Groups group people; a site/project
 * simply has its own team, managed here in context.
 */
export function SiteTeamAccess({
  siteId,
  membershipMode,
}: {
  siteId: string;
  membershipMode: MembershipMode;
}) {
  const t = useTranslations('sites');
  const canManage = useHasPermission('sites.manage');
  const utils = trpc.useUtils();

  const { data: usersData } = trpc.users.list.useQuery({});
  const users = usersData?.users ?? [];
  const { data: matrixData, isLoading } = trpc.sites.matrix.useQuery({ siteIds: [siteId] });

  const edges = useMemo(
    () => (matrixData?.edges ?? []).filter((e) => e.siteId === siteId),
    [matrixData, siteId],
  );
  const memberIds = new Set(edges.map((e) => e.userId));
  const memberUsers = users.filter((u) => memberIds.has(u.id));
  const addableUsers = users.filter((u) => !memberIds.has(u.id));

  const [addUserId, setAddUserId] = useState('');

  const updateMode = trpc.sites.update.useMutation({
    onSuccess: () => {
      void utils.sites.getHub.invalidate({ id: siteId });
      void utils.sites.matrix.invalidate();
      toast.success(t('teamModeUpdated'));
    },
    onError: (err) => toast.error(err.message || t('teamError')),
  });

  const addMember = trpc.sites.addMember.useMutation({
    onSuccess: () => {
      void utils.sites.matrix.invalidate();
      void utils.sites.getHub.invalidate({ id: siteId });
      setAddUserId('');
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMember = trpc.sites.removeMember.useMutation({
    onSuccess: () => {
      void utils.sites.matrix.invalidate();
      void utils.sites.getHub.invalidate({ id: siteId });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      {/* Membership mode */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t('teamMembership')}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('teamSubtitle')}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            {(['manual', 'rule_based'] as const).map((mode) => {
              const active = membershipMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={!canManage || updateMode.isPending || active}
                  onClick={() => updateMode.mutate({ id: siteId, membershipMode: mode })}
                  className={cn(
                    'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                    active
                      ? 'border-primary bg-primary/5'
                      : 'border-input hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60',
                  )}
                >
                  <span className="block font-medium text-foreground">
                    {mode === 'manual' ? t('modeManual') : t('modeRuleBased')}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {mode === 'manual' ? t('teamModeManualHelp') : t('teamModeRuleHelp')}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Users className="h-4 w-4 text-primary" />
            {t('teamMembersHeading')}
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
              {memberUsers.length}
            </span>
          </div>

          {membershipMode === 'manual' && canManage ? (
            <div className="flex gap-2">
              <select
                value={addUserId}
                onChange={(e) => setAddUserId(e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t('teamAddPlaceholder')}</option>
                {addableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.email}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={() => {
                  if (addUserId === '') return;
                  addMember.mutate({ siteId, userId: addUserId });
                }}
                disabled={addUserId === '' || addMember.isPending}
              >
                {t('teamAddButton')}
              </Button>
            </div>
          ) : membershipMode === 'rule_based' ? (
            <p className="text-sm text-muted-foreground">{t('teamRuleNote')}</p>
          ) : null}

          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : memberUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('teamEmpty')}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {memberUsers.map((u) => {
                const edge = edges.find((e) => e.userId === u.id);
                const manualEdge = edge?.addedVia === 'manual' || edge?.addedVia === 'invite';
                return (
                  <li key={u.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{u.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      {edge !== undefined && !manualEdge ? (
                        <p className="text-xs text-purple-600">{t('teamAddedViaRule')}</p>
                      ) : null}
                    </div>
                    {manualEdge && membershipMode === 'manual' && canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-muted-foreground"
                        onClick={() => removeMember.mutate({ siteId, userId: u.id })}
                        disabled={removeMember.isPending}
                        aria-label={t('teamRemove')}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
