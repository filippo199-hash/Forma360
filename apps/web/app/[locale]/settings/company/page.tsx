'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * Company-level settings. Admin-only — the parent layout already
 * gates `/settings/*` so we just need to wire the form against
 * `tenants.get` / `tenants.update`. Slug is read-only with a copy
 * button so admins can grab their tenant slug for shared links;
 * member count + plan are read-only display only.
 */
export default function CompanyPage() {
  const t = useTranslations('settings.company');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();

  const tenantQuery = trpc.tenants.get.useQuery();
  const update = trpc.tenants.update.useMutation({
    onSuccess: () => {
      void utils.tenants.get.invalidate();
      toast.success(t('saveSuccess'));
    },
    onError: () => {
      toast.error(t('saveError'));
    },
  });

  const [name, setName] = useState('');
  useEffect(() => {
    if (tenantQuery.data !== undefined) {
      setName(tenantQuery.data.tenant.name);
    }
  }, [tenantQuery.data]);

  async function onCopySlug() {
    if (tenantQuery.data === undefined) return;
    try {
      await navigator.clipboard.writeText(tenantQuery.data.tenant.slug);
      toast.success(t('slugCopied'));
    } catch {
      // Clipboard might not be available (e.g. http context); fall
      // back silently. The slug is visible in the field anyway.
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length === 0) return;
    update.mutate({ name: name.trim() });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {tenantQuery.isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : tenantQuery.data === undefined ? (
            <p className="text-sm text-destructive">{tCommon('error')}</p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="company-name">{t('companyNameLabel')}</Label>
                <Input
                  id="company-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company-slug">{t('slugLabel')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="company-slug"
                    value={tenantQuery.data.tenant.slug}
                    readOnly
                    className="bg-muted font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onCopySlug}
                    aria-label={t('copySlug')}
                  >
                    {tCommon('copy')}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="company-members">{t('membersLabel')}</Label>
                  <Input
                    id="company-members"
                    value={String(tenantQuery.data.memberCount)}
                    readOnly
                    className="bg-muted"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="company-plan">{t('planLabel')}</Label>
                  <Input
                    id="company-plan"
                    value={t('planValuePlaceholder')}
                    readOnly
                    className="bg-muted"
                  />
                </div>
              </div>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? t('saving') : t('saveButton')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
