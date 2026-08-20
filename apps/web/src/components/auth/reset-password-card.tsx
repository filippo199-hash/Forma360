'use client';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@forma360/shared/password';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { PasswordInput } from './password-input';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';

/** Best-effort read of better-auth's `{ code }` error body. */
function readErrorCode(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  // Proven boundary: narrowed to a non-null object on the line above.
  const code = (payload as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : null;
}

/**
 * Step 2 of the reset flow. The emailed link went through better-auth's
 * `GET /reset-password/:token`, which validated the token and redirected
 * here with `?token=` (or `?error=INVALID_TOKEN` — the page renders the
 * dead-link state for that before mounting this card).
 *
 * POSTs `/api/auth/reset-password` with the new password + token. On
 * success every session is revoked server-side, so the card links to
 * sign-in rather than into the app.
 */
export function ResetPasswordCard({ token }: { token: string }) {
  const t = useTranslations('auth.resetPassword');
  const tPassword = useTranslations('auth.password');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [invalidToken, setInvalidToken] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password === '') return;
    setPending(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: password, token }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const code = readErrorCode(await res.json().catch(() => null));
      if (code === 'PASSWORD_COMPROMISED') {
        setError(t('passwordBreachedError'));
      } else if (code === 'INVALID_TOKEN') {
        // The 30-minute window closed between page load and submit.
        setInvalidToken(true);
      } else {
        setError(t('error'));
      }
    } catch {
      setError(tCommon('error'));
    } finally {
      setPending(false);
    }
  }

  if (invalidToken) {
    return <ResetLinkInvalidCard />;
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{done ? t('successTitle') : t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {done ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('successBody')}</p>
            <Button asChild className="w-full">
              <Link href={`/${locale}/sign-in`}>{t('goToSignIn')}</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">{t('passwordLabel')}</Label>
              <PasswordInput
                id="reset-password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                required
                autoFocus
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
              />
              <p className="text-xs text-muted-foreground">
                {tPassword('minLengthHint', { min: PASSWORD_MIN_LENGTH })}
              </p>
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
      </CardContent>
    </Card>
  );
}

/**
 * Dead-link state — rendered by the page when the URL carries
 * `?error=INVALID_TOKEN` (or no token at all), and by the card when the
 * token expires between load and submit.
 */
export function ResetLinkInvalidCard() {
  const t = useTranslations('auth.resetPassword');
  const locale = useLocale();
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t('invalidTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('invalidBody')}</p>
        <Button asChild className="w-full">
          <Link href={`/${locale}/forgot-password`}>{t('requestNew')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
