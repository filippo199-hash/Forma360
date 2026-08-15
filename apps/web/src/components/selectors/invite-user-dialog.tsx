'use client';

/**
 * Minimal invite-a-user dialog for pickers (settings → users keeps the
 * full panel with groups/sites). An invitation creates no user row until
 * it is accepted, so callers can't select the person yet — the dialog
 * says so instead of pretending.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export function InviteUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('userPicker.invite');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [permissionSetId, setPermissionSetId] = useState('');
  const sets = trpc.permissions.list.useQuery(undefined, { enabled: open });
  const invite = trpc.users.invite.useMutation({
    onSuccess: () => {
      toast.success(t('sent', { email }));
      setEmail('');
      setName('');
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.data?.code === 'CONFLICT' ? t('alreadyExists') : t('error')),
  });

  const effectiveSetId = permissionSetId !== '' ? permissionSetId : (sets.data?.[0]?.id ?? '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('note')}</p>
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">{t('emailLabel')}</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">{t('nameLabel')}</Label>
            <Input
              id="invite-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-set">{t('permissionSetLabel')}</Label>
            <select
              id="invite-set"
              value={effectiveSetId}
              onChange={(e) => setPermissionSetId(e.target.value)}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {(sets.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            disabled={invite.isPending || email.trim() === '' || effectiveSetId === ''}
            onClick={() =>
              invite.mutate({
                email: email.trim().toLowerCase(),
                ...(name.trim() !== '' ? { name: name.trim() } : {}),
                permissionSetId: effectiveSetId,
              })
            }
          >
            {invite.isPending ? t('sending') : t('send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
