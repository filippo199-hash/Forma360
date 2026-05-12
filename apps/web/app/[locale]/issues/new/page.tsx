'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * Create issue form. Loads the chosen category to surface its custom
 * fields + custom questions inline. For MVP, every dynamic field
 * renders as a text input — the type-aware editor will follow in a
 * later PR.
 */
export default function NewIssuePage() {
  const t = useTranslations('issues.new');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const canReport = useHasPermission('issues.report');

  const [categoryId, setCategoryId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [siteId, setSiteId] = useState<string>('');
  const [dateOccurred, setDateOccurred] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [customQuestionResponses, setCustomQuestionResponses] = useState<Record<string, string>>(
    {},
  );

  const { data: categories, isLoading: loadingCategories } =
    trpc.issues.categories.list.useQuery({ includeArchived: false });
  const { data: sites } = trpc.sites.list.useQuery();
  const { data: category } = trpc.issues.categories.get.useQuery(
    { categoryId },
    { enabled: categoryId !== '' },
  );

  // Permission gate (UI-side). Redirect to the list page if missing —
  // server still enforces, but this keeps the URL honest.
  useEffect(() => {
    if (!canReport) {
      toast.error(tCommon('error'));
      router.push(`/${locale}/issues`);
    }
  }, [canReport, locale, router, tCommon]);

  // Reset dynamic values when category changes so we never leak a value
  // from one category's fields into another's.
  useEffect(() => {
    setCustomFieldValues({});
    setCustomQuestionResponses({});
  }, [categoryId]);

  const create = trpc.issues.issues.create.useMutation({
    onSuccess: (result) => {
      toast.success(t('successToast', { ref: result.referenceNumber }));
      router.push(`/${locale}/issues/${result.issueId}`);
    },
    onError: (err) => {
      toast.error(err.message.length > 0 ? err.message : t('errorToast'));
    },
  });

  const canSubmit = useMemo(
    () =>
      categoryId !== '' &&
      title.trim().length > 0 &&
      title.length <= 500 &&
      description.length <= 20_000 &&
      !create.isPending,
    [categoryId, title, description, create.isPending],
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const input: {
      categoryId: string;
      title: string;
      description?: string;
      siteId?: string;
      dateOccurred?: string;
      locationAddress?: string;
      customFieldValues?: Record<string, unknown>;
      customQuestionResponses?: Record<string, unknown>;
    } = {
      categoryId,
      title: title.trim(),
    };
    if (description.trim().length > 0) input.description = description.trim();
    if (siteId !== '') input.siteId = siteId;
    if (dateOccurred !== '') {
      const iso = new Date(dateOccurred).toISOString();
      input.dateOccurred = iso;
    }
    if (locationAddress.trim().length > 0) input.locationAddress = locationAddress.trim();
    const trimmedFieldValues = Object.fromEntries(
      Object.entries(customFieldValues).filter(([, v]) => v.length > 0),
    );
    if (Object.keys(trimmedFieldValues).length > 0) {
      input.customFieldValues = trimmedFieldValues;
    }
    const trimmedQuestionResponses = Object.fromEntries(
      Object.entries(customQuestionResponses).filter(([, v]) => v.length > 0),
    );
    if (Object.keys(trimmedQuestionResponses).length > 0) {
      input.customQuestionResponses = trimmedQuestionResponses;
    }
    create.mutate(input);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/issues`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {tCommon('back')}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('title')}</h1>
      </div>

      <Card>
        <CardContent className="p-6">
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="category">{t('categoryLabel')}</Label>
              <select
                id="category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                required
                disabled={loadingCategories}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{t('categoryPlaceholder')}</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="title">{t('titleLabel')}</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={500}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">{t('descriptionLabel')}</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={20_000}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="site">{t('siteLabel')}</Label>
                <select
                  id="site"
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{t('sitePlaceholder')}</option>
                  {(sites ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dateOccurred">{t('dateLabel')}</Label>
                <Input
                  id="dateOccurred"
                  type="datetime-local"
                  value={dateOccurred}
                  onChange={(e) => setDateOccurred(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="locationAddress">{t('locationLabel')}</Label>
              <Input
                id="locationAddress"
                value={locationAddress}
                onChange={(e) => setLocationAddress(e.target.value)}
                maxLength={500}
              />
            </div>

            {category !== undefined && category.customFields.length > 0 ? (
              <div className="space-y-3 border-t pt-5">
                <h2 className="text-sm font-medium">{t('customFieldsHeading')}</h2>
                {category.customFields.map((field) => (
                  <div key={field.id} className="space-y-1.5">
                    <Label htmlFor={`cf-${field.id}`}>
                      {field.label}
                      {field.required ? ' *' : ''}
                    </Label>
                    <Input
                      id={`cf-${field.id}`}
                      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                      value={customFieldValues[field.id] ?? ''}
                      onChange={(e) =>
                        setCustomFieldValues((prev) => ({
                          ...prev,
                          [field.id]: e.target.value,
                        }))
                      }
                      required={field.required}
                    />
                  </div>
                ))}
              </div>
            ) : null}

            {category !== undefined && category.customQuestions.length > 0 ? (
              <div className="space-y-3 border-t pt-5">
                <h2 className="text-sm font-medium">{t('customQuestionsHeading')}</h2>
                {category.customQuestions.map((q) => (
                  <div key={q.id} className="space-y-1.5">
                    <Label htmlFor={`cq-${q.id}`}>
                      {q.prompt}
                      {q.required ? ' *' : ''}
                    </Label>
                    <Textarea
                      id={`cq-${q.id}`}
                      value={customQuestionResponses[q.id] ?? ''}
                      onChange={(e) =>
                        setCustomQuestionResponses((prev) => ({
                          ...prev,
                          [q.id]: e.target.value,
                        }))
                      }
                      required={q.required}
                      rows={3}
                    />
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 border-t pt-5">
              <Button asChild variant="ghost" type="button">
                <Link href={`/${locale}/issues`}>{t('cancelButton')}</Link>
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {t('submitButton')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
