'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { PasswordInput } from '../auth/password-input';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { safeNextPath } from '../../lib/sign-in-redirect';

type Method = 'password' | 'otp';
type OtpStep = 'enterEmail' | 'enterCode';

/** True when `payload` is an object whose `key` is exactly `true`. */
function readBooleanFlag(payload: unknown, key: string): boolean {
  if (payload === null || typeof payload !== 'object') return false;
  // Proven boundary: narrowed to a non-null object on the line above.
  return (payload as Record<string, unknown>)[key] === true;
}

/**
 * Sign-in — password first, one-time code one click away.
 *
 * **password** (default): email + password POSTed to
 * `/api/auth/sign-in/email`. 401 renders a generic "didn't match" (the
 * server never says which half was wrong); 403 means the password was
 * RIGHT but the inbox was never verified (a sign-up that stopped before
 * the code step), so we send a code and drop the user into the OTP code
 * step to finish verification — the exchange both verifies and signs in.
 *
 * **otp**: the original passwordless two-step. Every account can always
 * sign in this way, password or not.
 *
 *  1. **enterEmail** — POST `/api/auth/email-otp/send-verification-otp`
 *     (sign-in type). To avoid leaking which addresses exist we always
 *     advance to step 2 on a 2xx response, even when the email is
 *     unknown (the OTP simply won't validate).
 *  2. **enterCode** — POST `/api/auth/sign-in/email-otp`. On success
 *     better-auth sets the session cookie + we hard-reload so the new
 *     session is picked up on the very next request.
 */
export function SignInCard({ next = null }: { next?: string | null }) {
  const t = useTranslations('auth.signIn');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const [method, setMethod] = useState<Method>('password');
  const [otpStep, setOtpStep] = useState<OtpStep>('enterEmail');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function requestOtp(): Promise<boolean> {
    const res = await fetch('/api/auth/email-otp/send-verification-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), type: 'sign-in' }),
    });
    return res.ok;
  }

  async function onPasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (email.trim() === '' || password === '') return;
    setPending(true);
    try {
      const res = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      if (res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        // No UI ships 2FA enrolment yet, so no account can legitimately be
        // in this state — but navigating would silently drop the user back
        // here without a session. Fail loudly instead.
        if (readBooleanFlag(payload, 'twoFactorRedirect')) {
          setError(tCommon('error'));
          return;
        }
        // Hard navigation so the new session cookie is picked up
        // server-side; `next` preserves a deep link (S9.6), guarded
        // against open-redirect.
        window.location.assign(safeNextPath(next, locale));
        return;
      }
      if (res.status === 403) {
        // Correct password, unverified inbox — finish sign-up's missing
        // verification step through the OTP flow.
        const sent = await requestOtp();
        if (sent) {
          setMethod('otp');
          setOtpStep('enterCode');
          setNotice(t('verifyEmailFirst', { email: email.trim() }));
        } else {
          setError(t('otpSendError'));
        }
        return;
      }
      if (res.status === 429) {
        setError(t('rateLimitedError'));
        return;
      }
      // 401 and anything else: deliberately generic — the server does not
      // reveal whether the address exists or which half didn't match.
      setError(t('passwordInvalidError'));
    } catch {
      setError(tCommon('error'));
    } finally {
      setPending(false);
    }
  }

  async function onRequestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (email.trim() === '') return;
    setPending(true);
    try {
      const sent = await requestOtp();
      if (!sent) {
        // The plugin returns the same shape for "unknown user" and
        // "rate-limited", so we surface a generic error rather than
        // leaking which addresses are registered.
        setError(t('otpSendError'));
        return;
      }
      setOtpStep('enterCode');
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
      window.location.assign(safeNextPath(next, locale));
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
      await requestOtp();
    } finally {
      setPending(false);
    }
  }

  function switchMethod(to: Method) {
    setMethod(to);
    setOtpStep('enterEmail');
    setCode('');
    setError(null);
    setNotice(null);
  }

  const errorLine =
    error !== null ? (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    ) : null;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {method === 'password' ? (
          <form onSubmit={onPasswordSubmit} className="space-y-4">
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
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t('passwordLabel')}</Label>
                <Link
                  href={`/${locale}/forgot-password`}
                  className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                >
                  {t('forgotPasswordLink')}
                </Link>
              </div>
              <PasswordInput
                id="password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                required
              />
            </div>
            {errorLine}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? tCommon('loading') : t('signInButton')}
            </Button>
            <div className="relative">
              <div className="absolute inset-0 flex items-center" aria-hidden>
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">{t('orDivider')}</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => switchMethod('otp')}
            >
              {t('otpOption')}
            </Button>
          </form>
        ) : otpStep === 'enterEmail' ? (
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
            {errorLine}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? tCommon('loading') : t('sendCode')}
            </Button>
            <button
              type="button"
              onClick={() => switchMethod('password')}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              {t('passwordOption')}
            </button>
          </form>
        ) : (
          <form onSubmit={onVerifyCode} className="space-y-4">
            {notice !== null ? (
              <p role="status" className="text-sm text-muted-foreground">
                {notice}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('otpSentTo', { email })}</p>
            )}
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
            {errorLine}
            <Button type="submit" className="w-full" disabled={pending || code.length < 6}>
              {pending ? tCommon('loading') : t('verifyCode')}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setOtpStep('enterEmail');
                  setCode('');
                  setError(null);
                  setNotice(null);
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
