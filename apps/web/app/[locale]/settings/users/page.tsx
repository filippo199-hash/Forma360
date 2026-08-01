'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AnonymiseUserDialog } from '../../../../src/components/settings/anonymise-user-dialog';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { usePlaceTerms } from '../../../../src/lib/terminology';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * Users admin page. It lets an administrator:
 *   - invite a user (opens the invite panel) — emails the invitee on submit
 *   - deactivate / reactivate a user from their table row
 *   - export the user list to CSV (one-click download)
 *
 * Below the users table we render a "Pending invitations" section backed
 * by `users.listInvitations`. Each row offers Resend (which re-issues the
 * invite with a refreshed token / TTL) and Cancel (hard-delete of the
 * invitations row).
 */
export default function UsersPage() {
  const params = useParams();
  const locale = typeof params.locale === 'string' ? params.locale : 'en';
  const t = useTranslations('settings.users');
  const tInvitations = useTranslations('settings.users.invitations');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();
  const canAnonymise = useHasPermission('users.anonymise');
  const meQuery = trpc.health.me.useQuery();
  const { data, isLoading, error: usersError } = trpc.users.list.useQuery({});
  const { data: sets } = trpc.permissions.list.useQuery();
  const { data: groupsData } = trpc.groups.list.useQuery();
  const { data: sitesData } = trpc.sites.list.useQuery();
  const invitationsQuery = trpc.users.listInvitations.useQuery();

  const invite = trpc.users.invite.useMutation({
    onSuccess: (_result, vars) => {
      void utils.users.list.invalidate();
      void utils.users.listInvitations.invalidate();
      setShowInvite(false);
      toast.success(t('inviteSentToast', { email: vars.email }));
    },
  });
  const cancelInvite = trpc.users.cancelInvite.useMutation({
    onSuccess: () => {
      void utils.users.listInvitations.invalidate();
      toast.success(tInvitations('cancelSuccess'));
    },
    onError: (e) => toast.error(e.message || tCommon('error')),
  });
  const resendInvite = trpc.users.invite.useMutation({
    onSuccess: (_result, vars) => {
      void utils.users.listInvitations.invalidate();
      toast.success(tInvitations('resendSuccess', { email: vars.email }));
    },
    onError: (e) => toast.error(e.message || tCommon('error')),
  });
  const deactivate = trpc.users.deactivate.useMutation({
    onSuccess: () => utils.users.list.invalidate(),
    onError: (e) => toast.error(e.message || tCommon('error')),
  });
  const reactivate = trpc.users.reactivate.useMutation({
    onSuccess: () => utils.users.list.invalidate(),
    onError: (e) => toast.error(e.message || tCommon('error')),
  });
  const anonymise = trpc.users.anonymise.useMutation({
    onSuccess: (_result, vars) => {
      void utils.users.list.invalidate();
      void utils.users.listInvitations.invalidate();
      const target = userById.get(vars.userId);
      toast.success(t('anonymise.successToast', { name: target?.name ?? '' }));
      setAnonTarget(null);
    },
    onError: (e) => toast.error(e.message || tCommon('error')),
  });

  const [showInvite, setShowInvite] = useState(false);
  const [anonTarget, setAnonTarget] = useState<{ id: string; name: string; email: string } | null>(
    null,
  );

  async function exportCsv() {
    const result = await utils.users.listExport.fetch();
    const blob = new Blob([result.csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function onResend(payload: { email: string; name: string | null; permissionSetId: string }) {
    resendInvite.mutate({
      email: payload.email,
      ...(payload.name !== null ? { name: payload.name } : {}),
      permissionSetId: payload.permissionSetId,
    });
  }

  const invitations = invitationsQuery.data?.invitations ?? [];
  const users = data?.users ?? [];
  const userById = new Map(users.map((u) => [u.id, u]));

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} aria-label={t('exportButton')}>
            {t('exportButton')}
          </Button>
          <Button onClick={() => setShowInvite((v) => !v)} aria-label={t('inviteButton')}>
            {t('inviteButton')}
          </Button>
        </div>
      </header>

      {showInvite ? (
        <InvitePanel
          sets={sets ?? []}
          groups={groupsData ?? []}
          sites={sitesData ?? []}
          isPending={invite.isPending}
          onSubmit={(payload) => invite.mutate(payload)}
          onCancel={() => setShowInvite(false)}
        />
      ) : null}

      <Card>
        <CardContent className="p-0">
          {usersError !== null ? (
            <p role="alert" className="px-3 py-6 text-center text-sm text-destructive">
              {usersError.message || tCommon('error')}
            </p>
          ) : isLoading ? (
            <div className="p-4">
              <Skeleton className="h-4 w-full" />
            </div>
          ) : users.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('emptyState')}</p>
          ) : (
            <>
              {/* Mobile: stacked cards */}
              <ul className="divide-y md:hidden">
                {users.map((u) => {
                  const isSelf = u.id === meQuery.data?.userId;
                  const isTombstoned = u.email.endsWith('@anonymised.local');
                  return (
                    <li key={u.id} className="space-y-1 px-3 py-3">
                      <Link
                        href={`/${locale}/settings/users/${u.id}`}
                        className="font-medium hover:underline"
                      >
                        {u.name}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{u.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {u.deactivatedAt !== null ? t('status.deactivated') : t('status.active')}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {u.deactivatedAt === null ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => deactivate.mutate({ userId: u.id })}
                            disabled={deactivate.isPending}
                            aria-label={t('row.deactivate')}
                          >
                            {t('row.deactivate')}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => reactivate.mutate({ userId: u.id })}
                            disabled={reactivate.isPending}
                            aria-label={t('row.reactivate')}
                          >
                            {t('row.reactivate')}
                          </Button>
                        )}
                        {canAnonymise ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setAnonTarget({ id: u.id, name: u.name, email: u.email })
                            }
                            disabled={isSelf || isTombstoned || anonymise.isPending}
                            className="text-destructive hover:text-destructive"
                            aria-label={t('row.anonymise')}
                          >
                            {t('row.anonymise')}
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Desktop: table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">{t('table.name')}</th>
                      <th className="px-3 py-2 font-medium">{t('table.email')}</th>
                      <th className="px-3 py-2 font-medium">{t('table.status')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('table.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const isSelf = u.id === meQuery.data?.userId;
                      const isTombstoned = u.email.endsWith('@anonymised.local');
                      return (
                        <tr key={u.id} className="border-b last:border-0">
                          <td className="px-3 py-2">
                            <Link
                              href={`/${locale}/settings/users/${u.id}`}
                              className="hover:underline"
                            >
                              {u.name}
                            </Link>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{u.email}</td>
                          <td className="px-3 py-2">
                            {u.deactivatedAt !== null
                              ? t('status.deactivated')
                              : t('status.active')}
                          </td>
                          <td className="space-x-1 px-3 py-2 text-right">
                            {u.deactivatedAt === null ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deactivate.mutate({ userId: u.id })}
                                disabled={deactivate.isPending}
                                aria-label={t('row.deactivate')}
                              >
                                {t('row.deactivate')}
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => reactivate.mutate({ userId: u.id })}
                                disabled={reactivate.isPending}
                                aria-label={t('row.reactivate')}
                              >
                                {t('row.reactivate')}
                              </Button>
                            )}
                            {canAnonymise ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setAnonTarget({ id: u.id, name: u.name, email: u.email })
                                }
                                disabled={isSelf || isTombstoned || anonymise.isPending}
                                className="text-destructive hover:text-destructive"
                                aria-label={t('row.anonymise')}
                              >
                                {t('row.anonymise')}
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tInvitations('title')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">{tInvitations('headerEmail')}</th>
                  <th className="px-3 py-2 font-medium">{tInvitations('headerName')}</th>
                  <th className="px-3 py-2 font-medium">{tInvitations('headerExpires')}</th>
                  <th className="px-3 py-2 text-right font-medium">
                    {tInvitations('headerActions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {invitationsQuery.error !== null ? (
                  <tr>
                    <td
                      colSpan={4}
                      role="alert"
                      className="px-3 py-6 text-center text-sm text-destructive"
                    >
                      {invitationsQuery.error.message || tCommon('error')}
                    </td>
                  </tr>
                ) : invitationsQuery.isLoading ? (
                  <tr>
                    <td colSpan={4} className="p-4">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ) : invitations.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">
                      {tInvitations('emptyState')}
                    </td>
                  </tr>
                ) : (
                  invitations.map((inv) => {
                    const inviter = userById.get(inv.invitedByUserId);
                    return (
                      <tr key={inv.id} className="border-b last:border-0">
                        <td className="px-3 py-2 font-mono text-xs">{inv.email}</td>
                        <td className="px-3 py-2">
                          <div>{inv.name ?? ''}</div>
                          {inviter !== undefined ? (
                            <div className="text-xs text-muted-foreground">
                              {tInvitations('invitedBy', { name: inviter.name })}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {tInvitations('expiresAt', {
                            time: new Date(inv.expiresAt).toLocaleString(locale),
                          })}
                        </td>
                        <td className="space-x-1 px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              onResend({
                                email: inv.email,
                                name: inv.name,
                                permissionSetId: inv.permissionSetId,
                              })
                            }
                            disabled={resendInvite.isPending}
                          >
                            {tInvitations('resendButton')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (!window.confirm(t('cancelInviteConfirm'))) return;
                              cancelInvite.mutate({ invitationId: inv.id });
                            }}
                            disabled={cancelInvite.isPending}
                          >
                            {tInvitations('cancelButton')}
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {invite.error !== null && invite.error !== undefined ? (
        <p role="alert" className="text-sm text-destructive">
          {tCommon('error')}
        </p>
      ) : null}

      <AnonymiseUserDialog
        userId={anonTarget?.id ?? ''}
        userName={anonTarget?.name ?? ''}
        userEmail={anonTarget?.email ?? ''}
        open={anonTarget !== null}
        onOpenChange={(open) => {
          if (!open) setAnonTarget(null);
        }}
        onConfirm={() => {
          if (anonTarget === null) return;
          anonymise.mutate({ userId: anonTarget.id, confirmEmail: anonTarget.email });
        }}
        pending={anonymise.isPending}
      />
    </div>
  );
}

/** Country codes shown in the phone prefix selector. */
const COUNTRY_CODES = [
  { code: '+1', label: '+1 (US/CA)' },
  { code: '+44', label: '+44 (UK)' },
  { code: '+33', label: '+33 (FR)' },
  { code: '+49', label: '+49 (DE)' },
  { code: '+39', label: '+39 (IT)' },
  { code: '+34', label: '+34 (ES)' },
  { code: '+81', label: '+81 (JP)' },
  { code: '+31', label: '+31 (NL)' },
  { code: '+48', label: '+48 (PL)' },
  { code: '+351', label: '+351 (PT)' },
  { code: '+86', label: '+86 (CN)' },
  { code: '+55', label: '+55 (BR)' },
  { code: '+61', label: '+61 (AU)' },
  { code: '+91', label: '+91 (IN)' },
  { code: '+52', label: '+52 (MX)' },
  { code: '+27', label: '+27 (ZA)' },
  { code: '+82', label: '+82 (KR)' },
  { code: '+65', label: '+65 (SG)' },
  { code: '+971', label: '+971 (AE)' },
  { code: '+966', label: '+966 (SA)' },
] as const;

interface InvitePayload {
  email: string;
  name: string;
  phone?: string;
  permissionSetId: string;
  groupIds: string[];
  siteIds: string[];
}

function InvitePanel({
  sets,
  groups,
  sites,
  isPending,
  onSubmit,
  onCancel,
}: {
  sets: ReadonlyArray<{ id: string; name: string }>;
  groups: ReadonlyArray<{ id: string; name: string }>;
  sites: ReadonlyArray<{ id: string; name: string; depth: number }>;
  isPending: boolean;
  onSubmit: (payload: InvitePayload) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('settings.users.invite');
  const { labelPlural: placesLabel } = usePlaceTerms();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+1');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [permissionSetId, setPermissionSetId] = useState(sets[0]?.id ?? '');
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [selectedSiteIds, setSelectedSiteIds] = useState<Set<string>>(new Set());

  function toggleGroup(id: string) {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSite(id: string) {
    setSelectedSiteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    if (!email.trim() || !fullName || !permissionSetId) return;
    const digitsOnly = phoneNumber.trim().replace(/\D/g, '');
    const phone = digitsOnly.length > 0 ? `${countryCode}${digitsOnly}` : undefined;
    onSubmit({
      email: email.trim(),
      name: fullName,
      ...(phone !== undefined ? { phone } : {}),
      permissionSetId,
      groupIds: [...selectedGroupIds],
      siteIds: [...selectedSiteIds],
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Row 1: email + first + last */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="inv-email">{t('emailLabel')}</Label>
              <Input
                id="inv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-first">{t('firstNameLabel')}</Label>
              <Input
                id="inv-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                maxLength={60}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-last">{t('lastNameLabel')}</Label>
              <Input
                id="inv-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={60}
              />
            </div>
          </div>

          {/* Row 2: phone + permission set */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inv-phone">{t('phoneLabel')}</Label>
              <div className="flex gap-2">
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="h-10 w-36 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
                  aria-label={t('phoneCountryLabel')}
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <Input
                  id="inv-phone"
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder={t('phonePlaceholder')}
                  maxLength={20}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-set">{t('permissionSetLabel')}</Label>
              <select
                id="inv-set"
                value={permissionSetId}
                onChange={(e) => setPermissionSetId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                required
              >
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 3: groups + sites — always visible */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('groupsLabel')}</Label>
              {groups.length > 0 ? (
                <div className="max-h-36 overflow-y-auto rounded-md border p-2 space-y-1">
                  {groups.map((g) => (
                    <label
                      key={g.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/50 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedGroupIds.has(g.id)}
                        onChange={() => toggleGroup(g.id)}
                        className="h-4 w-4 rounded border-input accent-foreground"
                      />
                      {g.name}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                  {t('noGroups')}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>{placesLabel}</Label>
              {sites.length > 0 ? (
                <div className="max-h-36 overflow-y-auto rounded-md border p-2 space-y-1">
                  {sites.map((s) => (
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/50 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSiteIds.has(s.id)}
                        onChange={() => toggleSite(s.id)}
                        className="h-4 w-4 rounded border-input accent-foreground"
                      />
                      <span style={{ paddingLeft: `${s.depth * 0.75}rem` }}>{s.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                  {t('noSites')}
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={isPending || !email.trim() || !firstName.trim() || !permissionSetId}
            >
              {t('submit')}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
