'use client';

import { ArrowLeft, ChevronDown, ChevronUp, Plus, QrCode, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { appConfirm } from '../../../../src/components/ui/app-confirm';
import { appPrompt } from '../../../../src/components/ui/app-prompt';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { contractorErrorMessage } from '../../../../src/lib/contractor-errors';
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

  const onErr = (err: { message: string }) => toast.error(contractorErrorMessage(err.message, t));

  const regen = trpc.contractors.gate.regenerateToken.useMutation({
    onSuccess: () => {
      toast.success(t('gate.linkGenerated'));
      void utils.contractors.gate.config.invalidate();
      setNewSiteId('');
    },
    onError: onErr,
  });
  const revoke = trpc.contractors.gate.revokeToken.useMutation({
    onSuccess: (res) => {
      toast.success(res.revoked > 0 ? t('gate.linkRevoked') : t('gate.nothingToRevoke'));
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
  const [newSiteId, setNewSiteId] = useState('');

  // `listForConductor` rather than `sites.list`: this page is gated on
  // `contractors.manage`, and `sites.list` needs `sites.view` — a permission
  // set with one and not the other would get a rejected query rendered as
  // "no sites", with no way to mint a kiosk link at all.
  const sitesQ = trpc.sites.listForConductor.useQuery();
  const kiosks = configQ.data?.kiosks ?? [];
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const urlFor = (tok: string | null) =>
    tok === null || origin === '' ? null : `${origin}/${locale}/gate/${tok}`;
  const takenSiteIds = new Set(
    kiosks.map((k) => k.siteId).filter((id): id is string => id !== null),
  );
  const availableSites = (sitesQ.data ?? []).filter((site) => !takenSiteIds.has(site.id));
  const hasLegacy = kiosks.some((k) => k.siteId === null);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('gate.linkCopied'));
    } catch {
      // Clipboard refused (permissions, non-secure context): show the URL
      // in a real dialog input instead of window.prompt (UXW3-01 — kiosk
      // and WebView contexts suppress native prompts entirely).
      void appPrompt({
        title: t('gate.kioskHeading'),
        label: t('gate.linkLabel'),
        initialValue: url,
      });
    }
  }

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

      {/* Kiosk QR + link — one per site (CT-G06) */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">{t('gate.kioskHeading')}</h2>
          <p className="text-sm text-muted-foreground">{t('gate.kioskSubtitle')}</p>
        </div>

        {configQ.error ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-destructive">
              {t('error')}
            </CardContent>
          </Card>
        ) : configQ.isLoading ? (
          <Skeleton className="h-44 w-full" />
        ) : kiosks.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {t('gate.noLinkYet')}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {kiosks.map((k) => {
              const url = urlFor(k.gateToken);
              return (
                <Card key={k.id}>
                  <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
                    <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-lg border bg-white p-3">
                      {url !== null ? (
                        <QRCodeCanvas value={url} size={140} level="M" marginSize={0} />
                      ) : (
                        <QrCode className="h-10 w-10 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold">
                          {k.siteName ?? t('gate.legacyKioskName')}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {k.siteId === null ? t('gate.legacyKioskHint') : t('gate.siteKioskHint')}
                        </p>
                      </div>
                      {url !== null ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="max-w-full truncate rounded bg-muted px-2 py-1 text-xs">
                            {url}
                          </code>
                          <Button size="sm" variant="outline" onClick={() => void copy(url)}>
                            {t('gate.copyLink')}
                          </Button>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">{t('gate.noLinkYet')}</p>
                      )}
                      {canManage ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={regen.isPending}
                            onClick={() => regen.mutate({ siteId: k.siteId })}
                          >
                            <RefreshCw className="mr-1 h-3.5 w-3.5" />
                            {t('gate.regenerateLink')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            disabled={revoke.isPending}
                            onClick={() => {
                              void appConfirm({
                                description: t('gate.revokeConfirm'),
                                destructive: true,
                              }).then((ok) => {
                                if (ok) revoke.mutate({ siteId: k.siteId });
                              });
                            }}
                          >
                            {t('gate.revokeLink')}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {canManage && configQ.error == null && !configQ.isLoading ? (
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 p-4">
              <div className="min-w-[14rem] flex-1 space-y-1.5">
                <Label htmlFor="gate-site">{t('gate.newKioskSite')}</Label>
                <select
                  id="gate-site"
                  value={newSiteId}
                  onChange={(e) => setNewSiteId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">{t('gate.selectSite')}</option>
                  {hasLegacy ? null : (
                    <option value="__legacy__">{t('gate.legacyKioskName')}</option>
                  )}
                  {availableSites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">{t('gate.newKioskHint')}</p>
              </div>
              <Button
                disabled={regen.isPending || newSiteId === ''}
                onClick={() =>
                  regen.mutate(
                    newSiteId === '__legacy__' ? { siteId: null } : { siteId: newSiteId },
                  )
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                {t('gate.generateLink')}
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </section>

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
                onClick={() => createField.mutate({ label: label.trim(), fieldType, required })}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t('gate.addField')}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {fieldsQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : fieldsQ.error ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-destructive">
              {t('error')}
            </CardContent>
          </Card>
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
                {(fieldsQ.data ?? []).map((f, i, all) => (
                  <li key={f.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    {/* The router accepted label / fieldType / sortOrder
                        edits that no control could reach: a typo in a gate
                        question could only be fixed by deleting it and
                        losing every answer recorded against it. */}
                    {canManage ? (
                      <Input
                        aria-label={t('gate.fieldLabel')}
                        className="h-8 flex-1"
                        defaultValue={f.label}
                        maxLength={200}
                        disabled={updateField.isPending}
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          if (next !== '' && next !== f.label) {
                            updateField.mutate({ id: f.id, label: next });
                          }
                        }}
                      />
                    ) : (
                      <span className="flex-1 font-medium">{f.label}</span>
                    )}
                    {canManage ? (
                      <select
                        aria-label={t('gate.fieldType')}
                        value={f.fieldType}
                        disabled={updateField.isPending}
                        onChange={(e) =>
                          updateField.mutate({
                            id: f.id,
                            fieldType: e.target.value as FieldType,
                          })
                        }
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      >
                        <option value="text">{t('gate.type_text')}</option>
                        <option value="number">{t('gate.type_number')}</option>
                        <option value="yes_no">{t('gate.type_yes_no')}</option>
                      </select>
                    ) : (
                      <span className="rounded-md border bg-background px-2 py-0.5 text-xs text-muted-foreground">
                        {t(`gate.type_${f.fieldType}` as 'gate.type_text')}
                      </span>
                    )}
                    {canManage ? (
                      <div className="flex shrink-0 items-center">
                        <button
                          type="button"
                          aria-label={t('gate.moveUp')}
                          disabled={i === 0 || updateField.isPending}
                          className="rounded p-1 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                          onClick={() => {
                            const above = all[i - 1];
                            if (above === undefined) return;
                            // Swap the two orders, so the pair cannot end up
                            // sharing one and flip-flopping on every reload.
                            updateField.mutate({ id: f.id, sortOrder: above.sortOrder });
                            updateField.mutate({ id: above.id, sortOrder: f.sortOrder });
                          }}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={t('gate.moveDown')}
                          disabled={i === all.length - 1 || updateField.isPending}
                          className="rounded p-1 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                          onClick={() => {
                            const below = all[i + 1];
                            if (below === undefined) return;
                            updateField.mutate({ id: f.id, sortOrder: below.sortOrder });
                            updateField.mutate({ id: below.id, sortOrder: f.sortOrder });
                          }}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                      </div>
                    ) : null}
                    {canManage ? (
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={f.required}
                          disabled={updateField.isPending}
                          onChange={(e) =>
                            updateField.mutate({ id: f.id, required: e.target.checked })
                          }
                        />
                        {t('gate.fieldRequired')}
                      </label>
                    ) : f.required ? (
                      <span className="text-xs text-muted-foreground">
                        {t('gate.fieldRequired')}
                      </span>
                    ) : null}
                    {canManage ? (
                      <button
                        type="button"
                        aria-label={t('gate.removeField')}
                        disabled={removeField.isPending}
                        className="rounded p-1 text-muted-foreground hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
                        onClick={() => {
                          void appConfirm({
                            description: t('gate.removeFieldConfirm'),
                            destructive: true,
                          }).then((ok) => {
                            if (ok) removeField.mutate({ id: f.id });
                          });
                        }}
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
