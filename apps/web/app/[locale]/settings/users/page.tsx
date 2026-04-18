'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * Users admin page. Three capabilities:
 *   - invite (opens the invite panel)
 *   - per-row deactivate / reactivate / anonymise
 *   - CSV import (dialog) + CSV export (one-click download)
 */
export default function UsersPage() {
  const t = useTranslations('settings.users');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.users.list.useQuery({});
  const { data: sets } = trpc.permissions.list.useQuery();
  const invite = trpc.users.invite.useMutation({
    onSuccess: () => {
      void utils.users.list.invalidate();
      setShowInvite(false);
    },
  });
  const deactivate = trpc.users.deactivate.useMutation({
    onSuccess: () => utils.users.list.invalidate(),
  });
  const reactivate = trpc.users.reactivate.useMutation({
    onSuccess: () => utils.users.list.invalidate(),
  });

  const [showInvite, setShowInvite] = useState(false);

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

      {showInvite ? <InvitePanel sets={sets ?? []} onSubmit={invite.mutate} /> : null}

      <Card>
        <CardContent className="p-0">
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
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="p-4">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ) : (
                (data?.users ?? []).map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="px-3 py-2">{u.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{u.email}</td>
                    <td className="px-3 py-2">
                      {u.deactivatedAt !== null ? t('status.deactivated') : t('status.active')}
                    </td>
                    <td className="space-x-1 px-3 py-2 text-right">
                      {u.deactivatedAt === null ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deactivate.mutate({ userId: u.id })}
                          aria-label={t('row.deactivate')}
                        >
                          {t('row.deactivate')}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reactivate.mutate({ userId: u.id })}
                          aria-label={t('row.reactivate')}
                        >
                          {t('row.reactivate')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {invite.error !== null && invite.error !== undefined ? (
        <p role="alert" className="text-sm text-destructive">
          {tCommon('error')}
        </p>
      ) : null}
    </div>
  );
}

interface InvitePayload {
  email: string;
  name: string;
  permissionSetId: string;
}

function InvitePanel({
  sets,
  onSubmit,
}: {
  sets: ReadonlyArray<{ id: string; name: string }>;
  onSubmit: (payload: InvitePayload) => void;
}) {
  const t = useTranslations('settings.users.invite');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            onSubmit({
              email: String(data.get('email')),
              name: String(data.get('name')),
              permissionSetId: String(data.get('permissionSetId')),
            });
            form.reset();
          }}
          className="grid grid-cols-1 gap-4 md:grid-cols-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">{t('emailLabel')}</Label>
            <Input id="invite-email" name="email" type="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">{t('nameLabel')}</Label>
            <Input id="invite-name" name="name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-set">{t('permissionSetLabel')}</Label>
            <select
              id="invite-set"
              name="permissionSetId"
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
          <div className="flex items-end">
            <Button type="submit" className="w-full">
              {t('submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
