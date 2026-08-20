'use client';

import { Check, ImagePlus, Loader2, Wand2 } from 'lucide-react';
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
import type { CompanyDetailsValue } from './company-details-form';
import { DocumentBrandingPreview } from './document-branding-preview';

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

/** Hostname for the status line — the whole URL is noise mid-sentence. */
function hostOf(raw: string): string {
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname;
  } catch {
    return raw;
  }
}

const DEFAULT_PRIMARY = '#0F766E';
const DEFAULT_ACCENT = '#f97316';

/** White text when it holds 4.5:1 on `hex`, else near-black — mirrors the
 * server-side guard in lib/tenant-theme so the preview never lies. */
export function sampleForeground(hex: string): string {
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
export function CompanyBranding({
  branding,
  companyName,
  companyDetails = null,
}: {
  branding: CompanyBranding | null;
  /** Tenant display name — headline of the document-preview letterhead. */
  companyName: string;
  /** Saved company details (the card above) shown on the mock documents. */
  companyDetails?: CompanyDetailsValue | null;
}) {
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
  const [logoCandidates, setLogoCandidates] = useState<string[]>([]);
  const [importingLogo, setImportingLogo] = useState<string | null>(null);
  /** Import failure, shown INSIDE the picker at the tile the admin clicked. */
  const [importError, setImportError] = useState<string | null>(null);
  /** The candidate that was successfully applied — gets a check badge. */
  const [importedLogoUrl, setImportedLogoUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

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
    setLogoCandidates([]);
    setImportError(null);
    setImportedLogoUrl(null);
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
        // "Check the address and try again" is wrong advice for a site we
        // could not reach, or one whose CSS holds no usable colour. Say
        // which of those happened.
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setDeriveError(
          body?.error === 'FETCH_FAILED'
            ? t('deriveUnreachable')
            : body?.error === 'NO_COLORS'
              ? t('deriveNoColors')
              : body?.error === 'URL_REFUSED'
                ? t('deriveRefused')
                : t('deriveError'),
        );
        return;
      }
      const data = (await res.json()) as {
        palette?: ProposedPalette;
        logoCandidates?: string[];
      };
      if (data.palette === undefined) {
        setDeriveError(t('deriveError'));
        return;
      }
      setPrimaryColor(data.palette.primaryColor);
      setAccentColor(data.palette.accentColor);
      setChartColors(data.palette.chartColors);
      setReasoning(data.palette.reasoning);
      setLogoCandidates(data.logoCandidates ?? []);
    } catch {
      setDeriveError(t('deriveError'));
    } finally {
      setDeriving(false);
    }
  }

  /**
   * Which advice fits which import failure. The server names the cause
   * (`classifyImageFetchError`); a favicon .ico needs "pick another / upload
   * a PNG", while a CDN that refused OUR fetch needs "save it and upload
   * the file" — one generic sentence covered neither.
   */
  function importErrorMessage(code: string): string {
    switch (code) {
      case 'UNSUPPORTED_TYPE':
        return t('importUnsupportedType');
      case 'TOO_LARGE':
        return t('importTooLarge');
      case 'SITE_REFUSED':
      case 'URL_REFUSED':
        return t('importSiteRefused');
      case 'STORAGE_FAILED':
        // The image was fine — OUR object store refused the write. Telling
        // the admin to re-download the image is wrong advice for that.
        return t('importStoreFailed');
      default:
        return t('logoImportError');
    }
  }

  /** Import one of the logos found on the website into our own storage. */
  async function onImportLogo(sourceUrl: string): Promise<void> {
    setImportError(null);
    setImportingLogo(sourceUrl);
    try {
      const res = await fetch('/api/upload/company-logo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceUrl }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setImportError(importErrorMessage(body?.error ?? ''));
        return;
      }
      const data = (await res.json()) as { key: string };
      setLogoStorageKey(data.key);
      setImportedLogoUrl(sourceUrl);
    } catch {
      setImportError(t('logoImportError'));
    } finally {
      setImportingLogo(null);
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
            {/* A drop area rather than a bare "Choose file": the logo is the
                one setting on this page with something to show, and a file
                input showed "No file chosen" even when a logo was stored. */}
            <div className="space-y-2">
              <Label>{t('uploadLogo')}</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp,image/x-icon,image/vnd.microsoft.icon,.ico"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file !== undefined) void onFileSelected(file);
                  e.target.value = '';
                }}
              />
              <div
                role="button"
                tabIndex={canManage ? 0 : -1}
                aria-label={t('uploadLogo')}
                aria-disabled={!canManage || uploading}
                onClick={() => {
                  if (canManage && !uploading) fileInputRef.current?.click();
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && canManage && !uploading) {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  if (!canManage) return;
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  if (!canManage) return;
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file !== undefined) void onFileSelected(file);
                }}
                className={`flex min-h-[7rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-4 text-center transition-colors ${
                  dragging ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/50'
                } ${!canManage || uploading ? 'pointer-events-none opacity-60' : ''}`}
              >
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                ) : previewUrl !== null ? (
                  <img
                    src={previewUrl}
                    alt={t('uploadLogo')}
                    className="max-h-16 w-auto max-w-full object-contain"
                  />
                ) : (
                  <ImagePlus className="h-6 w-6 text-muted-foreground" aria-hidden />
                )}
                <p className="text-xs text-muted-foreground">
                  {previewUrl !== null ? t('replaceLogoHint') : t('uploadLogoHint')}
                </p>
              </div>
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
                {deriving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Wand2 className="mr-2 h-4 w-4" aria-hidden />
                )}
                {deriving ? t('deriving') : t('derivePalette')}
              </Button>
            </div>

            {/* The work takes several seconds — it fetches the site, its
                stylesheets, and then calls a model. A word swapped inside the
                button was the only sign of that, which on a wide card is easy
                to miss entirely and reads as a dead click. */}
            {deriving ? (
              <div
                role="status"
                aria-live="polite"
                className="mt-2 space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  <span>{t('derivingStatus', { host: hostOf(websiteUrl) })}</span>
                </div>
                {/* Indeterminate: one round trip, so any percentage would be
                    invented. It says "still running", nothing more. */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
                  <div className="animate-indeterminate-bar h-full w-1/4 rounded-full bg-primary" />
                </div>
                <p className="text-xs text-muted-foreground">{t('derivingHint')}</p>
              </div>
            ) : null}
            {deriveError !== null ? <p className="text-xs text-red-600">{deriveError}</p> : null}
            {reasoning !== null ? (
              <p className="text-xs text-muted-foreground">{reasoning}</p>
            ) : null}

            {/* Logos found on that page. Picking one fetches it server-side
                (same SSRF guard as the palette harvest) and stores it as the
                company logo — no save-as-and-re-upload round trip.

                A required CHOICE, styled like one: the old thin caption read
                as a footnote and testers scrolled past without realising
                nothing was applied yet. Import failures render HERE, at the
                tile that was clicked — not up by the file drop area. */}
            {logoCandidates.length > 0 ? (
              <div className="space-y-2 rounded-md border-2 border-primary/40 bg-primary/5 p-3">
                <p className="text-sm font-semibold">{t('logoCandidates')}</p>
                <p className="text-xs text-muted-foreground">{t('logoCandidatesHint')}</p>
                <div className="flex flex-wrap gap-2">
                  {logoCandidates.map((src) => (
                    <button
                      key={src}
                      type="button"
                      disabled={!canManage || importingLogo !== null}
                      onClick={() => void onImportLogo(src)}
                      title={src}
                      className={`relative flex h-20 w-28 items-center justify-center rounded-md border-2 bg-background p-2 transition-colors disabled:opacity-60 ${
                        importedLogoUrl === src
                          ? 'border-primary'
                          : 'border-input hover:border-primary'
                      }`}
                    >
                      {importingLogo === src ? (
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                      ) : (
                        <img
                          src={src}
                          alt=""
                          className="max-h-full max-w-full object-contain"
                          // A candidate that 404s or is hotlink-blocked must
                          // not leave a broken-image icon in the picker.
                          onError={(e) => {
                            e.currentTarget.closest('button')?.remove();
                          }}
                        />
                      )}
                      {importedLogoUrl === src ? (
                        <span className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-3.5 w-3.5" aria-hidden />
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                {importError !== null ? (
                  <p className="text-xs text-red-600">{importError}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>{t('palettePreview')}</Label>
            {/* While a new palette is being composed, a still veil with a
                spinner sits over the old swatches. The first version pulsed
                the whole block's opacity instead, which read as the page
                glowing/flickering rather than as "working". */}
            <div aria-busy={deriving} className="relative space-y-3 rounded-md border p-3">
              {deriving ? (
                <div className="absolute inset-0 z-10 grid place-items-center rounded-md bg-background/70">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
                </div>
              ) : null}
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

          {/* Live document mock-ups: the place this branding actually lands.
              Same still spinner veil as the palette preview while a derive
              runs — never an opacity pulse. */}
          <div aria-busy={deriving} className="relative">
            {deriving ? (
              <div className="absolute inset-0 z-10 grid place-items-center rounded-md bg-background/70">
                <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
              </div>
            ) : null}
            <DocumentBrandingPreview
              companyName={companyName}
              details={companyDetails}
              logoUrl={previewUrl}
              primaryColor={primaryColor}
              accentColor={accentColor ?? DEFAULT_ACCENT}
            />
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
