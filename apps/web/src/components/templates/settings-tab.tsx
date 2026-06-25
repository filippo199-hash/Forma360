'use client';

import type { TemplateContent } from '@forma360/shared/template-schema';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { responseChipClasses } from '../../lib/response-colors';
import { InstructionBody } from '../inspections/instruction-render';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { useEditor } from './editor-context';

/**
 * Template-level settings: title, description, inspection-title format,
 * document-number format + counter start. Access rule picker lands in a
 * later PR.
 *
 * When `onContinue` is provided (publish wizard mode) a "Continue to
 * Visibility →" button is shown at the bottom of the form. Clicking it
 * auto-saves the draft (via the shell) and navigates to the Visibility step.
 */
export function SettingsTab({
  templateId,
  onContinue,
  isSaving = false,
}: {
  templateId: string;
  /** Wizard mode: callback invoked when the user clicks "Continue to Visibility". */
  onContinue?: () => void;
  /** True while the auto-save triggered by "Continue" is in flight. */
  isSaving?: boolean;
}) {
  const t = useTranslations('templates.editor.settingsTab');
  const { state, dispatch } = useEditor();
  const branding = state.content.settings.branding ?? {};

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('templateTitleLabel')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">{t('templateTitleLabel')}</Label>
                <Input
                  id="tpl-name"
                  value={state.content.title}
                  onChange={(e) => dispatch({ type: 'updateContentTitle', title: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-desc">{t('templateDescriptionLabel')}</Label>
                <Textarea
                  id="tpl-desc"
                  value={state.content.description ?? ''}
                  onChange={(e) =>
                    dispatch({ type: 'updateContentDescription', description: e.target.value })
                  }
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('titleFormatLabel')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="title-fmt">{t('titleFormatLabel')}</Label>
                <Input
                  id="title-fmt"
                  value={state.content.settings.titleFormat}
                  onChange={(e) =>
                    dispatch({ type: 'updateSettings', patch: { titleFormat: e.target.value } })
                  }
                />
                <p className="text-xs text-muted-foreground">{t('titleFormatHelp')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-fmt">{t('documentNumberFormatLabel')}</Label>
                <Input
                  id="doc-fmt"
                  value={state.content.settings.documentNumberFormat}
                  onChange={(e) =>
                    dispatch({
                      type: 'updateSettings',
                      patch: { documentNumberFormat: e.target.value },
                    })
                  }
                />
                <p className="text-xs text-muted-foreground">{t('documentNumberFormatHelp')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-start">{t('documentNumberStartLabel')}</Label>
                <Input
                  id="doc-start"
                  type="number"
                  min={1}
                  value={state.content.settings.documentNumberStart}
                  onChange={(e) =>
                    dispatch({
                      type: 'updateSettings',
                      patch: { documentNumberStart: Math.max(1, Number(e.target.value) || 1) },
                    })
                  }
                />
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>{t('branding.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <BrandingForm
                templateId={templateId}
                logoStorageKey={branding.logoStorageKey}
                primaryColor={branding.primaryColor}
                accentColor={branding.accentColor}
                onChange={(patch) => {
                  const next = {
                    ...(state.content.settings.branding ?? {}),
                    ...patch,
                  };
                  // Drop keys explicitly set to undefined so we don't persist
                  // empty strings against the hex-color regex.
                  const cleaned: {
                    logoStorageKey?: string;
                    primaryColor?: string;
                    accentColor?: string;
                  } = {};
                  if (next.logoStorageKey !== undefined)
                    cleaned.logoStorageKey = next.logoStorageKey;
                  if (next.primaryColor !== undefined) cleaned.primaryColor = next.primaryColor;
                  if (next.accentColor !== undefined) cleaned.accentColor = next.accentColor;
                  const brandingPatch = Object.keys(cleaned).length === 0 ? undefined : cleaned;
                  dispatch({ type: 'updateSettings', patch: { branding: brandingPatch } });
                }}
              />
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>{t('previewTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportPreview content={state.content} />
            </CardContent>
          </Card>
        </div>

        {/* Publish wizard: "Continue to Visibility" CTA */}
        {onContinue !== undefined ? (
          <div className="mt-6 flex justify-end">
            <Button onClick={onContinue} disabled={isSaving} className="min-w-[200px]">
              {isSaving ? t('savingForWizard') : t('continueToVisibility')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BrandingForm({
  templateId,
  logoStorageKey,
  primaryColor,
  accentColor,
  onChange,
}: {
  templateId: string;
  logoStorageKey: string | undefined;
  primaryColor: string | undefined;
  accentColor: string | undefined;
  onChange: (patch: {
    logoStorageKey?: string | undefined;
    primaryColor?: string | undefined;
    accentColor?: string | undefined;
  }) => void;
}) {
  const t = useTranslations('templates.editor.settingsTab.branding');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Fetch a signed URL every time the stored key changes so the preview
  // stays in sync with the saved-but-unsaved branding.
  useEffect(() => {
    let cancelled = false;
    if (logoStorageKey === undefined || logoStorageKey === '') {
      setPreviewUrl(null);
      return;
    }
    async function load(): Promise<void> {
      try {
        const res = await fetch(
          `/api/upload/template-logo?key=${encodeURIComponent(logoStorageKey ?? '')}`,
        );
        if (!res.ok) {
          if (!cancelled) setPreviewUrl(null);
          return;
        }
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.startsWith('application/json')) {
          const data = (await res.json()) as { url?: string };
          if (!cancelled) setPreviewUrl(data.url ?? null);
        } else {
          // Dev fallback streams bytes directly.
          if (!cancelled) {
            setPreviewUrl(
              `/api/upload/template-logo?key=${encodeURIComponent(logoStorageKey ?? '')}`,
            );
          }
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

  async function onFileSelected(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('templateId', templateId);
      form.append('file', file);
      const res = await fetch('/api/upload/template-logo', { method: 'POST', body: form });
      if (!res.ok) {
        setUploadError(t('uploadError'));
        return;
      }
      const data = (await res.json()) as { key: string; url?: string };
      onChange({ logoStorageKey: data.key });
    } catch {
      setUploadError(t('uploadError'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t('uploadLogo')}</Label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
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
              onClick={() => {
                onChange({ logoStorageKey: undefined });
                if (fileInputRef.current !== null) fileInputRef.current.value = '';
              }}
            >
              {t('removeLogo')}
            </Button>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="brand-primary">{t('primaryColor')}</Label>
            <Input
              id="brand-primary"
              type="color"
              value={primaryColor ?? '#0F766E'}
              onChange={(e) => onChange({ primaryColor: e.target.value })}
              className="h-10 w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brand-accent">{t('accentColor')}</Label>
            <Input
              id="brand-accent"
              type="color"
              value={accentColor ?? '#38bdf8'}
              onChange={(e) => onChange({ accentColor: e.target.value })}
              className="h-10 w-full"
            />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{t('preview')}</Label>
        <div className="overflow-hidden rounded-md border">
          <div
            className="flex items-center gap-3 px-3 py-2 text-white"
            style={{ backgroundColor: primaryColor ?? '#0F766E' }}
          >
            {previewUrl !== null ? (
              <img src={previewUrl} alt="logo" className="h-8 w-auto object-contain" />
            ) : (
              <div className="h-8 w-12 rounded bg-white/30" aria-hidden="true" />
            )}
            <span className="text-sm font-medium">Forma360</span>
          </div>
          <div className="h-2 w-full" style={{ backgroundColor: accentColor ?? '#38bdf8' }} />
        </div>
      </div>
    </div>
  );
}

/**
 * Live in-browser preview of how the inspection report will look — branding
 * cover + the template's pages/sections/questions with placeholder answers.
 * Template-only (no inspection), so multiple-choice questions show their
 * option chips and other types show a muted placeholder. Updates as you edit.
 */
function ReportPreview({ content }: { content: TemplateContent }) {
  const t = useTranslations('templates.editor.settingsTab');
  const branding = content.settings.branding;
  const primary = branding?.primaryColor;
  const accent = branding?.accentColor;
  const logoKey = branding?.logoStorageKey;
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (logoKey === undefined || logoKey === '') {
      setLogoUrl(null);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/upload/template-logo?key=${encodeURIComponent(logoKey)}`);
        if (!res.ok) return;
        const ct = res.headers.get('content-type') ?? '';
        if (ct.startsWith('application/json')) {
          const data = (await res.json()) as { url?: string };
          if (!cancelled) setLogoUrl(data.url ?? null);
        } else if (!cancelled) {
          setLogoUrl(`/api/upload/template-logo?key=${encodeURIComponent(logoKey)}`);
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [logoKey]);

  const setsById = new Map(content.customResponseSets.map((s) => [s.id, s]));
  const inspectionPages = content.pages; // title + inspection, in order

  return (
    <div className="mx-auto max-w-2xl overflow-hidden rounded-lg border bg-card shadow-sm">
      {/* Cover */}
      <div
        className="flex items-center gap-3 px-5 py-4 text-white"
        style={{ backgroundColor: primary ?? '#0f172a' }}
      >
        {logoUrl !== null ? (
          <img src={logoUrl} alt="logo" className="h-9 w-auto object-contain" />
        ) : (
          <div className="h-9 w-12 rounded bg-white/25" aria-hidden />
        )}
        <span className="text-lg font-semibold">{content.title || t('templateTitleLabel')}</span>
      </div>

      <div className="space-y-6 p-5">
        {inspectionPages.map((page) => (
          <section key={page.id} className="space-y-3">
            <h3
              className="border-b pb-1.5 text-base font-semibold"
              style={accent !== undefined ? { borderBottomColor: accent } : undefined}
            >
              {page.title}
            </h3>
            {page.sections.map((section) => (
              <div key={section.id} className="space-y-2">
                {section.title ? (
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {section.title}
                  </p>
                ) : null}
                {section.items
                  .filter(
                    (item) =>
                      'prompt' in item ||
                      (item.type === 'instruction' && item.showInReport),
                  )
                  .map((item) => {
                    // Instructions render their guidance (text/media/video),
                    // honouring the report toggle handled by the filter above.
                    if (item.type === 'instruction') {
                      return (
                        <div key={item.id}>
                          <InstructionBody item={item} />
                        </div>
                      );
                    }
                    const prompt = 'prompt' in item ? item.prompt : '';
                    const set =
                      item.type === 'multipleChoice' ? setsById.get(item.responseSetId) : undefined;
                    return (
                      <div
                        key={item.id}
                        className="flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm"
                      >
                        <span className="font-medium leading-snug">{prompt}</span>
                        {set !== undefined ? (
                          <span className="flex flex-wrap justify-end gap-1">
                            {set.options.slice(0, 4).map((opt) => (
                              <span
                                key={opt.id}
                                className={`rounded-full px-1.5 py-0.5 text-[11px] ${responseChipClasses(opt.color)}`}
                              >
                                {opt.label}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="italic text-muted-foreground">—</span>
                        )}
                      </div>
                    );
                  })}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
