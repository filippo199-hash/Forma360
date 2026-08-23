'use client';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@forma360/shared/password';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { PasswordInput } from './password-input';
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

/**
 * Self-service sign-up — one step, no verification ceremony.
 *
 * Name + work email + company name + password. We:
 *  a) call `auth.lookupEmailDomain` (debounced) to decide whether the
 *     email looks like a known business domain. When yes, we show a
 *     modal offering "request to join {tenant}" before they commit;
 *  b) on submit, call `auth.signUpWithTenant` which creates the
 *     tenant + administrator user + credential account row, then POST
 *     `/api/auth/sign-in/email` with the same password to mint the
 *     session cookie and land in the app. There is deliberately no
 *     emailed-code step: `emailVerified` starts false and flips the
 *     first time the account uses the OTP sign-in flow, which remains
 *     available to every user.
 *
 * If the immediate sign-in fails anyway (e.g. rate-limited), the
 * account exists and works — we fall through to the sign-in page
 * rather than stranding the user.
 */
export function SignUpCard() {
  const t = useTranslations('auth.signUp');
  const tPassword = useTranslations('auth.password');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [password, setPassword] = useState('');
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
        password,
      });

      // The account exists from here on; sign in with the password just
      // set. A failure below must not strand the user — the sign-in page
      // takes the same credentials.
      const res = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      window.location.assign(res.ok ? `/${locale}/my-work` : `/${locale}/sign-in`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('email-in-use')) {
        setError(t('emailInUseError'));
      } else if (message.includes('password-breached')) {
        setError(t('passwordBreachedError'));
      } else {
        setError(t('signUpError'));
      }
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
          <form onSubmit={onSubmitDetails} className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('intro')}</p>
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
                    href={`/${locale}/sign-in`}
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
            <div className="space-y-1.5">
              <Label htmlFor="signup-password">{t('passwordLabel')}</Label>
              <PasswordInput
                id="signup-password"
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
            <Button type="submit" className="w-full" disabled={pending || emailInUse}>
              {pending ? t('creating') : t('submit')}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t('alreadyHaveAccount')}{' '}
            <Link
              href={`/${locale}/sign-in`}
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
