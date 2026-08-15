'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { CompanyBranding } from '../../../../src/components/settings/company-branding';
import { cn } from '../../../../src/lib/cn';
import { trpc } from '../../../../src/lib/trpc/client';
import { useServerErrorToast } from '../../../../src/lib/use-server-error';

type Terminology = 'both' | 'sites' | 'projects';
const TERMINOLOGY_OPTIONS: readonly Terminology[] = ['both', 'sites', 'projects'];

/**
 * Company-level settings. Admin-only — the parent layout already
 * gates `/settings/*` so we just need to wire the form against
 * `tenants.get` / `tenants.update`. Slug is read-only with a copy
 * button so admins can grab their tenant slug for shared links;
 * member count + plan are read-only display only.
 */
export default function CompanyPage() {
  const t = useTranslations('settings.company');
  const onServerError = useServerErrorToast(t('saveError'));
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

  // PF-31: retention v1 (notification-centre rows only).
  const setRetention = trpc.tenants.setRetention.useMutation({
    onSuccess: () => {
      toast.success(t('retention.savedToast'));
      void utils.tenants.get.invalidate();
    },
    onError: onServerError,
  });
  const updateSettings = trpc.tenants.updateSettings.useMutation({
    onSuccess: () => {
      void utils.tenants.get.invalidate();
      toast.success(t('terminologySaved'));
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

  const terminology: Terminology = tenantQuery.data?.tenant.settings?.terminology ?? 'both';

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

      <Card>
        <CardHeader>
          <CardTitle>{t('terminologyTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">{t('terminologyHelp')}</p>
          {tenantQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : tenantQuery.error !== null || tenantQuery.data === undefined ? (
            <p className="text-sm text-destructive">{tCommon('error')}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {TERMINOLOGY_OPTIONS.map((opt) => {
                const active = terminology === opt;
                const titleKey =
                  opt === 'both'
                    ? 'terminologyBoth'
                    : opt === 'sites'
                      ? 'terminologySites'
                      : 'terminologyProjects';
                const helpKey =
                  opt === 'both'
                    ? 'terminologyBothHelp'
                    : opt === 'sites'
                      ? 'terminologySitesHelp'
                      : 'terminologyProjectsHelp';
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={updateSettings.isPending}
                    onClick={() => {
                      if (active) return;
                      const confirmed = window.confirm(
                        t('terminologyConfirm', { label: t(titleKey) }),
                      );
                      if (confirmed) updateSettings.mutate({ terminology: opt });
                    }}
                    className={cn(
                      'rounded-lg border p-3 text-left transition-colors',
                      active
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-input hover:border-primary/50 hover:bg-muted/40',
                    )}
                    aria-pressed={active}
                  >
                    <div className="text-sm font-medium">{t(titleKey)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{t(helpKey)}</div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* PF-31: retention policy v1 + tenant data export. */}
      <Card>
        <CardHeader>
          <CardTitle>{t('retention.title')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('retention.subtitle')}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={String(tenantQuery.data?.tenant.retentionMonths ?? '')}
              onChange={(e) =>
                setRetention.mutate({
                  retentionMonths: e.target.value === '' ? null : Number(e.target.value),
                })
              }
              disabled={setRetention.isPending}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">{t('retention.keepForever')}</option>
              {[6, 12, 24, 36, 60].map((m) => (
                <option key={m} value={m}>
                  {t('retention.months', { count: m })}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">{t('retention.scopeNote')}</p>
          <div className="border-t pt-3">
            <a
              href="/api/exports/tenant-data"
              className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
              download
            >
              {t('exportData.button')}
            </a>
            <p className="mt-1 text-xs text-muted-foreground">{t('exportData.hint')}</p>
          </div>
        </CardContent>
      </Card>

      <CompanyBranding branding={tenantQuery.data?.tenant.settings?.branding ?? null} />
    </div>
  );
}
