'use client';

/**
 * One agent's settings page (AI Agents feature).
 *
 * Deliberately plain for a non-technical audience: what the agent does
 * in words, an on/off switch, one big "teach it about your company" box
 * with an example, the document list, and at most three dropdowns.
 * Admins (org.settings) edit; everyone else sees the same page read-only
 * with a line saying who can change it — an employee may always see what
 * shapes the drafts they will be asked to sign.
 *
 * Save is one explicit button (no autosave): an admin writing a careful
 * paragraph about company standards expects to decide when it counts.
 */
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { isAiAgentId } from '@forma360/shared/ai-agents';
import { ArrowLeft, FileWarning, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { appConfirm } from '../../../../../src/components/ui/app-confirm';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../src/components/ui/select';
import { Switch } from '../../../../../src/components/ui/switch';
import { Textarea } from '../../../../../src/components/ui/textarea';
import { activeBrand } from '../../../../../src/lib/brand';
import { formatDate } from '../../../../../src/lib/format-date';
import { useEntitlementList, usePermissionList } from '../../../../../src/lib/permissions-context';
import { useServerErrorMessage } from '../../../../../src/lib/use-server-error';
import { trpc } from '../../../../../src/lib/trpc/client';

export default function AgentSettingsPage() {
  const t = useTranslations('aiAgents');
  const params = useParams<{ locale: string; agentId: string }>();
  const locale = params.locale ?? 'en';
  const rawAgentId = params.agentId ?? '';
  const permissions = usePermissionList();
  const entitlements = useEntitlementList();
  const canEdit = grantsAdminAccess(permissions);
  const serverError = useServerErrorMessage();
  const utils = trpc.useUtils();

  const agentId = isAiAgentId(rawAgentId) ? rawAgentId : null;
  const detail = trpc.aiAgents.get.useQuery(
    { agentId: agentId ?? 'ra-drafter' },
    { enabled: agentId !== null },
  );

  const [enabled, setEnabled] = useState(true);
  const [knowledge, setKnowledge] = useState('');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const hydratedFor = useRef<string | null>(null);

  useEffect(() => {
    if (detail.data === undefined) return;
    // Hydrate the form once per agent; later refetches (e.g. the global
    // mutation-cache invalidation) must not wipe unsaved typing.
    if (hydratedFor.current === detail.data.id) return;
    hydratedFor.current = detail.data.id;
    setEnabled(detail.data.enabled);
    setKnowledge(detail.data.knowledge);
    setSettings(detail.data.settings);
    setDirty(false);
  }, [detail.data]);

  const update = trpc.aiAgents.updateSettings.useMutation({
    onSuccess: (_data, vars) => {
      setDirty(false);
      // A save that switched the agent OFF must confirm THAT, not
      // promise "its next draft" from the agent just stopped (AGS-07).
      toast.success(
        vars.enabled === false ? t('settingsPage.savedOffToast') : t('settingsPage.savedToast'),
      );
    },
    onError: (err) => {
      toast.error(serverError(err, t('settingsPage.saveFailedToast')));
    },
  });
  const deleteFile = trpc.aiAgents.deleteKnowledgeFile.useMutation({
    onError: (err) => {
      toast.error(serverError(err, t('settingsPage.saveFailedToast')));
    },
  });

  if (agentId === null) notFound();
  if (detail.data === undefined) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }
  const data = detail.data;
  const maxMb = Math.round(data.limits.fileBytes / (1024 * 1024));

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('agentId', data.id);
      form.append('file', file);
      const res = await fetch('/api/upload/ai-knowledge', { method: 'POST', body: form });
      if (!res.ok) {
        // Blame the file only when the file IS the problem — a storage
        // or server failure told an admin her compliant file was too
        // big and sent her debugging herself (AGS-03). Comparing the
        // code, never rendering the message.
        let code = '';
        try {
          code = ((await res.json()) as { error?: string }).error ?? '';
        } catch {
          code = '';
        }
        if (code === 'TOO_MANY_FILES') {
          // A count limit, not a size/type problem — name the limits.
          toast.error(t('settingsPage.filesHint', { maxFiles: data.limits.maxFiles, maxMb }));
        } else if (
          code === 'FILE_TOO_LARGE' ||
          code === 'UNSUPPORTED_MEDIA_TYPE' ||
          code === 'EMPTY_FILE' ||
          code === 'BAD_REQUEST'
        ) {
          toast.error(t('settingsPage.uploadFailedToast', { maxMb }));
        } else {
          toast.error(t('settingsPage.uploadStoreFailedToast'));
        }
        return;
      }
      await utils.aiAgents.get.invalidate({ agentId: data.id });
    } catch {
      // A dead connection reaches here — silence was the one banned
      // outcome (the review's no-toast-at-all path).
      toast.error(t('settingsPage.uploadStoreFailedToast'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <Link
        href={`/${locale}/ai/agents`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('settingsPage.back')}
      </Link>

      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t(`agents.${data.id}.name` as never)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(`agents.${data.id}.description` as never)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {t('settingsPage.draftOnly', { productName: activeBrand.name })}
        </p>
        <Link
          href={`/${locale}${data.workRoute}`}
          className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
        >
          {t('settingsPage.useItAt')}
        </Link>
        {/* Where the button actually lives (AGS-08): the link alone
            stranded a manager three unsignposted clicks short of a
            deep-mounted agent. */}
        <p className="mt-1 text-xs text-muted-foreground">
          {t(`agents.${data.id}.whereHint` as never)}
        </p>
        {data.entitlement !== null && !entitlements.includes(data.entitlement) ? (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {t('settingsPage.planRequired')}
          </p>
        ) : null}
      </header>

      {!canEdit ? (
        <p className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t('settingsPage.adminOnly')}
        </p>
      ) : (
        <p className="mb-4 text-xs text-muted-foreground">{t('settingsPage.adminInfo')}</p>
      )}

      <Card className="mb-4">
        <CardContent className="flex items-center justify-between gap-4 p-4">
          <div>
            {/* The label follows the switch (AGS-07): a static "Agent is
                on" beside an off switch read as two truths at once. */}
            <p className="text-sm font-medium">
              {enabled ? t('settingsPage.enabled') : t('settingsPage.enabledOff')}
            </p>
            <p className="text-xs text-muted-foreground">{t('settingsPage.enabledHint')}</p>
          </div>
          <Switch
            checked={enabled}
            disabled={!canEdit}
            onCheckedChange={(v) => {
              setEnabled(v);
              setDirty(true);
            }}
            aria-label={enabled ? t('settingsPage.enabled') : t('settingsPage.enabledOff')}
          />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="p-4">
          <p className="mb-1 text-sm font-medium">{t('settingsPage.knowledgeTitle')}</p>
          {/* The hint carries its own "e.g." — a "For example:" prefix
              doubled it on the page's most-read line (AGS-20). */}
          <p className="mb-2 text-xs text-muted-foreground">
            {t(`agents.${data.id}.knowledgeHint` as never)}
          </p>
          <p className="mb-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
            {t('settingsPage.knowledgePrivacy')}
          </p>
          <Textarea
            value={knowledge}
            disabled={!canEdit}
            maxLength={data.limits.textChars}
            rows={6}
            aria-label={t('settingsPage.knowledgeTitle')}
            onChange={(e) => {
              setKnowledge(e.target.value);
              setDirty(true);
            }}
          />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="p-4">
          <p className="mb-1 text-sm font-medium">{t('settingsPage.filesTitle')}</p>
          <p className="mb-3 text-xs text-muted-foreground">
            {t('settingsPage.filesHint', { maxFiles: data.limits.maxFiles, maxMb })}
          </p>
          {data.files.length > 0 ? (
            <ul className="mb-3 space-y-2">
              {data.files.map((file) => (
                <li key={file.id} className="flex items-center gap-2 text-sm">
                  {file.status === 'failed' ? (
                    <FileWarning className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                  ) : (
                    <Paperclip
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                  {file.status === 'failed' ? (
                    <span className="shrink-0 text-xs text-amber-700">
                      {t('settingsPage.fileFailed')}
                    </span>
                  ) : file.extractedChars > data.limits.fileChars ? (
                    <span
                      className="shrink-0 text-xs text-amber-700"
                      title={t('settingsPage.fileTruncated')}
                    >
                      {t('settingsPage.fileTruncated')}
                    </span>
                  ) : null}
                  {canEdit ? (
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
                      aria-label={t('settingsPage.removeFile')}
                      onClick={() => {
                        void (async () => {
                          const ok = await appConfirm(t('settingsPage.removeFileConfirm'));
                          if (!ok) return;
                          await deleteFile.mutateAsync({ fileId: file.id });
                          await utils.aiAgents.get.invalidate({ agentId: data.id });
                        })();
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {canEdit && data.files.length < data.limits.maxFiles ? (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="h-4 w-4" aria-hidden="true" />
              )}
              {uploading ? t('settingsPage.uploading') : t('settingsPage.upload')}
              <input
                type="file"
                className="sr-only"
                accept="application/pdf,text/plain,text/csv,image/*"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file !== undefined) void uploadFile(file);
                }}
              />
            </label>
          ) : null}
        </CardContent>
      </Card>

      {data.settingDefs.length > 0 ? (
        <Card className="mb-4">
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-medium">{t('settingsPage.preferencesTitle')}</p>
            <div className="space-y-3">
              {data.settingDefs.map((def) => (
                <div key={def.key} className="flex items-center justify-between gap-4">
                  <p className="text-sm">{t(`fields.${def.key}.label` as never)}</p>
                  <Select
                    value={settings[def.key] ?? def.options[0] ?? ''}
                    disabled={!canEdit}
                    onValueChange={(v) => {
                      setSettings((prev) => ({ ...prev, [def.key]: v }));
                      setDirty(true);
                    }}
                  >
                    <SelectTrigger
                      className="w-48"
                      aria-label={t(`fields.${def.key}.label` as never)}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {def.options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {t(`fields.${def.key}.options.${option}` as never)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {canEdit ? (
        <Button
          disabled={!dirty || update.isPending}
          onClick={() => {
            update.mutate({ agentId: data.id, enabled, knowledge, settings });
          }}
        >
          {t('settingsPage.save')}
        </Button>
      ) : null}
      {/* Page-level on purpose: the stamp covers ANY change to this
          agent's settings row (a bare on/off toggle included), so under
          the knowledge box it would misattribute authorship. */}
      {data.updatedAt !== null && data.updatedByName !== null ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {t('settingsPage.lastEdited', {
            name: data.updatedByName,
            date: formatDate(data.updatedAt, locale),
          })}
        </p>
      ) : null}
    </div>
  );
}
