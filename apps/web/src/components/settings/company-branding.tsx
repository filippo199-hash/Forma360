'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { activeBrand } from '../../lib/brand';
import { useHasPermission } from '../../lib/permissions-context';
import { contrastRatio, parseHexColor } from '../../lib/tenant-theme';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export interface CompanyBranding {
  logoStorageKey?: string;
  primaryColor?: string;
  websiteUrl?: string;
  accentColor?: string;
  chartColors?: string[];
}

interface ProposedPalette {
  primaryColor: string;
  accentColor: string;
  chartColors: string[];
  reasoning: string;
}

const DEFAULT_PRIMARY = '#0F766E';
const DEFAULT_ACCENT = '#f97316';

/** White text when it holds 4.5:1 on `hex`, else near-black — mirrors the
 * server-side guard in lib/tenant-theme so the preview never lies. */
function sampleForeground(hex: string): string {
  const rgb = parseHexColor(hex);
  if (rgb === null) return '#ffffff';
  return contrastRatio({ r: 255, g: 255, b: 255 }, rgb) >= 4.5 ? '#ffffff' : '#181b20';
}

/**
 * Org-level branding editor rendered on the Company settings page. Uploads a
 * logo via /api/upload/company-logo, lets an admin pick colours manually or
 * derive a full palette from the company website (POST /api/ai/brand-palette,
 * ADR 0018), and persists everything through tenants.updateBranding after the
 * admin confirms. Edit controls are gated on `org.settings` — the server
 * (tenants.updateBranding + both routes) is still the source of truth.
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
  const [accentColor, setAccentColor] = useState<string | undefined>(branding?.accentColor);
  const [chartColors, setChartColors] = useState<string[]>(branding?.chartColors ?? []);
  const [websiteUrl, setWebsiteUrl] = useState<string>(branding?.websiteUrl ?? '');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deriving, setDeriving] = useState(false);
  const [deriveError, setDeriveError] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState<string | null>(null);

  // Re-seed local state whenever the persisted branding changes (e.g. after a
  // successful save invalidates tenants.get).
  useEffect(() => {
    setLogoStorageKey(branding?.logoStorageKey);
    setPrimaryColor(branding?.primaryColor ?? DEFAULT_PRIMARY);
    setAccentColor(branding?.accentColor);
    setChartColors(branding?.chartColors ?? []);
    setWebsiteUrl(branding?.websiteUrl ?? '');
  }, [
    branding?.logoStorageKey,
    branding?.primaryColor,
    branding?.accentColor,
    branding?.chartColors,
    branding?.websiteUrl,
  ]);

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

  async function onDerivePalette(): Promise<void> {
    const raw = websiteUrl.trim();
    if (raw === '') return;
    // Bare domains get the only scheme the endpoint accepts.
    const url = raw.includes('://') ? raw : `https://${raw}`;
    setWebsiteUrl(url);
    setDeriveError(null);
    setDeriving(true);
    try {
      const res = await fetch('/api/ai/brand-palette', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.status === 429) {
        setDeriveError(t('deriveRateLimited'));
        return;
      }
      if (!res.ok) {
        setDeriveError(t('deriveError'));
        return;
      }
      const data = (await res.json()) as { palette?: ProposedPalette };
      if (data.palette === undefined) {
        setDeriveError(t('deriveError'));
        return;
      }
      setPrimaryColor(data.palette.primaryColor);
      setAccentColor(data.palette.accentColor);
      setChartColors(data.palette.chartColors);
      setReasoning(data.palette.reasoning);
    } catch {
      setDeriveError(t('deriveError'));
    } finally {
      setDeriving(false);
    }
  }

  function onSave(): void {
    save.mutate({
      ...(logoStorageKey !== undefined && logoStorageKey !== '' ? { logoStorageKey } : {}),
      primaryColor,
      ...(websiteUrl.trim() !== '' ? { websiteUrl: websiteUrl.trim() } : {}),
      ...(accentColor !== undefined ? { accentColor } : {}),
      ...(chartColors.length > 0 ? { chartColors } : {}),
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

            <div className="grid grid-cols-2 gap-4">
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
              <div className="space-y-1.5">
                <Label htmlFor="brand-accent">{t('accentColor')}</Label>
                <Input
                  id="brand-accent"
                  type="color"
                  value={accentColor ?? DEFAULT_ACCENT}
                  disabled={!canManage}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-10 w-full max-w-[8rem]"
                />
              </div>
            </div>
          </div>

          {/* ADR 0018: derive the palette from the company website. */}
          <div className="space-y-1.5">
            <Label htmlFor="brand-website">{t('websiteUrl')}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="brand-website"
                type="url"
                inputMode="url"
                placeholder={t('websiteUrlPlaceholder')}
                value={websiteUrl}
                disabled={!canManage || deriving}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                className="sm:max-w-sm"
              />
              <Button
                type="button"
                variant="outline"
                disabled={!canManage || deriving || websiteUrl.trim() === ''}
                onClick={() => void onDerivePalette()}
              >
                {deriving ? t('deriving') : t('derivePalette')}
              </Button>
            </div>
            {deriveError !== null ? <p className="text-xs text-red-600">{deriveError}</p> : null}
            {reasoning !== null ? (
              <p className="text-xs text-muted-foreground">{reasoning}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>{t('palettePreview')}</Label>
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <span
                    className="h-8 w-8 rounded-md border"
                    style={{ backgroundColor: primaryColor }}
                    aria-hidden="true"
                  />
                  <span className="text-xs text-muted-foreground">{t('primaryColor')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="h-8 w-8 rounded-md border"
                    style={{ backgroundColor: accentColor ?? DEFAULT_ACCENT }}
                    aria-hidden="true"
                  />
                  <span className="text-xs text-muted-foreground">{t('accentColor')}</span>
                </div>
                {chartColors.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <span className="flex overflow-hidden rounded-md border" aria-hidden="true">
                      {chartColors.map((hex, i) => (
                        <span
                          key={`${hex}-${i}`}
                          className="h-8 w-5"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </span>
                    <span className="text-xs text-muted-foreground">{t('chartColorsLabel')}</span>
                  </div>
                ) : null}
              </div>

              {/* Sample controls so the admin sees the palette doing real work. */}
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
                  style={{ backgroundColor: primaryColor, color: sampleForeground(primaryColor) }}
                >
                  {t('sampleButton')}
                </span>
                <span
                  className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                  style={{
                    borderColor: accentColor ?? DEFAULT_ACCENT,
                    color: accentColor ?? DEFAULT_ACCENT,
                  }}
                >
                  {t('sampleChip')}
                </span>
              </div>

              <div className="overflow-hidden rounded-md border">
                <div
                  className="flex items-center gap-3 px-3 py-2"
                  style={{
                    backgroundColor: primaryColor,
                    color: sampleForeground(primaryColor),
                  }}
                >
                  {previewUrl !== null ? (
                    <img src={previewUrl} alt="logo" className="h-8 w-auto object-contain" />
                  ) : (
                    <div className="flex h-8 items-center text-xs opacity-70" aria-hidden="true">
                      {t('noLogo')}
                    </div>
                  )}
                  <span className="text-sm font-medium">{activeBrand.name}</span>
                </div>
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
