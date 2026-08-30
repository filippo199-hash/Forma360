'use client';

import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { activeBrand } from '../../../../../src/lib/brand';
import { brandHasModule } from '@forma360/shared/brand';
import { DetailNotFound } from '../../../../../src/components/detail-not-found';
import { RecordDialog } from '../../../../../src/components/training/record-dialog';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../src/components/ui/card';
import { Input } from '../../../../../src/components/ui/input';
import { Label } from '../../../../../src/components/ui/label';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../../src/lib/permissions-context';
import { usePlaceTerms } from '../../../../../src/lib/terminology';
import { trpc } from '../../../../../src/lib/trpc/client';
import { useServerErrorToast } from '../../../../../src/lib/use-server-error';

/**
 * Per-user detail page.
 *
 * Four stacked cards:
 *   1. Profile        — editable first / last name; read-only email,
 *                        permission set, and status.
 *   2. Groups         — every group the user belongs to, flagging
 *                        rule-derived memberships (read-only in v1).
 *   3. Sites          — site memberships, indented by hierarchy depth
 *                        (read-only in v1).
 *   4. Custom fields  — one editor per tenant custom field, typed by the
 *                        field definition (text / select / multi_select).
 *
 * Membership editing stays on the Groups / Sites admin pages for now; this
 * page is a read-mostly profile surface plus the two writable slices
 * (name + custom-field values).
 */
export default function UserDetailPage() {
  const t = useTranslations('settings.userDetail');
  const tUsers = useTranslations('settings.users');
  const tCommon = useTranslations('common');
  const onServerError = useServerErrorToast(tCommon('error'));
  const params = useParams<{ locale: string; userId: string }>();
  const locale = params.locale ?? 'en';
  const userId = params.userId ?? '';
  const utils = trpc.useUtils();
  const canManage = useHasPermission('users.manage');
  const canViewTraining = useHasPermission('training.view');
  const { labelPlural: placesLabel, places } = usePlaceTerms();

  const { data, isLoading, error } = trpc.users.get.useQuery({ id: userId });
  const { data: fields } = trpc.customFields.list.useQuery();

  const updateName = trpc.users.updateName.useMutation({
    onSuccess: () => {
      toast.success(t('profile.savedToast'));
      void utils.users.get.invalidate({ id: userId });
      void utils.users.list.invalidate();
    },
    onError: onServerError,
  });

  // Profile draft — seeded once from the server payload.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (data === undefined || seeded) return;
    setFirstName(data.user.firstName ?? '');
    setLastName(data.user.lastName ?? '');
    setSeeded(true);
  }, [data, seeded]);

  if (isLoading || data === undefined) {
    if (error !== null && error !== undefined) {
      return (
        <div className="space-y-4">
          <BackLink locale={locale} label={t('backLink')} />
          <DetailNotFound error={error} />
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const u = data.user;
  const groupMemberships = data.groupMemberships;
  const siteMemberships = data.siteMemberships;
  const fieldValues = data.fieldValues;

  const nameDirty =
    firstName.trim() !== (u.firstName ?? '') || lastName.trim() !== (u.lastName ?? '');
  const canSaveName =
    canManage && nameDirty && firstName.trim().length > 0 && !updateName.isPending;

  function onSaveName() {
    if (!canSaveName) return;
    updateName.mutate({ userId, firstName: firstName.trim(), lastName: lastName.trim() });
  }

  return (
    <div className="space-y-6">
      <div>
        <BackLink locale={locale} label={t('backLink')} />
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{u.name}</h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{u.email}</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>{t('profile.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="u-first">{t('profile.firstNameLabel')}</Label>
              <Input
                id="u-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={60}
                disabled={!canManage}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-last">{t('profile.lastNameLabel')}</Label>
              <Input
                id="u-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={60}
                disabled={!canManage}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                {t('profile.emailLabel')}
              </div>
              <div className="font-mono text-sm">{u.email}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                {t('profile.permissionSetLabel')}
              </div>
              <div className="text-sm">{u.permissionSetName ?? t('profile.noPermissionSet')}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                {t('profile.statusLabel')}
              </div>
              <div className="text-sm">
                {u.deactivatedAt !== null ? tUsers('status.deactivated') : tUsers('status.active')}
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" disabled={!canSaveName} onClick={onSaveName}>
              {tCommon('save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Groups */}
      <Card>
        <CardHeader>
          <CardTitle>{t('groups.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {groupMemberships.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('groups.empty')}</p>
          ) : (
            <ul className="divide-y">
              {groupMemberships.map((g) => (
                <li key={g.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{g.name}</span>
                  {g.addedVia === 'rule' ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {t('groups.viaRule')}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Sites */}
      <Card>
        <CardHeader>
          <CardTitle>{placesLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          {siteMemberships.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('sites.empty', { places })}</p>
          ) : (
            <ul className="divide-y">
              {siteMemberships.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                  <span style={{ paddingLeft: `${s.depth * 0.75}rem` }}>{s.name}</span>
                  {s.addedVia === 'rule' ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {t('groups.viaRule')}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Custom fields */}
      <Card>
        <CardHeader>
          <CardTitle>{t('customFields.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {fields === undefined ? (
            <Skeleton className="h-10 w-full" />
          ) : fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('customFields.empty')}</p>
          ) : (
            <div className="space-y-4">
              {fields.map((field) => {
                const stored = fieldValues.find((v) => v.fieldId === field.id)?.value ?? '';
                return (
                  <CustomFieldEditor
                    key={field.id}
                    field={field}
                    storedValue={stored}
                    userId={userId}
                    disabled={!canManage}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Training wallet summary + record-a-certificate (review round 4). */}
      {brandHasModule(activeBrand.id, 'training') && canViewTraining ? (
        <UserTrainingCard userId={userId} personName={data.user.name} locale={locale} />
      ) : null}

      {/* Everything this person has touched, per module the VIEWER may see. */}
      <UserActivityCard userId={userId} locale={locale} />
    </div>
  );
}

/**
 * The person's training at a glance: worst-first gap counts from the
 * same resolve pass every training view uses, a wallet link, and the
 * record-certificate dialog with the person prefilled — the admin
 * uploads the renewal without leaving the profile.
 */
function UserTrainingCard({
  userId,
  personName,
  locale,
}: {
  userId: string;
  personName: string;
  locale: string;
}) {
  const t = useTranslations('settings.userDetail');
  const tStatus = useTranslations('training.status');
  const canRecord = useHasPermission('training.record');
  const [recordOpen, setRecordOpen] = useState(false);
  const wallet = trpc.training.person.useQuery({ userId });

  const cells = wallet.data?.cells ?? [];
  const counts = {
    expired: cells.filter((c) => c.required && c.status === 'expired').length,
    expiring_soon: cells.filter((c) => c.required && c.status === 'expiring_soon').length,
    not_held: cells.filter((c) => c.required && c.status === 'not_held').length,
    in_date: cells.filter((c) => c.required && c.status === 'in_date').length,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('training.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {wallet.isLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : (
          <div className="flex flex-wrap gap-2 text-xs">
            {(['expired', 'not_held', 'expiring_soon', 'in_date'] as const).map((status) => (
              <span
                key={status}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${
                  status === 'expired' || status === 'not_held'
                    ? counts[status] > 0
                      ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'
                      : 'text-muted-foreground'
                    : status === 'expiring_soon' && counts[status] > 0
                      ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                      : 'text-muted-foreground'
                }`}
              >
                <span className="font-semibold tabular-nums">{counts[status]}</span>
                {tStatus(status)}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/${locale}/training/person/${userId}`}>{t('training.openWallet')}</Link>
          </Button>
          {canRecord ? (
            <Button size="sm" onClick={() => setRecordOpen(true)}>
              {t('training.recordCertificate')}
            </Button>
          ) : null}
        </div>
        <RecordDialog
          open={recordOpen}
          onOpenChange={setRecordOpen}
          prefill={{ userId, personName }}
        />
      </CardContent>
    </Card>
  );
}

/** One block per module: a count headline + up to five linked rows. */
function UserActivityCard({ userId, locale }: { userId: string; locale: string }) {
  const t = useTranslations('settings.userDetail');
  const overview = trpc.users.overview.useQuery({ id: userId });
  const data = overview.data;

  if (overview.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('activity.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (data === undefined) return null;

  const blocks: Array<{
    key: 'actions' | 'inspections' | 'observations' | 'incidents' | 'permits';
    total: number;
    extra?: string;
    rows: Array<{ id: string; reference: string | null; title: string; status: string }>;
    href: (id: string) => string;
  }> = [];
  if (data.actions !== null) {
    blocks.push({
      key: 'actions',
      total: data.actions.total,
      extra: t('activity.openCount', { count: data.actions.open }),
      rows: data.actions.recent.map((r) => ({
        id: r.id,
        reference: r.referenceNumber,
        title: r.title,
        status: r.status,
      })),
      href: (id) => `/${locale}/actions/${id}`,
    });
  }
  if (data.inspections !== null) {
    blocks.push({
      key: 'inspections',
      total: data.inspections.total,
      rows: data.inspections.recent.map((r) => ({
        id: r.id,
        reference: r.documentNumber,
        title: r.title,
        status: r.status,
      })),
      href: (id) => `/${locale}/inspections/${id}`,
    });
  }
  if (data.observations !== null) {
    blocks.push({
      key: 'observations',
      total: data.observations.total,
      rows: data.observations.recent.map((r) => ({
        id: r.id,
        reference: r.referenceNumber,
        title: r.title,
        status: r.status,
      })),
      href: (id) => `/${locale}/observations/${id}`,
    });
  }
  if (data.incidents !== null && brandHasModule(activeBrand.id, 'incidents')) {
    blocks.push({
      key: 'incidents',
      total: data.incidents.total,
      rows: data.incidents.recent.map((r) => ({
        id: r.id,
        reference: r.referenceNumber,
        title: r.title,
        status: r.status,
      })),
      href: (id) => `/${locale}/incidents/${id}`,
    });
  }
  if (data.permits !== null && brandHasModule(activeBrand.id, 'permits')) {
    blocks.push({
      key: 'permits',
      total: data.permits.total,
      rows: data.permits.recent.map((r) => ({
        id: r.id,
        reference: r.referenceNumber,
        title: r.title,
        status: r.status,
      })),
      href: (id) => `/${locale}/permits/${id}`,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('activity.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('activity.noAccess')}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {blocks.map((block) => (
              <div key={block.key} className="rounded-md border p-3">
                <p className="mb-1.5 text-sm font-medium">
                  {t(`activity.blocks.${block.key}`, { count: block.total })}
                  {block.extra !== undefined ? (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {block.extra}
                    </span>
                  ) : null}
                </p>
                {block.rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('activity.none')}</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {block.rows.map((row) => (
                      <li key={row.id} className="truncate">
                        <Link href={block.href(row.id)} className="hover:underline">
                          {row.reference !== null ? (
                            <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                              {row.reference}
                            </span>
                          ) : null}
                          {row.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BackLink({ locale, label }: { locale: string; label: string }) {
  return (
    <Link
      href={`/${locale}/settings/users`}
      className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="mr-1 h-4 w-4" />
      {label}
    </Link>
  );
}

interface CustomFieldDef {
  id: string;
  name: string;
  type: string;
  options: ReadonlyArray<{ id: string; label: string }>;
}

/**
 * Reads / writes a single custom-field value. Encoding by type:
 *   - text          → the raw string
 *   - select        → the chosen option id ('' clears the value)
 *   - multi_select  → JSON.stringify of the chosen option ids
 */
function CustomFieldEditor({
  field,
  storedValue,
  userId,
  disabled,
}: {
  field: CustomFieldDef;
  storedValue: string;
  userId: string;
  disabled: boolean;
}) {
  const t = useTranslations('settings.userDetail');
  const tCommon = useTranslations('common');
  const onServerError1 = useServerErrorToast(tCommon('error'));
  const utils = trpc.useUtils();

  const setValue = trpc.users.setCustomFieldValue.useMutation({
    onSuccess: () => {
      toast.success(t('customFields.savedToast'));
      void utils.users.get.invalidate({ id: userId });
    },
    onError: onServerError1,
  });

  const initialIds = parseMultiSelect(storedValue);
  const [text, setText] = useState(field.type === 'text' ? storedValue : '');
  const [selectId, setSelectId] = useState(field.type === 'select' ? storedValue : '');
  const [multiIds, setMultiIds] = useState<Set<string>>(new Set(initialIds));

  let draft: string;
  let dirty: boolean;
  if (field.type === 'select') {
    draft = selectId;
    dirty = selectId !== storedValue;
  } else if (field.type === 'multi_select') {
    draft = JSON.stringify([...multiIds]);
    dirty = JSON.stringify([...multiIds].sort()) !== JSON.stringify([...initialIds].sort());
  } else {
    draft = text;
    dirty = text !== storedValue;
  }

  function onSave() {
    if (disabled || !dirty || setValue.isPending) return;
    setValue.mutate({ userId, fieldId: field.id, value: draft });
  }

  function toggleMulti(id: string) {
    setMultiIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`cf-${field.id}`}>{field.name}</Label>
      {field.type === 'text' ? (
        <Input
          id={`cf-${field.id}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          disabled={disabled}
        />
      ) : field.type === 'select' ? (
        <select
          id={`cf-${field.id}`}
          value={selectId}
          onChange={(e) => setSelectId(e.target.value)}
          disabled={disabled}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">{t('customFields.selectNone')}</option>
          {field.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <div className="space-y-1 rounded-md border p-2">
          {field.options.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted/50"
            >
              <input
                type="checkbox"
                checked={multiIds.has(o.id)}
                onChange={() => toggleMulti(o.id)}
                disabled={disabled}
                className="h-4 w-4 rounded border-input accent-foreground"
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
      {dirty ? (
        <div className="flex justify-end pt-1">
          <Button
            type="button"
            size="sm"
            disabled={disabled || setValue.isPending}
            onClick={onSave}
          >
            {tCommon('save')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Guarded parse of a multi_select stored value (a JSON id array). */
function parseMultiSelect(stored: string): string[] {
  if (stored.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string');
    }
    return [];
  } catch {
    return [];
  }
}
