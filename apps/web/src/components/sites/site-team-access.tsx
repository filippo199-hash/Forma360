'use client';

import { Users, UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useHasPermission } from '../../lib/permissions-context';
import { usePlaceTerms } from '../../lib/terminology';
import { trpc } from '../../lib/trpc/client';
import { GroupUserSelector } from '../selectors/group-user-selector';
import { Card, CardContent } from '../ui/card';
import { Skeleton } from '../ui/skeleton';

/**
 * Team & access tab for a site/project. A site's team is the union of its
 * direct individual members AND the members of any assigned groups — this is
 * also what grants site-scoped access. Groups group people; a site simply
 * points at the people + groups that belong to it. (No membership "mode":
 * assigning a group is the auto-synced path, adding people is the manual one.)
 */
export function SiteTeamAccess({ siteId }: { siteId: string }) {
  const t = useTranslations('sites');
  const { place } = usePlaceTerms();
  const canManage = useHasPermission('sites.manage');
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.sites.team.useQuery({ siteId });

  // Local mirrors of the persisted sets so the multi-selects feel instant;
  // reseeded whenever the server data changes.
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  useEffect(() => {
    if (data !== undefined) {
      setMemberIds(data.memberIds);
      setGroupIds(data.groupIds);
    }
  }, [data]);

  function onError(err: { message: string }) {
    toast.error(err.message.length > 0 ? err.message : t('teamError'));
    void utils.sites.team.invalidate({ siteId });
  }
  const invalidate = () => {
    void utils.sites.team.invalidate({ siteId });
    void utils.sites.getHub.invalidate({ id: siteId });
  };

  const addMembers = trpc.sites.addMembers.useMutation({ onSuccess: invalidate, onError });
  const removeMember = trpc.sites.removeMember.useMutation({ onSuccess: invalidate, onError });
  const addGroup = trpc.sites.addGroup.useMutation({ onSuccess: invalidate, onError });
  const removeGroup = trpc.sites.removeGroup.useMutation({ onSuccess: invalidate, onError });

  function onMembersChange(next: string[]) {
    const added = next.filter((id) => !memberIds.includes(id));
    const removed = memberIds.filter((id) => !next.includes(id));
    setMemberIds(next);
    if (added.length > 0) addMembers.mutate({ siteId, userIds: added });
    for (const userId of removed) removeMember.mutate({ siteId, userId });
  }

  function onGroupsChange(next: string[]) {
    const added = next.filter((id) => !groupIds.includes(id));
    const removed = groupIds.filter((id) => !next.includes(id));
    setGroupIds(next);
    for (const groupId of added) addGroup.mutate({ siteId, groupId });
    for (const groupId of removed) removeGroup.mutate({ siteId, groupId });
  }

  const groupNameById = new Map((data?.groups ?? []).map((g) => [g.id, g.name]));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{t('teamMembership')}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('teamSubtitle', { place })}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Individual members */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Users className="h-4 w-4 text-primary" />
              {t('teamMembersHeading')}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                {memberIds.length}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{t('teamMembersSubtitle', { place })}</p>
            <GroupUserSelector
              mode="users"
              value={memberIds}
              onChange={onMembersChange}
              disabled={!canManage}
              placeholder={t('teamMembersAdd')}
            />
          </CardContent>
        </Card>

        {/* Groups */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <UsersRound className="h-4 w-4 text-primary" />
              {t('teamGroupsHeading')}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                {groupIds.length}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{t('teamGroupsSubtitle')}</p>
            <GroupUserSelector
              mode="groups"
              value={groupIds}
              onChange={onGroupsChange}
              disabled={!canManage}
              placeholder={t('teamGroupsAdd')}
            />
            {(data?.groups ?? []).length > 0 ? (
              <ul className="space-y-1 pt-1 text-xs text-muted-foreground">
                {(data?.groups ?? []).map((g) => (
                  <li key={g.id} className="flex items-center justify-between">
                    <span className="truncate text-foreground">{g.name}</span>
                    <span>{t('teamGroupMemberCount', { count: g.memberCount })}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Everyone with access — deduped roster */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {t('teamEveryoneHeading')}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                {data?.effective.length ?? 0}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('teamEveryoneSubtitle')}</p>
          </div>

          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (data?.effective.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">{t('teamEveryoneEmpty')}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {(data?.effective ?? []).map((p) => (
                <li key={p.userId} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{p.email}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {p.direct ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        {t('teamDirect')}
                      </span>
                    ) : null}
                    {p.viaGroupIds.map((gid) => (
                      <span
                        key={gid}
                        className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900/40 dark:text-purple-200"
                      >
                        {t('teamViaGroup', { name: groupNameById.get(gid) ?? '' })}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
