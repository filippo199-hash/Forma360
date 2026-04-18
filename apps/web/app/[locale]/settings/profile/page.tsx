'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * Standard-user profile page (S-09). Every user can read their row;
 * only the `name` field is editable here — permission set assignment
 * is admin-only (ADR 0002). Email, group/site memberships are
 * read-only placeholders; editing them requires the admin routers.
 */
export default function ProfilePage() {
  const t = useTranslations('settings.profile');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();

  const meQuery = trpc.health.me.useQuery();
  const userGet = trpc.users.get.useQuery(
    { id: meQuery.data?.userId ?? '' },
    { enabled: meQuery.data !== undefined },
  );
  const updateProfile = trpc.users.updateProfile.useMutation({
    onSuccess: () => {
      void utils.users.get.invalidate();
    },
  });

  const [name, setName] = useState('');
  useEffect(() => {
    if (userGet.data !== undefined) {
      setName(userGet.data.user.name);
    }
  }, [userGet.data]);

  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>{tCommon('name')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateProfile.mutate({ name });
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">{t('nameLabel')}</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-email">{t('emailLabel')}</Label>
              <Input
                id="profile-email"
                value={userGet.data?.user.email ?? ''}
                readOnly
                className="bg-muted"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-set">{t('permissionSetLabel')}</Label>
              <Input
                id="profile-set"
                value={userGet.data?.user.permissionSetId ?? ''}
                readOnly
                className="bg-muted font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">{t('readOnlyNote')}</p>
            </div>
            <Button type="submit" disabled={updateProfile.isPending}>
              {tCommon('save')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
