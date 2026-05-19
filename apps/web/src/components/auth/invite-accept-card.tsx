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

interface InviteAcceptCardProps {
  token: string;
}

type Step = 'accept' | 'enterCode';

/**
 * Renders the invite accept flow:
 *   - loading → skeleton
 *   - not-found / expired / accepted → terminal state with a link home
 *   - active → two-step form:
 *       1. confirm name → POST `auth.acceptInvite` (creates user row,
 *          stamps the invite as accepted); then immediately fire the
 *          OTP send for the invite email.
 *       2. enter the 6-digit code from the email → POST
 *          `/api/auth/sign-in/email-otp` to mint the session cookie.
 *
 * The invite token itself is the proof of ownership of the inbox, so
 * step 2 is mostly a "let's verify they read the email" moment. We do
 * still require it because better-auth's session cookie is only set by
 * the OTP exchange.
 */
export function InviteAcceptCard({ token }: InviteAcceptCardProps) {
  const t = useTranslations('auth.invite');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const inviteQuery = trpc.auth.getInviteDetails.useQuery({ token });
  const accept = trpc.auth.acceptInvite.useMutation();

  const [step, setStep] = useState<Step>('accept');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
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
        ...(name.length > 0 ? { name } : {}),
      });
      const otpRes = await fetch('/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: invite.email, type: 'sign-in' }),
      });
      if (!otpRes.ok) {
        setError(t('error'));
        return;
      }
      setStep('enterCode');
    } catch {
      setError(t('error'));
    } finally {
      setPending(false);
    }
  }

  async function onVerifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (invite === undefined || invite === null) return;
    const trimmed = code.trim();
    if (trimmed.length === 0) return;
    setPending(true);
    try {
      const res = await fetch('/api/auth/sign-in/email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: invite.email, otp: trimmed }),
      });
      if (!res.ok) {
        setError(t('otpInvalidError'));
        return;
      }
      window.location.assign(`/${locale}/templates`);
    } catch {
      setError(t('error'));
    } finally {
      setPending(false);
    }
  }

  async function onResendCode() {
    if (invite === undefined || invite === null) return;
    setError(null);
    setPending(true);
    try {
      await fetch('/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: invite.email, type: 'sign-in' }),
      });
    } finally {
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
        {step === 'accept' ? (
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
            {error !== null ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? t('accepting') : t('acceptButton')}
            </Button>
          </form>
        ) : (
          <form onSubmit={onVerifyCode} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('otpSentTo', { email: invite.email })}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="invite-otp">{t('codeLabel')}</Label>
              <Input
                id="invite-otp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                required
                maxLength={6}
                minLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                autoFocus
                className="text-center text-lg tracking-widest"
              />
            </div>
            {error !== null ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending || code.length < 6}>
              {pending ? tCommon('loading') : t('verifyCode')}
            </Button>
            <div className="flex items-center justify-end text-sm">
              <button
                type="button"
                onClick={onResendCode}
                disabled={pending}
                className="text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
              >
                {t('resendCode')}
              </button>
            </div>
          </form>
        )}
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
