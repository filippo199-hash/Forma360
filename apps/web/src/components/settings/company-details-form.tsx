'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { useServerErrorToast } from '../../lib/use-server-error';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

/**
 * Every field the letterhead can print, in form order. The list drives
 * the state record AND the mutation payload, so a field added here is a
 * type error until the router input knows it too.
 */
const FIELD_KEYS = [
  'legalName',
  'addressLine1',
  'addressLine2',
  'city',
  'postcode',
  'country',
  'phone',
  'email',
  'website',
  'companyNumber',
  'vatNumber',
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

export type CompanyDetailsValue = Partial<Record<FieldKey, string>>;

function seed(details: CompanyDetailsValue | null): Record<FieldKey, string> {
  const out = {} as Record<FieldKey, string>;
  for (const key of FIELD_KEYS) out[key] = details?.[key] ?? '';
  return out;
}

/**
 * Company-details editor on the Company settings page. The values feed
 * the letterhead printed on every generated document — permits, risk
 * assessments, FRAs, RAMS packs, incident reports — via
 * `tenants.updateCompanyDetails`. Empty fields simply don't print, so
 * everything here is optional. Edit controls are gated on
 * `org.settings`; the server re-checks.
 */
export function CompanyDetailsCard({ details }: { details: CompanyDetailsValue | null }) {
  const t = useTranslations('settings.company.details');
  const tCompany = useTranslations('settings.company');
  const canManage = useHasPermission('org.settings');
  const utils = trpc.useUtils();
  const onServerError = useServerErrorToast(tCompany('saveError'));

  const [values, setValues] = useState<Record<FieldKey, string>>(() => seed(details));
  useEffect(() => {
    setValues(seed(details));
  }, [details]);

  const update = trpc.tenants.updateCompanyDetails.useMutation({
    onSuccess: () => {
      void utils.tenants.get.invalidate();
      toast.success(t('saved'));
    },
    onError: onServerError,
  });

  // BUG-12: functional updater — a click landing between a keystroke and
  // its re-render must never overwrite what the user is typing.
  const set = (key: FieldKey, value: string): void => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {} as Record<FieldKey, string>;
    for (const key of FIELD_KEYS) payload[key] = values[key].trim();
    update.mutate(payload);
  }

  const field = (
    key: FieldKey,
    opts: { type?: 'email' | 'tel' | 'url'; hint?: string } = {},
  ): React.JSX.Element => (
    <div className="space-y-1.5">
      <Label htmlFor={`company-${key}`}>{t(key)}</Label>
      <Input
        id={`company-${key}`}
        value={values[key]}
        onChange={(event) => set(key, event.target.value)}
        maxLength={key === 'email' ? 254 : 200}
        disabled={!canManage}
        {...(opts.type !== undefined ? { type: opts.type } : {})}
      />
      {opts.hint !== undefined ? (
        <p className="text-xs text-muted-foreground">{opts.hint}</p>
      ) : null}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {field('legalName', { hint: t('legalNameHint') })}
          {field('addressLine1')}
          {field('addressLine2')}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field('city')}
            {field('postcode')}
          </div>
          {field('country')}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field('phone', { type: 'tel' })}
            {field('email', { type: 'email' })}
          </div>
          {field('website')}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field('companyNumber')}
            {field('vatNumber')}
          </div>
          {canManage ? (
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? t('saving') : t('save')}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
