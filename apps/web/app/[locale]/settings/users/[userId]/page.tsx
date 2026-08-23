'use client';

import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DetailNotFound } from '../../../../../src/components/detail-not-found';
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
    </div>
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
