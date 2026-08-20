'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

/**
 * Step 1 of the reset flow: ask for the account email and request a
 * reset link from `/api/auth/request-password-reset`.
 *
 * The server answers 200 with the same body whether or not the address
 * exists (enumeration protection, with timing mitigation server-side),
 * so the success state is worded "if an account exists". `redirectTo`
 * sends the emailed link back to this locale's reset page.
 *
 * This flow doubles as "set my first password" for accounts created in
 * the OTP-only era: the reset exchange creates the credential row when
 * none exists yet.
 */
export function ForgotPasswordCard() {
  const t = useTranslations('auth.forgotPassword');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (email.trim() === '') return;
    setPending(true);
    try {
      const res = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          redirectTo: `/${locale}/reset-password`,
        }),
      });
      if (res.status === 429) {
        setError(t('rateLimitedError'));
        return;
      }
      if (!res.ok) {
        setError(t('error'));
        return;
      }
      setSent(true);
    } catch {
      setError(tCommon('error'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{sent ? t('sentTitle') : t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {sent ? (
          <p className="text-sm text-muted-foreground">{t('sentBody', { email: email.trim() })}</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('intro')}</p>
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email">{t('emailLabel')}</Label>
              <Input
                id="forgot-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </div>
            {error !== null ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? tCommon('loading') : t('submit')}
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link
            href={`/${locale}/sign-in`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t('backToSignIn')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
