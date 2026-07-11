'use client';

import { ArrowLeft, Plus, QrCode, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

type FieldType = 'text' | 'number' | 'yes_no';

export default function ContractorGatePage() {
  const t = useTranslations('contractors');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('contractors.manage');
  const utils = trpc.useUtils();

  const configQ = trpc.contractors.gate.config.useQuery();
  const fieldsQ = trpc.contractors.gateFields.list.useQuery();

  const onErr = (err: { message: string }) =>
    toast.error(err.message.length > 0 ? err.message : t('error'));

  const regen = trpc.contractors.gate.regenerateToken.useMutation({
    onSuccess: () => {
      toast.success(t('gate.linkGenerated'));
      void utils.contractors.gate.config.invalidate();
    },
    onError: onErr,
  });
  const createField = trpc.contractors.gateFields.create.useMutation({
    onSuccess: () => {
      void utils.contractors.gateFields.list.invalidate();
      setLabel('');
      setRequired(false);
      setFieldType('text');
    },
    onError: onErr,
  });
  const removeField = trpc.contractors.gateFields.remove.useMutation({
    onSuccess: () => void utils.contractors.gateFields.list.invalidate(),
    onError: onErr,
  });
  const updateField = trpc.contractors.gateFields.update.useMutation({
    onSuccess: () => void utils.contractors.gateFields.list.invalidate(),
    onError: onErr,
  });

  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState<FieldType>('text');
  const [required, setRequired] = useState(false);

  const token = configQ.data?.gateToken ?? null;
  const kioskUrl =
    token !== null && typeof window !== 'undefined'
      ? `${window.location.origin}/${locale}/gate/${token}`
      : null;

  return (
    <div className="space-y-6 px-4 py-6">
      <Link
        href={`/${locale}/contractors`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('backToList')}
      </Link>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('gate.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('gate.subtitle')}</p>
      </header>

      {/* Kiosk QR + link */}
      <Card>
        <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
          <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-lg border bg-white p-3">
            {kioskUrl !== null ? (
              <QRCodeCanvas value={kioskUrl} size={140} level="M" marginSize={0} />
            ) : (
              <QrCode className="h-10 w-10 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h2 className="text-base font-semibold">{t('gate.kioskHeading')}</h2>
              <p className="text-sm text-muted-foreground">{t('gate.kioskSubtitle')}</p>
            </div>
            {kioskUrl !== null ? (
              <div className="flex flex-wrap items-center gap-2">
                <code className="max-w-full truncate rounded bg-muted px-2 py-1 text-xs">
                  {kioskUrl}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(kioskUrl);
                      toast.success(t('gate.linkCopied'));
                    } catch {
                      window.prompt(t('gate.kioskHeading'), kioskUrl);
                    }
                  }}
                >
                  {t('gate.copyLink')}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('gate.noLinkYet')}</p>
            )}
            {canManage ? (
              <Button
                size="sm"
                variant={token === null ? 'default' : 'outline'}
                disabled={regen.isPending}
                onClick={() => regen.mutate()}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                {token === null ? t('gate.generateLink') : t('gate.regenerateLink')}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Capture fields */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">{t('gate.fieldsHeading')}</h2>
          <p className="text-sm text-muted-foreground">{t('gate.fieldsSubtitle')}</p>
        </div>

        {canManage ? (
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 p-4">
              <div className="min-w-[12rem] flex-1 space-y-1.5">
                <Label htmlFor="gf-label">{t('gate.fieldLabel')}</Label>
                <Input
                  id="gf-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={t('gate.fieldLabelPlaceholder')}
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gf-type">{t('gate.fieldType')}</Label>
                <select
                  id="gf-type"
                  value={fieldType}
                  onChange={(e) => setFieldType(e.target.value as FieldType)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="text">{t('gate.type_text')}</option>
                  <option value="number">{t('gate.type_number')}</option>
                  <option value="yes_no">{t('gate.type_yes_no')}</option>
                </select>
              </div>
              <label className="flex h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={required}
                  onChange={(e) => setRequired(e.target.checked)}
                />
                {t('gate.fieldRequired')}
              </label>
              <Button
                disabled={createField.isPending || label.trim() === ''}
                onClick={() =>
                  createField.mutate({ label: label.trim(), fieldType, required })
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                {t('gate.addField')}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {fieldsQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (fieldsQ.data ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {t('gate.noFields')}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {(fieldsQ.data ?? []).map((f) => (
                  <li key={f.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className="flex-1 font-medium">{f.label}</span>
                    <span className="rounded-md border bg-background px-2 py-0.5 text-xs text-muted-foreground">
                      {t(`gate.type_${f.fieldType}` as 'gate.type_text')}
                    </span>
                    {canManage ? (
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={f.required}
                          onChange={(e) =>
                            updateField.mutate({ id: f.id, required: e.target.checked })
                          }
                        />
                        {t('gate.fieldRequired')}
                      </label>
                    ) : f.required ? (
                      <span className="text-xs text-muted-foreground">{t('gate.fieldRequired')}</span>
                    ) : null}
                    {canManage ? (
                      <button
                        type="button"
                        aria-label={t('gate.removeField')}
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                        onClick={() => removeField.mutate({ id: f.id })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
