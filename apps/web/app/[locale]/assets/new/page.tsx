'use client';

import { ArrowLeft, ImagePlus, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { trpc } from '../../../../src/lib/trpc/client';

interface CustomField {
  id: string;
  name: string;
  fieldType: 'text' | 'number' | 'date' | 'select';
  options?: string[];
  required?: boolean;
}

export default function NewAssetPage() {
  const t = useTranslations('assets.new');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [parentId, setParentId] = useState('');
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const { data: typesData } = trpc.assetTypes.list.useQuery({});
  const types = typesData ?? [];

  const { data: sitesData } = trpc.sites.list.useQuery();
  const sites = sitesData ?? [];

  const { data: topLevelAssets } = trpc.assets.list.useQuery({ parentId: null });
  const parentOptions = topLevelAssets ?? [];

  // Find the selected type so we can render its custom fields.
  const selectedType = types.find((tp) => tp.id === typeId) ?? null;
  const customFields: CustomField[] = Array.isArray(selectedType?.customFields)
    ? (selectedType.customFields as CustomField[])
    : [];

  const create = trpc.assets.create.useMutation({
    onSuccess: ({ assetId }) => {
      toast.success(t('createdToast'));
      router.push(`/${locale}/assets/${assetId}`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file === undefined) return;

    // Show local preview immediately.
    const objectUrl = URL.createObjectURL(file);
    setPhotoPreview(objectUrl);
    setUploadingPhoto(true);

    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload/asset-photo', { method: 'POST', body: form });
      if (!res.ok) {
        toast.error(t('photoUploadError'));
        setPhotoPreview(null);
        return;
      }
      const data = (await res.json()) as { key: string };
      setPhotoKey(data.key);
    } catch {
      toast.error(t('photoUploadError'));
      setPhotoPreview(null);
    } finally {
      setUploadingPhoto(false);
      // Reset input so the same file can be re-selected if needed.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function removePhoto() {
    setPhotoPreview(null);
    setPhotoKey(null);
  }

  function setFieldValue(fieldId: string, value: string) {
    setCustomFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length === 0) return;

    // Validate required custom fields.
    for (const field of customFields) {
      if (field.required === true) {
        const val = customFieldValues[field.id] ?? '';
        if (val.trim().length === 0) {
          toast.error(`"${field.name}" is required`);
          return;
        }
      }
    }

    create.mutate({
      name: name.trim(),
      typeId: typeId !== '' ? typeId : undefined,
      siteId: siteId !== '' ? siteId : undefined,
      parentId: parentId !== '' ? parentId : undefined,
      photoKey: photoKey ?? undefined,
      customFieldValues,
    });
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-4 py-3">
          <Link
            href={`/${locale}/assets`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('backLink')}
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-sm font-medium">{t('title')}</h1>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-10">
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Photo + name row */}
          <div className="flex gap-6">
            {/* Photo dropzone */}
            <div className="shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handlePhotoChange}
                aria-label={t('photoSection')}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingPhoto}
                className="relative flex h-28 w-28 flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-background transition-colors hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed"
              >
                {uploadingPhoto ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : photoPreview !== null ? (
                  <>
                    {/* Preview is a local blob URL — Image component not suitable for object URLs */}
                    <img // eslint-disable-line
                      src={photoPreview}
                      alt=""
                      className="h-full w-full rounded-xl object-cover"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removePhoto();
                      }}
                      className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow"
                      aria-label={t('photoSection')}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <ImagePlus className="h-7 w-7 text-muted-foreground" />
                    <span className="mt-1.5 text-center text-[10px] leading-tight text-muted-foreground px-2">
                      {t('photoHint')}
                    </span>
                  </>
                )}
              </button>
            </div>

            {/* Name */}
            <div className="flex flex-1 flex-col justify-center space-y-1.5">
              <Label htmlFor="asset-name">
                {t('fields.name')} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="asset-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('fields.namePlaceholder')}
                maxLength={500}
                required
                autoFocus
                className="text-base"
              />
            </div>
          </div>

          {/* Category */}
          <div className="rounded-xl border bg-background p-5 space-y-5">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="asset-type">{t('fields.type')}</Label>
                <Link
                  href={`/${locale}/assets/categories`}
                  className="text-xs text-primary hover:underline"
                  tabIndex={-1}
                >
                  {t('newCategoryLink')}
                </Link>
              </div>
              <select
                id="asset-type"
                value={typeId}
                onChange={(e) => {
                  setTypeId(e.target.value);
                  setCustomFieldValues({});
                }}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">{t('fields.noType')}</option>
                {types.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Dynamic custom fields for selected category */}
            {customFields.length > 0 ? (
              <div className="space-y-4 border-t pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('fields.customFieldsHeading')}
                </p>
                {customFields.map((field) => (
                  <div key={field.id} className="space-y-1.5">
                    <Label htmlFor={`cf-${field.id}`}>
                      {field.name}
                      {field.required === true ? (
                        <span className="ml-1 text-destructive">*</span>
                      ) : null}
                    </Label>
                    {field.fieldType === 'select' ? (
                      <select
                        id={`cf-${field.id}`}
                        value={customFieldValues[field.id] ?? ''}
                        onChange={(e) => setFieldValue(field.id, e.target.value)}
                        className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">—</option>
                        {(field.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        id={`cf-${field.id}`}
                        type={field.fieldType === 'number' ? 'number' : field.fieldType === 'date' ? 'date' : 'text'}
                        value={customFieldValues[field.id] ?? ''}
                        onChange={(e) => setFieldValue(field.id, e.target.value)}
                        placeholder={field.name}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Location & hierarchy */}
          <div className="rounded-xl border bg-background p-5 space-y-4">
            {/* Site */}
            <div className="space-y-1.5">
              <Label htmlFor="asset-site">{t('fields.site')}</Label>
              <select
                id="asset-site"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">{t('fields.noSite')}</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Parent asset */}
            <div className="space-y-1.5">
              <Label htmlFor="asset-parent">{t('fields.parent')}</Label>
              <select
                id="asset-parent"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">{t('fields.noParent')}</option>
                {parentOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Submit */}
          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={create.isPending || uploadingPhoto || name.trim().length === 0}
          >
            {create.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {t('submitButton')}
          </Button>
        </form>
      </div>
    </div>
  );
}
