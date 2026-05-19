'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

type Step = 'enterEmail' | 'enterCode';

/**
 * Passwordless sign-in via email OTP.
 *
 * Two steps:
 *  1. **enterEmail** — user types their email; we POST to
 *     `/api/auth/email-otp/send-verification-otp` (sign-in type). The
 *     better-auth `emailOTP` plugin generates a 6-digit code, persists
 *     it in the verification table, and asks our `sendTemplatedEmail`
 *     dispatcher to deliver it. To avoid leaking which addresses exist
 *     we always advance to step 2 on a 2xx response, even when the
 *     email is unknown (the OTP simply won't validate).
 *
 *  2. **enterCode** — user types the 6-digit code; we POST to
 *     `/api/auth/sign-in/email-otp`. On success better-auth sets the
 *     session cookie + we hard-reload so the new session is picked up
 *     on the very next request.
 */
export function SignInCard() {
  const t = useTranslations('auth.signIn');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const [step, setStep] = useState<Step>('enterEmail');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRequestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (email.trim() === '') return;
    setPending(true);
    try {
      const res = await fetch('/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), type: 'sign-in' }),
      });
      if (!res.ok) {
        // The plugin returns the same shape for "unknown user" and
        // "rate-limited", so we surface a generic error rather than
        // leaking which addresses are registered.
        setError(t('otpSendError'));
        return;
      }
      setStep('enterCode');
    } catch {
      setError(tCommon('error'));
    } finally {
      setPending(false);
    }
  }

  async function onVerifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const trimmed = code.trim();
    if (trimmed.length === 0) return;
    setPending(true);
    try {
      const res = await fetch('/api/auth/sign-in/email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp: trimmed }),
      });
      if (!res.ok) {
        setError(t('otpInvalidError'));
        return;
      }
      // Hard navigation so the new session cookie is picked up server-side.
      window.location.assign(`/${locale}/templates`);
    } catch {
      setError(tCommon('error'));
    } finally {
      setPending(false);
    }
  }

  async function onResendCode() {
    setError(null);
    setPending(true);
    try {
      await fetch('/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), type: 'sign-in' }),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {step === 'enterEmail' ? (
          <form onSubmit={onRequestCode} className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('otpIntro')}</p>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('emailLabel')}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder={t('emailPlaceholder')}
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
              {pending ? tCommon('loading') : t('sendCode')}
            </Button>
          </form>
        ) : (
          <form onSubmit={onVerifyCode} className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('otpSentTo', { email })}</p>
            <div className="space-y-1.5">
              <Label htmlFor="otp">{t('codeLabel')}</Label>
              <Input
                id="otp"
                name="otp"
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
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep('enterEmail');
                  setCode('');
                  setError(null);
                }}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                {t('changeEmail')}
              </button>
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
          {t('noAccountQuestion')}{' '}
          <Link
            href={`/${locale}/sign-up`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t('signUpLink')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
