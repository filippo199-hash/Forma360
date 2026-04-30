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
import { trpc } from '../../lib/trpc/client';
import { ContentTab } from './content-tab';
import { useEditor } from './editor-context';
import { LogicTab } from './logic-tab';
import { ResponseSetsTab } from './response-sets-tab';
import { SettingsTab } from './settings-tab';

type ActiveTab = 'build' | 'responseSets' | 'logic' | 'settings';

/**
 * Full-screen editor shell replicating the iAuditor / SafetyCulture layout.
 * Uses `fixed inset-0 z-50` to break out of the locale layout's max-width
 * container. Top bar holds the back link, inline title, status badge, tab
 * switcher (centre), and action buttons.
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
  const [activeTab, setActiveTab] = useState<ActiveTab>('build');

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

  const tabs: { id: ActiveTab; label: string }[] = [
    { id: 'build', label: t('build') },
    { id: 'responseSets', label: t('responseSets') },
    { id: 'logic', label: t('logic') },
    { id: 'settings', label: t('settings') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#F5F6F8]">
      {/* ─── Top bar ─────────────────────────────────────────────────────── */}
      <header
        className="flex h-[60px] shrink-0 items-center border-b border-[#E5E7EB] bg-white px-4"
        style={{ gap: 0 }}
      >
        {/* Left group */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="shrink-0 text-[#6B7280] hover:text-[#111827]"
          >
            <Link href={`/${locale}/templates`}>← {t('backToList')}</Link>
          </Button>
          <span className="shrink-0 text-[#9CA3AF]">/</span>
          <input
            type="text"
            value={state.content.title}
            onChange={(e) =>
              dispatch({ type: 'updateContentTitle', title: e.target.value })
            }
            className="min-w-0 flex-1 truncate bg-transparent text-sm font-medium text-[#111827] outline-none"
            aria-label={t('settingsTab.templateTitleLabel')}
          />
          {/* Status badge */}
          {state.isDirty ? (
            <span className="shrink-0 rounded-full bg-[#FEF3C7] px-2 py-0.5 text-xs font-medium text-[#D97706]">
              {tStatus('draft')}
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-[#D1FAE5] px-2 py-0.5 text-xs font-medium text-[#059669]">
              {tStatus('published')}
            </span>
          )}
        </div>

        {/* Centre group — tabs */}
        <nav className="mx-auto flex items-center gap-1 px-4" aria-label="Editor tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-[#F0FBF7] text-[#00B47E]'
                  : 'text-[#6B7280] hover:bg-[#F5F6F8] hover:text-[#111827]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Right group — actions */}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={saveDraft.isPending || !state.isDirty}
            aria-label={t('saveButton')}
          >
            {t('saveButton')}
          </Button>
          <Button
            size="sm"
            onClick={() => setShowPublishConfirm(true)}
            disabled={publish.isPending}
            className="bg-[#00B47E] text-white hover:bg-[#00A370]"
            aria-label={t('publishButton')}
          >
            {t('publishButton')}
          </Button>
        </div>
      </header>

      {/* ─── Content area ────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {activeTab === 'build' && <ContentTab />}
        {activeTab === 'responseSets' && <ResponseSetsTab />}
        {activeTab === 'logic' && <LogicTab />}
        {activeTab === 'settings' && <SettingsTab templateId={templateId} />}
      </div>

      {/* ─── Dialogs ─────────────────────────────────────────────────────── */}
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
