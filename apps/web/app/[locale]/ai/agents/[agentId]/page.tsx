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
import { usePermissionList } from '../../../../../src/lib/permissions-context';
import { useServerErrorMessage } from '../../../../../src/lib/use-server-error';
import { trpc } from '../../../../../src/lib/trpc/client';

export default function AgentSettingsPage() {
  const t = useTranslations('aiAgents');
  const params = useParams<{ locale: string; agentId: string }>();
  const locale = params.locale ?? 'en';
  const rawAgentId = params.agentId ?? '';
  const permissions = usePermissionList();
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
    onSuccess: () => {
      setDirty(false);
      toast.success(t('settingsPage.savedToast'));
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
        toast.error(t('settingsPage.uploadFailedToast', { maxMb }));
        return;
      }
      await utils.aiAgents.get.invalidate({ agentId: data.id });
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
      </header>

      {!canEdit ? (
        <p className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t('settingsPage.adminOnly')}
        </p>
      ) : null}

      <Card className="mb-4">
        <CardContent className="flex items-center justify-between gap-4 p-4">
          <div>
            <p className="text-sm font-medium">{t('settingsPage.enabled')}</p>
            <p className="text-xs text-muted-foreground">{t('settingsPage.enabledHint')}</p>
          </div>
          <Switch
            checked={enabled}
            disabled={!canEdit}
            onCheckedChange={(v) => {
              setEnabled(v);
              setDirty(true);
            }}
            aria-label={t('settingsPage.enabled')}
          />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="p-4">
          <p className="mb-1 text-sm font-medium">{t('settingsPage.knowledgeTitle')}</p>
          <p className="mb-2 text-xs text-muted-foreground">
            {t('settingsPage.knowledgeHintLabel')}: {t(`agents.${data.id}.knowledgeHint` as never)}
          </p>
          <p className="mb-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
            {t('settingsPage.knowledgePrivacy')}
          </p>
          <Textarea
            value={knowledge}
            disabled={!canEdit}
            maxLength={data.limits.textChars}
            rows={6}
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
                    <SelectTrigger className="w-48">
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
    </div>
  );
}
