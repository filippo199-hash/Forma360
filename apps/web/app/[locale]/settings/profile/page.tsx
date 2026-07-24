'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { LanguageSelect } from '../../../../src/components/settings/language-select';
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

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  useEffect(() => {
    if (userGet.data !== undefined) {
      const u = userGet.data.user;
      // Seed from structured fields when present; otherwise split the
      // single name on the first space so existing users get a sensible
      // starting point.
      if (u.firstName !== null && u.firstName !== undefined) {
        setFirstName(u.firstName);
        setLastName(u.lastName ?? '');
      } else {
        const parts = u.name.trim().split(/\s+/);
        setFirstName(parts[0] ?? '');
        setLastName(parts.slice(1).join(' '));
      }
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
              updateProfile.mutate({ firstName, lastName });
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="profile-first">{t('firstNameLabel')}</Label>
                <Input
                  id="profile-first"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-last">{t('lastNameLabel')}</Label>
                <Input
                  id="profile-last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
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
                value={
                  userGet.data?.user.permissionSetName ?? userGet.data?.user.permissionSetId ?? ''
                }
                readOnly
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">{t('readOnlyNote')}</p>
            </div>
            <Button type="submit" disabled={updateProfile.isPending}>
              {tCommon('save')}
            </Button>
          </form>
        </CardContent>
      </Card>
      <LanguageSelect />
    </div>
  );
}
