'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { trpc } from '../../lib/trpc/client';
import { ContentTab } from './content-tab';
import { useEditor } from './editor-context';
import { LogicTab } from './logic-tab';
import { ResponseSetsTab } from './response-sets-tab';
import { SettingsTab } from './settings-tab';

/**
 * Three-tab editor shell: Content, Response sets, Logic, Settings.
 * Orchestrates save + publish and renders the header + tabs. The
 * individual tabs pull state from the EditorProvider context.
 *
 * We intentionally keep the header + tab switching outside the reducer
 * so tab-switch doesn't dirty the template.
 */
export function EditorShell({ templateId }: { templateId: string }) {
  const t = useTranslations('templates.editor');
  const tStatus = useTranslations('templates.status');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const { state, dispatch } = useEditor();
  const utils = trpc.useUtils();
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [showConflict, setShowConflict] = useState(false);

  const saveDraft = trpc.templates.saveDraft.useMutation({
    onSuccess: () => {
      dispatch({ type: 'markClean' });
      toast.success(t('saveSuccess'));
      void utils.templates.get.invalidate({ templateId });
      void utils.templates.list.invalidate();
    },
    onError: (err) => {
      if (err.data?.code === 'CONFLICT') {
        setShowConflict(true);
        return;
      }
      toast.error(t('saveError'));
    },
  });

  const publish = trpc.templates.publish.useMutation({
    onSuccess: () => {
      setShowPublishConfirm(false);
      toast.success(t('publishSuccess'));
      void utils.templates.get.invalidate({ templateId });
      void utils.templates.list.invalidate();
    },
    onError: () => {
      toast.error(t('validationError'));
    },
  });

  function handleSave() {
    const payload: Parameters<typeof saveDraft.mutate>[0] = {
      templateId,
      content: state.content,
      ...(state.loadedUpdatedAt !== null
        ? { expectedUpdatedAt: state.loadedUpdatedAt }
        : {}),
    };
    saveDraft.mutate(payload);
  }

  function handlePublish() {
    publish.mutate({ templateId });
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/${locale}/templates`}>← {t('backToList')}</Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{state.name}</h1>
            <p className="text-xs text-muted-foreground">
              {state.isDirty ? tStatus('draft') : tStatus('published')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSave}
            disabled={saveDraft.isPending || !state.isDirty}
            aria-label={t('saveButton')}
          >
            {t('saveButton')}
          </Button>
          <Button
            onClick={() => setShowPublishConfirm(true)}
            disabled={publish.isPending}
            aria-label={t('publishButton')}
          >
            {t('publishButton')}
          </Button>
        </div>
      </header>

      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">{t('content')}</TabsTrigger>
          <TabsTrigger value="responseSets">{t('responseSets')}</TabsTrigger>
          <TabsTrigger value="logic">{t('logic')}</TabsTrigger>
          <TabsTrigger value="settings">{t('settings')}</TabsTrigger>
        </TabsList>
        <TabsContent value="content">
          <ContentTab />
        </TabsContent>
        <TabsContent value="responseSets">
          <ResponseSetsTab />
        </TabsContent>
        <TabsContent value="logic">
          <LogicTab />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab templateId={templateId} />
        </TabsContent>
      </Tabs>

      <Dialog open={showPublishConfirm} onOpenChange={setShowPublishConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('publishConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('publishConfirmBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowPublishConfirm(false)}
              aria-label={tStatus('draft')}
            >
              {tStatus('draft')}
            </Button>
            <Button
              onClick={handlePublish}
              disabled={publish.isPending}
              aria-label={t('publishConfirmCta')}
            >
              {t('publishConfirmCta')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showConflict} onOpenChange={setShowConflict}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('conflictTitle')}</DialogTitle>
            <DialogDescription>{t('conflictBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => window.location.reload()}
              aria-label={t('conflictReload')}
            >
              {t('conflictReload')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
