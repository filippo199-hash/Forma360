'use client';

import type { IssueCustomQuestion } from '@forma360/shared/issues-schema';
import { Image as ImageIcon, MapPin } from 'lucide-react';
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

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 30_000;
const MAX_LOCATION = 500;

/**
 * Report observation form. Progressive disclosure: initially only the
 * Date and the "What type of observation?" selector are visible; the
 * remaining fields appear once a category is chosen. Custom questions
 * defined on the selected category render type-aware (text =>
 * Textarea, multipleChoice => Select).
 *
 * Header bar: Cancel (left) · Title (center) · Submit (top-right). The
 * same Cancel / Submit pair mirrors at the bottom of the form for long
 * surveys.
 *
 * Image / video upload is a placeholder; real upload is PR-3.
 */
export default function NewObservationPage() {
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
  const [dateOccurred, setDateOccurred] = useState(() => formatLocalDatetime(new Date()));
  const [locationAddress, setLocationAddress] = useState('');
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

  useEffect(() => {
    if (!canReport) {
      toast.error(tCommon('error'));
      router.push(`/${locale}/observations`);
    }
  }, [canReport, locale, router, tCommon]);

  // Reset dynamic values when category changes so we never leak a value
  // from one category's questions into another's.
  useEffect(() => {
    setCustomQuestionResponses({});
  }, [categoryId]);

  const create = trpc.issues.issues.create.useMutation({
    onSuccess: (result) => {
      toast.success(t('successToast', { ref: result.referenceNumber }));
      router.push(`/${locale}/observations/${result.issueId}`);
    },
    onError: (err) => {
      toast.error(err.message.length > 0 ? err.message : t('errorToast'));
    },
  });

  const canSubmit = useMemo(
    () =>
      categoryId !== '' &&
      title.trim().length > 0 &&
      title.length <= MAX_TITLE &&
      description.length <= MAX_DESCRIPTION &&
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
    const trimmedQuestionResponses = Object.fromEntries(
      Object.entries(customQuestionResponses).filter(([, v]) => v.length > 0),
    );
    if (Object.keys(trimmedQuestionResponses).length > 0) {
      input.customQuestionResponses = trimmedQuestionResponses;
    }
    create.mutate(input);
  }

  const categorySelected = categoryId !== '';
  const customQuestions: ReadonlyArray<IssueCustomQuestion> =
    category?.customQuestions ?? [];

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" type="button">
          <Link href={`/${locale}/observations`}>{t('cancelButton')}</Link>
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <Button type="submit" disabled={!canSubmit}>
          {t('submitButton')}
        </Button>
      </header>

      <Card className="mx-auto max-w-2xl">
        <CardContent className="space-y-5 p-6">
          <div className="space-y-1.5">
            <Label htmlFor="dateOccurred">{t('dateLabel')}</Label>
            <Input
              id="dateOccurred"
              type="datetime-local"
              value={dateOccurred}
              onChange={(e) => setDateOccurred(e.target.value)}
            />
          </div>

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
                <option key={c.id} value={c.id} disabled={c.archivedAt !== null}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {categorySelected ? (
            <div className="space-y-5 border-t pt-5">
              <div className="space-y-1.5">
                <Label htmlFor="title">{t('titleLabel')}</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={MAX_TITLE}
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
                  maxLength={MAX_DESCRIPTION}
                />
                <p className="text-right text-xs text-muted-foreground">
                  {t('descriptionCounter', { count: description.length })}
                </p>
              </div>

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
                <Label>{t('mediaHeading')}</Label>
                <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center">
                  <p className="text-sm text-muted-foreground">{t('mediaPlaceholder')}</p>
                  <Button type="button" variant="outline" size="sm" disabled className="mt-2">
                    <ImageIcon className="mr-1 h-4 w-4" />
                    {t('mediaButton')}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="locationAddress">{t('locationLabel')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="locationAddress"
                    value={locationAddress}
                    onChange={(e) => setLocationAddress(e.target.value)}
                    maxLength={MAX_LOCATION}
                  />
                  <Button type="button" variant="outline" disabled title={t('mapComingSoon')}>
                    <MapPin className="mr-1 h-4 w-4" />
                    {t('mapButton')}
                  </Button>
                </div>
              </div>

              {customQuestions.length > 0 ? (
                <div className="space-y-3 border-t pt-5">
                  <h2 className="text-sm font-medium">{t('customQuestionsHeading')}</h2>
                  {customQuestions.map((q) => (
                    <div key={q.id} className="space-y-1.5">
                      <Label htmlFor={`cq-${q.id}`}>
                        {q.prompt}
                        {q.required ? ' *' : ''}
                      </Label>
                      {q.type === 'multipleChoice' && q.options !== undefined ? (
                        <select
                          id={`cq-${q.id}`}
                          value={customQuestionResponses[q.id] ?? ''}
                          onChange={(e) =>
                            setCustomQuestionResponses((prev) => ({
                              ...prev,
                              [q.id]: e.target.value,
                            }))
                          }
                          required={q.required}
                          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          <option value="">—</option>
                          {q.options.map((o, i) => (
                            <option key={i} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
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
                      )}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2 border-t pt-5">
                <Button asChild variant="ghost" type="button">
                  <Link href={`/${locale}/observations`}>{t('cancelButton')}</Link>
                </Button>
                <Button type="submit" disabled={!canSubmit}>
                  {t('submitButton')}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </form>
  );
}

function formatLocalDatetime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
