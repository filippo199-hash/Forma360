'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

/**
 * Sign-in form. Posts to better-auth's /api/auth/sign-in/email endpoint.
 * Phase 0 deliberately uses fetch directly rather than better-auth's React
 * client so we keep the footprint minimal; the richer sign-up / MFA flows
 * land in Phase 1 with the full auth client.
 */
export function SignInCard() {
  const t = useTranslations('auth.signIn');
  const tCommon = useTranslations('common');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const data = new FormData(event.currentTarget);
    try {
      const res = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.get('email'),
          password: data.get('password'),
        }),
      });
      if (!res.ok) {
        setError(tCommon('error'));
        return;
      }
      // better-auth sets the session cookie; navigating reloads the
      // session on the server side.
      window.location.reload();
    } catch {
      setError(tCommon('error'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        {/*
         * Self-serve sign-up is intentionally disabled during the private
         * demo — new tenants are provisioned via the bootstrap-tenant
         * script (see packages/db/src/scripts/bootstrap-tenant.ts) and new
         * users come in through the invite flow. Re-enable this card's
         * "Sign up" link once the signup-creates-tenant page lands.
         */}
        <CardDescription>{t('inviteOnly')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('emailLabel')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder={t('emailPlaceholder')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{t('passwordLabel')}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder={t('passwordPlaceholder')}
            />
          </div>
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? tCommon('loading') : t('submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
