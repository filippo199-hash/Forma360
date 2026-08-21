'use client';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@forma360/shared/password';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { PasswordInput } from '../auth/password-input';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';

/** Best-effort read of the route's `{ code }` error body. */
function readErrorCode(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  // Proven boundary: narrowed to a non-null object on the line above.
  const code = (payload as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : null;
}

/**
 * Settings → Profile "Password" card — how existing OTP-era accounts
 * quietly pick up a password, and where anyone changes theirs.
 *
 * Branches on `users.get`'s `hasPassword`:
 *   - none yet → one new-password field, POSTing without
 *     `currentPassword` (server refuses if a password raced in).
 *   - already set → current + new password, revoking every other
 *     session on success.
 *
 * Email codes keep working in both states — the card says so, because
 * "will this break how I sign in today?" is the first question.
 */
export function PasswordSecurityCard({
  hasPassword,
  onChanged,
}: {
  hasPassword: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('settings.profile.security');
  const tPassword = useTranslations('auth.password');
  const tCommon = useTranslations('common');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newPassword === '' || (hasPassword && currentPassword === '')) return;
    setPending(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newPassword,
          ...(hasPassword ? { currentPassword } : {}),
        }),
      });
      if (res.ok) {
        toast.success(t(hasPassword ? 'changeSuccess' : 'setSuccess'));
        setCurrentPassword('');
        setNewPassword('');
        onChanged();
        return;
      }
      if (res.status === 429) {
        setError(t('rateLimitedError'));
        return;
      }
      const code = readErrorCode(await res.json().catch(() => null));
      if (code === 'INVALID_CURRENT_PASSWORD') {
        setError(t('currentPasswordInvalid'));
      } else if (code === 'PASSWORD_COMPROMISED') {
        setError(t('passwordBreachedError'));
      } else if (code === 'PASSWORD_ALREADY_SET') {
        // Another tab beat us to it — refetch flips this card to the
        // change form.
        setError(t('error'));
        onChanged();
      } else {
        setError(t('error'));
      }
    } catch {
      setError(tCommon('error'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t(hasPassword ? 'changeIntro' : 'setIntro')}
          </p>
          {hasPassword ? (
            <div className="space-y-1.5">
              <Label htmlFor="security-current">{t('currentPasswordLabel')}</Label>
              <PasswordInput
                id="security-current"
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
                required
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="security-new">{t('newPasswordLabel')}</Label>
            <PasswordInput
              id="security-new"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              required
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
          <Button type="submit" disabled={pending}>
            {pending ? tCommon('loading') : t(hasPassword ? 'changeSubmit' : 'setSubmit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
