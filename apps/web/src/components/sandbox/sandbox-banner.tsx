'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
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
 * The save prompt for a try-it-now workspace (ADR 0017).
 *
 * Shown only while the workspace is an *unclaimed* sandbox — a fact the
 * server shell already resolved, so this costs an ordinary user nothing
 * and never renders for them. It is a prompt, never a gate: the work is
 * already saved, and everything stays usable whether or not the visitor
 * hands over an address. What the email buys them is the way back,
 * which is exactly how the copy frames it.
 *
 * A single field is required. Name and company are offered because both
 * end up on the documents they generate, but neither blocks the save.
 */
export function SandboxBanner() {
  const t = useTranslations('sandbox');
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const claim = trpc.sandbox.claim.useMutation();

  if (dismissed) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      const result = await claim.mutateAsync({
        email: email.trim(),
        ...(name.trim() !== '' ? { name: name.trim() } : {}),
        ...(companyName.trim() !== '' ? { companyName: companyName.trim() } : {}),
      });

      // Same OTP send the ordinary sign-up flow uses — the code in their
      // inbox is what brings them back, so there is no second kind of
      // return link to maintain.
      await fetch('/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), type: 'sign-in' }),
      }).catch(() => undefined);

      toast.success(t('success'));
      if (result.existingTenant !== null) {
        toast.info(t('joinHint', { name: result.existingTenant.name }));
      }
      setOpen(false);
      setDismissed(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      toast.error(message.includes('email-in-use') ? t('errorInUse') : t('errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b bg-accent/60 px-4 py-2.5 text-sm">
        <span className="font-medium">{t('bannerTitle')}</span>
        <span className="text-muted-foreground">{t('bannerBody')}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => setOpen(true)}>
            {t('bannerCta')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            {t('dismiss')}
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={(e) => void onSubmit(e)}>
            <DialogHeader>
              <DialogTitle>{t('title')}</DialogTitle>
              <DialogDescription>{t('body')}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="sandbox-email">{t('emailLabel')}</Label>
                <Input
                  id="sandbox-email"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sandbox-name">
                  {t('nameLabel')} <span className="text-muted-foreground">({t('optional')})</span>
                </Label>
                <Input id="sandbox-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sandbox-company">
                  {t('companyLabel')}{' '}
                  <span className="text-muted-foreground">({t('optional')})</span>
                </Label>
                <Input
                  id="sandbox-company"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={submitting || email.trim() === ''}>
                {t('submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
