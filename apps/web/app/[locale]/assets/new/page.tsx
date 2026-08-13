'use client';

import { ImagePlus, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { FocusedPageShell } from '../../../../src/components/focused-page-shell';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { GroupUserSelector } from '../../../../src/components/selectors/group-user-selector';
import { usePlaceTerms } from '../../../../src/lib/terminology';
import {
  CustomFieldInputs,
  customFieldsOf,
  firstMissingRequired,
} from '../../../../src/components/assets/custom-field-inputs';
import { trpc } from '../../../../src/lib/trpc/client';

export default function NewAssetPage() {
  const t = useTranslations('assets.new');
  const { label: placeLabel, noneLabel: placeNone } = usePlaceTerms();
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState('');
  // Pre-fill from ?site= — the "create here" flow from a project page.
  // useSearchParams (not window.location) so client-side navigations see
  // the destination URL on first render.
  const [siteId, setSiteId] = useState<string>(() => searchParams.get('site') ?? '');
  const [parentId, setParentId] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const { data: typesData } = trpc.assetTypes.list.useQuery({});
  const types = typesData ?? [];

  const { data: topLevelAssets } = trpc.assets.list.useQuery({ parentId: null });
  const parentOptions = topLevelAssets ?? [];

  // Find the selected type so we can render its custom fields.
  const selectedType = types.find((tp) => tp.id === typeId) ?? null;
  const customFields = customFieldsOf(selectedType);

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

    // Validate required custom fields through the shared helper, so
    // "required" means the same thing here and on the detail page.
    const missing = firstMissingRequired(customFields, customFieldValues);
    if (missing !== null) {
      toast.error(t('fieldRequired', { name: missing.name }));
      return;
    }

    create.mutate({
      name: name.trim(),
      typeId: typeId !== '' ? typeId : undefined,
      siteId: siteId !== '' ? siteId : undefined,
      parentId: parentId !== '' ? parentId : undefined,
      ownerUserId: ownerUserId !== '' ? ownerUserId : undefined,
      photoKey: photoKey ?? undefined,
      customFieldValues,
    });
  }

  return (
    <FocusedPageShell title={t('title')} backHref={`/${locale}/assets`} width="form">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Photo + name row */}
        <div className="flex gap-6">
          {/* Photo dropzone */}
          <div className="shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,.heic,.heif"
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
                  <img
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
                href={`/${locale}/assets/settings`}
                className="text-xs text-primary hover:underline"
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
              {/* Shared with the detail page's edit mode, so the two cannot
                  drift — the detail page had no copy at all, which is how a
                  value became uneditable the moment it was saved. */}
              <CustomFieldInputs
                fields={customFields}
                values={customFieldValues}
                onChange={setFieldValue}
              />
            </div>
          ) : null}
        </div>

        {/* Location & hierarchy */}
        <div className="rounded-xl border bg-background p-5 space-y-4">
          {/* Site */}
          <div className="space-y-1.5">
            <Label>{placeLabel}</Label>
            <SiteSelector
              value={siteId !== '' ? [siteId] : []}
              onChange={(next) => setSiteId(next[0] ?? '')}
              multiple={false}
              placeholder={placeNone}
            />
          </div>

          {/* Owner */}
          <div className="space-y-1.5">
            <Label>{t('fields.owner')}</Label>
            <GroupUserSelector
              mode="users"
              multiple={false}
              value={ownerUserId !== '' ? [ownerUserId] : []}
              onChange={(next) => setOwnerUserId(next[0] ?? '')}
              placeholder={t('fields.ownerPlaceholder')}
            />
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
          {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t('submitButton')}
        </Button>
      </form>
    </FocusedPageShell>
  );
}
