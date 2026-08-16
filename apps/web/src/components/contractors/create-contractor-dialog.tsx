'use client';

/**
 * NR3-03: the create-contractor form state used to live in the always-
 * mounted register page, and the only reset ran in create.onSuccess. A
 * Cancel/Escape kept the typed text, and on reopen autofocus dropped the
 * caret into the pre-filled input — retyping produced
 * "Test Roofing CoTest Roofing Co" in the register. Every close path now
 * goes through `handleOpenChange`, which clears the form.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { contractorErrorMessage } from '../../lib/contractor-errors';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

interface CreateContractorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateContractorDialog({ open, onOpenChange }: CreateContractorDialogProps) {
  const t = useTranslations('contractors');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  function resetForm() {
    setName('');
    setCategory('');
    setContactName('');
    setContactEmail('');
  }

  // Cancel button, Escape, the X and the overlay all land here.
  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  const create = trpc.contractors.create.useMutation({
    onSuccess: () => {
      toast.success(t('createdToast'));
      void utils.contractors.list.invalidate();
      resetForm();
      onOpenChange(false);
    },
    onError: (err) => toast.error(contractorErrorMessage(err.message, t)),
  });

  function submit() {
    if (name.trim() === '') return;
    create.mutate({
      name: name.trim(),
      category: category.trim() === '' ? null : category.trim(),
      primaryContactName: contactName.trim() === '' ? null : contactName.trim(),
      primaryContactEmail: contactEmail.trim() === '' ? null : contactEmail.trim(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">{t('fieldName')}</Label>
            <Input
              id="c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-cat">{t('fieldCategory')}</Label>
            <Input
              id="c-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-contact">{t('fieldContactName')}</Label>
              <Input
                id="c-contact"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email">{t('fieldContactEmail')}</Label>
              <Input
                id="c-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                maxLength={200}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={submit} disabled={create.isPending || name.trim() === ''}>
            {t('createButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
