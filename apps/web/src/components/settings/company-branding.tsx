'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { activeBrand } from '../../lib/brand';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export interface CompanyBranding {
  logoStorageKey?: string;
  primaryColor?: string;
}

const DEFAULT_PRIMARY = '#0F766E';

/**
 * Org-level branding editor rendered on the Company settings page. Uploads a
 * logo via /api/upload/company-logo, lets an admin pick a primary colour, and
 * persists both through tenants.updateBranding. Mirrors the template
 * BrandingForm in components/templates/settings-tab.tsx. Edit controls are
 * gated on `org.settings` — the server (tenants.updateBranding + the upload
 * route) is still the source of truth.
 */
export function CompanyBranding({ branding }: { branding: CompanyBranding | null }) {
  const t = useTranslations('settings.company.branding');
  const utils = trpc.useUtils();
  const canManage = useHasPermission('org.settings');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoStorageKey, setLogoStorageKey] = useState<string | undefined>(
    branding?.logoStorageKey,
  );
  const [primaryColor, setPrimaryColor] = useState<string>(
    branding?.primaryColor ?? DEFAULT_PRIMARY,
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Re-seed local state whenever the persisted branding changes (e.g. after a
  // successful save invalidates tenants.get).
  useEffect(() => {
    setLogoStorageKey(branding?.logoStorageKey);
    setPrimaryColor(branding?.primaryColor ?? DEFAULT_PRIMARY);
  }, [branding?.logoStorageKey, branding?.primaryColor]);

  const save = trpc.tenants.updateBranding.useMutation({
    onSuccess: () => {
      void utils.tenants.get.invalidate();
      toast.success(t('saved'));
    },
    onError: () => {
      toast.error(t('uploadError'));
    },
  });

  // Fetch a signed URL every time the stored key changes so the preview stays
  // in sync with the current logo.
  useEffect(() => {
    let cancelled = false;
    if (logoStorageKey === undefined || logoStorageKey === '') {
      setPreviewUrl(null);
      return;
    }
    const key = logoStorageKey;
    async function load(): Promise<void> {
      try {
        const res = await fetch(`/api/upload/company-logo?key=${encodeURIComponent(key)}`);
        if (!res.ok) {
          if (!cancelled) setPreviewUrl(null);
          return;
        }
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.startsWith('application/json')) {
          const data = (await res.json()) as { url?: string };
          if (!cancelled) setPreviewUrl(data.url ?? null);
        } else if (!cancelled) {
          // Dev fallback streams bytes directly.
          setPreviewUrl(`/api/upload/company-logo?key=${encodeURIComponent(key)}`);
        }
      } catch {
        if (!cancelled) setPreviewUrl(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [logoStorageKey]);

  async function onFileSelected(file: File): Promise<void> {
    setUploadError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload/company-logo', { method: 'POST', body: form });
      if (!res.ok) {
        setUploadError(t('uploadError'));
        return;
      }
      const data = (await res.json()) as { key: string; url?: string };
      setLogoStorageKey(data.key);
    } catch {
      setUploadError(t('uploadError'));
    } finally {
      setUploading(false);
    }
  }

  function onSave(): void {
    save.mutate({
      logoStorageKey: logoStorageKey ?? undefined,
      primaryColor,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">{t('subtitle')}</p>
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('uploadLogo')}</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                disabled={!canManage || uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file !== undefined) void onFileSelected(file);
                }}
                className="block w-full text-sm"
              />
              {uploading ? <p className="text-xs text-muted-foreground">…</p> : null}
              {uploadError !== null ? <p className="text-xs text-red-600">{uploadError}</p> : null}
              {logoStorageKey !== undefined && logoStorageKey !== '' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!canManage}
                  onClick={() => {
                    setLogoStorageKey(undefined);
                    if (fileInputRef.current !== null) fileInputRef.current.value = '';
                  }}
                >
                  {t('removeLogo')}
                </Button>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="brand-primary">{t('primaryColor')}</Label>
              <Input
                id="brand-primary"
                type="color"
                value={primaryColor}
                disabled={!canManage}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-10 w-full max-w-[8rem]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('preview')}</Label>
            <div className="overflow-hidden rounded-md border">
              <div
                className="flex items-center gap-3 px-3 py-2 text-white"
                style={{ backgroundColor: primaryColor }}
              >
                {previewUrl !== null ? (
                  <img src={previewUrl} alt="logo" className="h-8 w-auto object-contain" />
                ) : (
                  <div className="flex h-8 items-center text-xs text-white/70" aria-hidden="true">
                    {t('noLogo')}
                  </div>
                )}
                <span className="text-sm font-medium">{activeBrand.name}</span>
              </div>
            </div>
          </div>

          {canManage ? (
            <Button type="button" onClick={onSave} disabled={save.isPending}>
              {save.isPending ? t('saving') : t('saveButton')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
