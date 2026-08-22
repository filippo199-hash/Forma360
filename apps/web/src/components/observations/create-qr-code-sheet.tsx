'use client';

/**
 * CreateQrCodeSheet — side-sheet for generating a new public QR code
 * against an existing observation category. Each category can carry at
 * most one share token at a time (`issue_categories.public_share_token`
 * is unique). The picker only shows categories that don't already have
 * a token — once every category has one, the form prompts the admin to
 * revoke an existing QR code or create a new category first.
 *
 * Calls `trpc.issues.categories.generateShareToken` on submit and hands
 * the returned token back to the parent via `onCreated` so the parent
 * can immediately open the "Show QR code" dialog. The sheet does NOT
 * close itself on error; the parent's toast surfaces the failure.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { useServerErrorToast } from '../../lib/use-server-error';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet';

interface CategoryOption {
  id: string;
  name: string;
}

interface CreateQrCodeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableCategories: ReadonlyArray<CategoryOption>;
  /** Called after the generateShareToken mutation succeeds. */
  onCreated: (token: string, categoryId: string) => void | Promise<void>;
}

export function CreateQrCodeSheet({
  open,
  onOpenChange,
  availableCategories,
  onCreated,
}: CreateQrCodeSheetProps) {
  const t = useTranslations('issues.qrCodes.createSheet');
  const tToast = useTranslations('issues.qrCodes.toast');
  const onServerError = useServerErrorToast(tToast('error'));
  const [categoryId, setCategoryId] = useState('');

  // Reset the selection whenever the sheet (re-)opens. Otherwise stale
  // state can persist across category-pool changes.
  useEffect(() => {
    if (open) setCategoryId('');
  }, [open]);

  const generate = trpc.issues.categories.generateShareToken.useMutation({
    onSuccess: async (result, variables) => {
      toast.success(tToast('created'));
      onOpenChange(false);
      await onCreated(result.token, variables.categoryId);
    },
    onError: onServerError,
  });

  const canSubmit = categoryId !== '' && !generate.isPending;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    generate.mutate({ categoryId });
  }

  const noneAvailable = availableCategories.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('about')}</SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} className="mt-6 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="qr-category">{t('categoryLabel')}</Label>
            <select
              id="qr-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              disabled={noneAvailable}
              required
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">{t('categoryPlaceholder')}</option>
              {availableCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{t('categoryHelp')}</p>
          </div>

          {noneAvailable ? (
            <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
              {t('noAvailable')}
            </div>
          ) : null}

          <SheetFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {t('create')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
