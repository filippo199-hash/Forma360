'use client';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@forma360/shared/password';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { trpc } from '../../lib/trpc/client';
import { PasswordInput } from './password-input';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Skeleton } from '../ui/skeleton';

interface InviteAcceptCardProps {
  token: string;
}

/**
 * Renders the invite accept flow:
 *   - loading → skeleton
 *   - not-found / expired / accepted → terminal state with a link home
 *   - active → one form: confirm name + choose a password →
 *     `auth.acceptInvite` creates the user row (verified — clicking the
 *     emailed token already proved the inbox) plus its credential
 *     account row, then we POST `/api/auth/sign-in/email` with the same
 *     password to mint the session cookie and land in the app. No OTP
 *     step: the token was the proof, and the password sets the cookie.
 *
 * If that immediate sign-in fails anyway (e.g. rate-limited), the
 * account exists and works — we fall through to the sign-in page rather
 * than stranding the user on a half-done screen.
 */
export function InviteAcceptCard({ token }: InviteAcceptCardProps) {
  const t = useTranslations('auth.invite');
  const tPassword = useTranslations('auth.password');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const inviteQuery = trpc.auth.getInviteDetails.useQuery({ token });
  const accept = trpc.auth.acceptInvite.useMutation();

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (inviteQuery.data !== undefined && inviteQuery.data !== null) {
      setName(inviteQuery.data.name ?? '');
    }
  }, [inviteQuery.data]);

  if (inviteQuery.isLoading) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <Skeleton className="h-6 w-3/4" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  const invite = inviteQuery.data;
  if (invite === undefined || invite === null) {
    return <TerminalState titleKey="notFoundTitle" bodyKey="notFoundBody" locale={locale} />;
  }
  if (invite.status === 'expired') {
    return <TerminalState titleKey="expiredTitle" bodyKey="expiredBody" locale={locale} />;
  }
  if (invite.status === 'accepted') {
    return <TerminalState titleKey="acceptedTitle" bodyKey="acceptedBody" locale={locale} />;
  }

  async function onAccept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (invite === undefined || invite === null) return;
    setPending(true);
    try {
      await accept.mutateAsync({
        token,
        password,
        ...(name.length > 0 ? { name } : {}),
      });
      // The account exists from here on; sign in with the password just
      // set. A failure below must not strand the user — the sign-in page
      // takes the same credentials.
      const res = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: invite.email, password }),
      });
      window.location.assign(res.ok ? `/${locale}/ai` : `/${locale}/sign-in`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(message.includes('password-breached') ? t('passwordBreachedError') : t('error'));
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          {t('title', {
            inviterName: invite.inviterName,
            tenantName: invite.tenantName,
          })}
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={onAccept} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">{t('emailLabel')}</Label>
            <Input
              id="invite-email"
              type="email"
              value={invite.email}
              readOnly
              className="bg-muted"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">{t('nameLabel')}</Label>
            <Input
              id="invite-name"
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-password">{t('passwordLabel')}</Label>
            <PasswordInput
              id="invite-password"
              value={password}
              onChange={setPassword}
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
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? t('accepting') : t('acceptButton')}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link
            href={`/${locale}`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t('backToSignIn')}
          </Link>{' '}
          · {tCommon('back')}
        </p>
      </CardContent>
    </Card>
  );
}

function TerminalState({
  titleKey,
  bodyKey,
  locale,
}: {
  titleKey: 'expiredTitle' | 'acceptedTitle' | 'notFoundTitle';
  bodyKey: 'expiredBody' | 'acceptedBody' | 'notFoundBody';
  locale: string;
}) {
  const t = useTranslations('auth.invite');
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t(titleKey)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t(bodyKey)}</p>
        <Link
          href={`/${locale}`}
          className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t('backToSignIn')}
        </Link>
      </CardContent>
    </Card>
  );
}
