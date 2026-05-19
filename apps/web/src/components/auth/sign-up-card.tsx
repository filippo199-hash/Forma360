'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

type Step = 'enterDetails' | 'enterCode';

/**
 * Self-service sign-up — passwordless.
 *
 * 1. **enterDetails** — name + work email + company name. We:
 *    a) call `auth.lookupEmailDomain` (debounced) to decide whether the
 *       email looks like a known business domain. When yes, we show a
 *       modal offering "request to join {tenant}" before they commit;
 *    b) on submit, call `auth.signUpWithTenant` which creates the
 *       tenant + administrator user (no password — Forma360 is
 *       passwordless). The user row starts with `emailVerified=false`;
 *       the OTP exchange in step 2 flips it.
 *    c) immediately POST to `/api/auth/email-otp/send-verification-otp`
 *       to send the 6-digit sign-in code.
 *
 * 2. **enterCode** — user types the code from their inbox; we POST to
 *    `/api/auth/sign-in/email-otp` which sets the session cookie. We
 *    then hard-navigate into the app.
 */
export function SignUpCard() {
  const t = useTranslations('auth.signUp');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const [step, setStep] = useState<Step>('enterDetails');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [createSeparate, setCreateSeparate] = useState(false);

  // Debounce the email used for the lookup so we don't fire on every
  // keystroke. Half a second is enough to feel responsive while keeping
  // the network calls modest.
  const [debouncedEmail, setDebouncedEmail] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedEmail(email);
    }, 500);
    return () => clearTimeout(handle);
  }, [email]);

  const lookupEnabled =
    debouncedEmail.length > 6 && debouncedEmail.includes('@') && debouncedEmail.includes('.');

  const lookup = trpc.auth.lookupEmailDomain.useQuery(
    { email: debouncedEmail },
    {
      enabled: lookupEnabled,
      staleTime: 30_000,
    },
  );

  // Auto-prompt the join modal when the lookup says "business domain we
  // know about, and your email is free". Only once per email — the
  // `createSeparate` flag keeps it from re-opening after the user
  // dismisses it.
  useEffect(() => {
    if (
      !createSeparate &&
      lookup.data !== undefined &&
      lookup.data.status === 'business' &&
      lookup.data.existingTenant !== null &&
      !lookup.data.emailExists
    ) {
      setShowJoinModal(true);
    }
  }, [lookup.data, createSeparate]);

  // Reset the "create separate" decision whenever the email changes so
  // the modal can re-appear for a new domain.
  useEffect(() => {
    setCreateSeparate(false);
  }, [debouncedEmail]);

  const emailInUse = lookup.data?.emailExists === true;

  const signUp = trpc.auth.signUpWithTenant.useMutation();
  const requestToJoin = trpc.auth.requestToJoin.useMutation();

  async function onSubmitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (emailInUse) {
      setError(t('emailInUseError'));
      return;
    }

    setPending(true);
    try {
      await signUp.mutateAsync({
        email: email.trim().toLowerCase(),
        name: name.trim(),
        companyName: companyName.trim(),
      });

      // Kick off the OTP send. Don't await the response shape — the
      // plugin returns the same envelope whether or not the user exists.
      const otpRes = await fetch('/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), type: 'sign-in' }),
      });
      if (!otpRes.ok) {
        setError(t('otpSendError'));
        setPending(false);
        return;
      }
      setStep('enterCode');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('email-in-use')) {
        setError(t('emailInUseError'));
      } else {
        setError(t('signUpError'));
      }
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
      window.location.assign(`/${locale}/templates`);
    } catch {
      setError(t('signUpError'));
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

  async function onRequestToJoin() {
    if (lookup.data?.existingTenant === null || lookup.data?.existingTenant === undefined) {
      return;
    }
    const tenant = lookup.data.existingTenant;
    try {
      await requestToJoin.mutateAsync({
        tenantId: tenant.id,
        requesterEmail: email,
        requesterName: name.length > 0 ? name : (email.split('@')[0] ?? email),
      });
      toast.success(t('joinRequestSuccess', { tenantName: tenant.name }));
      setShowJoinModal(false);
      setCreateSeparate(true);
    } catch {
      toast.error(t('signUpError'));
    }
  }

  function onCreateSeparate() {
    setCreateSeparate(true);
    setShowJoinModal(false);
  }

  const existingTenantName = lookup.data?.existingTenant?.name ?? '';

  return (
    <>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {step === 'enterDetails' ? (
            <form onSubmit={onSubmitDetails} className="space-y-4">
              <p className="text-sm text-muted-foreground">{t('otpIntro')}</p>
              <div className="space-y-1.5">
                <Label htmlFor="signup-name">{t('nameLabel')}</Label>
                <Input
                  id="signup-name"
                  name="name"
                  type="text"
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-email">{t('emailLabel')}</Label>
                <Input
                  id="signup-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                {emailInUse ? (
                  <p role="alert" className="text-sm text-destructive">
                    {t('emailInUseError')}{' '}
                    <Link
                      href={`/${locale}`}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {t('signInLink')}
                    </Link>
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-company">{t('companyLabel')}</Label>
                <Input
                  id="signup-company"
                  name="companyName"
                  type="text"
                  required
                  autoComplete="organization"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                />
              </div>
              {error !== null ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={pending || emailInUse}>
                {pending ? t('creating') : t('submit')}
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
                    setStep('enterDetails');
                    setCode('');
                    setError(null);
                  }}
                  className="text-muted-foreground hover:text-foreground hover:underline"
                >
                  {t('changeDetails')}
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
            {t('alreadyHaveAccount')}{' '}
            <Link
              href={`/${locale}`}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {t('signInLink')}
            </Link>
          </p>
        </CardContent>
      </Card>

      <Dialog open={showJoinModal} onOpenChange={setShowJoinModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('joinModalTitle', { tenantName: existingTenantName })}</DialogTitle>
            <DialogDescription>
              {t('joinModalBody', { tenantName: existingTenantName })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onCreateSeparate} disabled={requestToJoin.isPending}>
              {t('createSeparateButton')}
            </Button>
            <Button onClick={onRequestToJoin} disabled={requestToJoin.isPending}>
              {requestToJoin.isPending ? tCommon('loading') : t('joinButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
