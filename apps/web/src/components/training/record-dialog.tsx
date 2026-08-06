'use client';

/**
 * Record a completion (FreeHS B7).
 *
 * Whitfield's constraint governs this form: *"Add a record in under a
 * minute, from a phone: person, card type, number, expiry, photograph.
 * If it takes longer than photographing the card and typing an expiry
 * date, I won't keep it current — and a stale matrix is worse than
 * none."* So the required set is four fields, everything else is
 * optional and collapsed, and the expiry fills itself in from the
 * requirement's validity period unless you overrule it.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { trpc } from '../../lib/trpc/client';

export interface RecordPrefill {
  requirementId?: string;
  personName?: string;
  userId?: string | null;
}

export function RecordDialog({
  open,
  onOpenChange,
  prefill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: RecordPrefill | undefined;
}) {
  const t = useTranslations('training.record');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();

  const { data: requirements } = trpc.training.listRequirements.useQuery({});
  const { data: usersData } = trpc.users.list.useQuery({});

  const [requirementId, setRequirementId] = useState('');
  const [userId, setUserId] = useState('');
  const [personName, setPersonName] = useState('');
  const [achievedAt, setAchievedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [awardingBody, setAwardingBody] = useState('');
  const [certificateNumber, setCertificateNumber] = useState('');

  // Re-seed whenever the dialog opens from a gap row, so "record the fix"
  // lands on the right person and requirement without retyping them.
  useEffect(() => {
    if (!open) return;
    setRequirementId(prefill?.requirementId ?? '');
    setUserId(prefill?.userId ?? '');
    setPersonName(prefill?.personName ?? '');
    setAchievedAt(new Date().toISOString().slice(0, 10));
    setExpiresAt('');
    setAwardingBody('');
    setCertificateNumber('');
  }, [open, prefill?.requirementId, prefill?.personName, prefill?.userId]);

  const addRecord = trpc.training.addRecord.useMutation({
    onSuccess: () => {
      toast.success(t('saved'));
      void utils.training.gaps.invalidate();
      void utils.training.matrix.invalidate();
      void utils.training.compliance.invalidate();
      onOpenChange(false);
    },
    onError: () => toast.error(tCommon('error')),
  });

  const selectedUser = (usersData?.users ?? []).find((u) => u.id === userId);
  const resolvedName = selectedUser?.name ?? personName;
  const ready = requirementId !== '' && resolvedName.trim() !== '' && achievedAt !== '';

  function submit() {
    if (!ready) return;
    addRecord.mutate({
      requirementId,
      userId: userId === '' ? null : userId,
      personName: resolvedName.trim(),
      personCategory: userId === '' ? 'contractor' : 'employee',
      achievedAt,
      // Omitting `expiresAt` lets the server derive it from the
      // requirement's validity period — the common case.
      ...(expiresAt !== '' ? { expiresAt } : {}),
      awardingBody: awardingBody.trim() === '' ? null : awardingBody.trim(),
      certificateNumber: certificateNumber.trim() === '' ? null : certificateNumber.trim(),
      source: 'external',
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="training-requirement">{t('requirement')}</Label>
            <select
              id="training-requirement"
              value={requirementId}
              onChange={(e) => setRequirementId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">—</option>
              {(requirements ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="training-user">{t('person')}</Label>
            <select
              id="training-user"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">—</option>
              {(usersData?.users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            {/* Half the people on a site are not on the payroll — a matrix
                that only covers employees does not cover the site. */}
            {userId === '' ? (
              <Input
                value={personName}
                onChange={(e) => setPersonName(e.target.value)}
                placeholder={t('person')}
                className="mt-1"
              />
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="training-achieved">{t('achievedAt')}</Label>
              <Input
                id="training-achieved"
                type="date"
                value={achievedAt}
                onChange={(e) => setAchievedAt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="training-expires">{t('expiresAt')}</Label>
              <Input
                id="training-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">{t('expiryAuto')}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="training-body">{t('awardingBody')}</Label>
              <Input
                id="training-body"
                value={awardingBody}
                onChange={(e) => setAwardingBody(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="training-cert">{t('certificateNumber')}</Label>
              <Input
                id="training-cert"
                value={certificateNumber}
                onChange={(e) => setCertificateNumber(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={submit} disabled={!ready || addRecord.isPending}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
