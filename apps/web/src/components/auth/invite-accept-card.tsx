'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Skeleton } from '../ui/skeleton';

const MIN_PASSWORD_LENGTH = 12;

interface InviteAcceptCardProps {
  token: string;
}

/**
 * Renders the invite accept flow:
 *   - loading → skeleton
 *   - not-found / expired / accepted → terminal state with a link home
 *   - active → form with pre-filled email + name + password.
 *
 * On success we POST to `/api/auth/sign-in/email` to mint the session
 * cookie before hard-navigating to /templates.
 */
export function InviteAcceptCard({ token }: InviteAcceptCardProps) {
  const t = useTranslations('auth.invite');
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (invite === undefined || invite === null) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('passwordHint'));
      return;
    }
    setPending(true);
    try {
      await accept.mutateAsync({
        token,
        password,
        ...(name.length > 0 ? { name } : {}),
      });
      const res = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: invite.email, password }),
      });
      if (!res.ok) {
        setError(t('error'));
        setPending(false);
        return;
      }
      window.location.assign(`/${locale}/templates`);
    } catch {
      setError(t('error'));
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
        <form onSubmit={onSubmit} className="space-y-4">
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
            <Input
              id="invite-password"
              type="password"
              required
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
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
