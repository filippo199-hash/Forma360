'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
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
import { ChevronRight } from 'lucide-react';
import { ContentTab } from './content-tab';
import { useEditor } from './editor-context';
import { SettingsTab } from './settings-tab';
import { VisibilityTab } from './visibility-tab';

type ActiveTab = 'build' | 'settings' | 'visibility';

/**
 * Full-screen editor shell replicating the iAuditor / SafetyCulture layout.
 * Uses `fixed inset-0 z-50` to break out of the locale layout's max-width
 * container. Top bar holds the back link, inline title, status badge, tab
 * switcher (centre), and action buttons.
 */
export function EditorShell({
  templateId,
  templateStatus,
}: {
  templateId: string;
  /** Persisted status from the server. Drives the status badge independently of
   *  the local isDirty flag so that "Save draft" never incorrectly shows
   *  "Published". */
  templateStatus: 'draft' | 'published' | 'archived';
}) {
  const t = useTranslations('templates.editor');
  const tStatus = useTranslations('templates.status');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const { state, dispatch } = useEditor();
  const utils = trpc.useUtils();
  const router = useRouter();
  const [showConflict, setShowConflict] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('build');
  /** True while the user is stepping through the publish wizard (Build → Settings → Visibility). */
  const [publishMode, setPublishMode] = useState(false);
  // Lets the top-bar "Publish" button trigger VisibilityTab's save→publish chain.
  const visibilitySubmitRef = useRef<(() => void) | null>(null);

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
      toast.success(t('publishSuccess'));
      void utils.templates.get.invalidate({ templateId });
      void utils.templates.list.invalidate();
      // Redirect to the templates list after the wizard completes.
      router.push(`/${locale}/templates`);
    },
    onError: (err) => {
      const message = err.message ?? '';
      if (err.data?.code === 'BAD_REQUEST' && /no draft to publish/i.test(message)) {
        toast.error(t('nothingToPublish'));
        return;
      }
      toast.error(t('saveError'));
    },
  });

  function handleSave() {
    const payload: Parameters<typeof saveDraft.mutate>[0] = {
      templateId,
      content: state.content,
      ...(state.loadedUpdatedAt !== null ? { expectedUpdatedAt: state.loadedUpdatedAt } : {}),
    };
    saveDraft.mutate(payload);
  }

  /**
   * Step 1 → 2: Publish button clicked on Build tab.
   * If there are unsaved changes we save the draft first so no work is lost
   * even if the user abandons the wizard mid-flow. Only then do we enter
   * wizard mode and navigate to Settings.
   */
  function handlePublishClick() {
    if (state.isDirty) {
      const payload: Parameters<typeof saveDraft.mutate>[0] = {
        templateId,
        content: state.content,
        ...(state.loadedUpdatedAt !== null ? { expectedUpdatedAt: state.loadedUpdatedAt } : {}),
      };
      saveDraft.mutate(payload, {
        onSuccess: () => {
          setPublishMode(true);
          setActiveTab('settings');
        },
      });
    } else {
      setPublishMode(true);
      setActiveTab('settings');
    }
  }

  /**
   * Step 2 → 3: "Continue to Visibility" clicked from Settings tab.
   * Auto-saves the draft when there are unsaved changes before proceeding so
   * that the published version reflects the latest settings.
   */
  function handleSettingsNext() {
    if (state.isDirty) {
      const payload: Parameters<typeof saveDraft.mutate>[0] = {
        templateId,
        content: state.content,
        ...(state.loadedUpdatedAt !== null ? { expectedUpdatedAt: state.loadedUpdatedAt } : {}),
      };
      saveDraft.mutate(payload, {
        onSuccess: () => {
          setActiveTab('visibility');
        },
      });
    } else {
      setActiveTab('visibility');
    }
  }

  /**
   * Step 3 finish: called by VisibilityTab after it has persisted the access
   * settings. We now publish the current draft and redirect to the list.
   */
  function handleVisibilityPublish() {
    publish.mutate({ templateId });
  }

  /**
   * Top-bar Publish clicked while on the Visibility tab — whether or not the
   * user entered via the wizard. Save any unsaved build changes first, then let
   * VisibilityTab persist the CURRENT audience and publish. This is what stops
   * a visibility selection made after jumping straight to this tab via the
   * stepper from being silently discarded on publish (bug B1).
   */
  function handlePublishFromVisibility() {
    if (state.isDirty) {
      const payload: Parameters<typeof saveDraft.mutate>[0] = {
        templateId,
        content: state.content,
        ...(state.loadedUpdatedAt !== null ? { expectedUpdatedAt: state.loadedUpdatedAt } : {}),
      };
      saveDraft.mutate(payload, {
        onSuccess: () => visibilitySubmitRef.current?.(),
      });
    } else {
      visibilitySubmitRef.current?.();
    }
  }

  const tabs: { id: ActiveTab; label: string }[] = [
    { id: 'build', label: t('build') },
    { id: 'settings', label: t('settings') },
    { id: 'visibility', label: t('visibility') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-muted">
      {/* ─── Top bar ─────────────────────────────────────────────────────── */}
      <header
        className="flex h-[60px] shrink-0 items-center border-b bg-background px-4"
        style={{ gap: 0 }}
      >
        {/* Left group */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Link href={`/${locale}/templates`}>← {t('backToList')}</Link>
          </Button>
          <span className="shrink-0 text-muted-foreground">/</span>
          <input
            type="text"
            value={state.content.title}
            title={state.content.title}
            onChange={(e) => dispatch({ type: 'updateContentTitle', title: e.target.value })}
            className="min-w-0 flex-1 truncate bg-transparent text-sm font-medium text-foreground outline-none"
            aria-label={t('settingsTab.templateTitleLabel')}
          />
          {/* Status badge — reflects the server-persisted status.
              When isDirty the user has unsaved changes which would become a
              draft on save, so we always show Draft in that case. */}
          {state.isDirty || templateStatus === 'draft' ? (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              {tStatus('draft')}
            </span>
          ) : templateStatus === 'published' ? (
            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              {tStatus('published')}
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {tStatus('archived')}
            </span>
          )}
        </div>

        {/* Centre group — numbered 1·2·3 stepper so the flow is clear. */}
        <nav className="mx-auto flex items-center px-4" aria-label="Editor steps">
          {tabs.map((tab, i) => {
            const active = activeTab === tab.id;
            return (
              <div key={tab.id} className="flex items-center">
                {i > 0 ? (
                  <ChevronRight className="mx-1 h-4 w-4 shrink-0 text-muted-foreground/40" />
                ) : null}
                <button
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={active ? 'step' : undefined}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {i + 1}
                  </span>
                  {tab.label}
                </button>
              </div>
            );
          })}
        </nav>

        {/* Right group — actions */}
        <div className="flex shrink-0 items-center gap-2">
          {publishMode ? (
            <span className="text-xs text-muted-foreground">
              {t('publishWizardStep', {
                step: activeTab === 'settings' ? 2 : activeTab === 'visibility' ? 3 : 1,
              })}
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={saveDraft.isPending || !state.isDirty}
            aria-label={t('saveButton')}
          >
            {t('saveButton')}
          </Button>
          {activeTab === 'visibility' ? (
            // On the Visibility tab the top-bar Publish ALWAYS commits the
            // current audience selection then publishes — regardless of whether
            // the user arrived via the wizard or jumped here via the stepper.
            // This prevents the selection from being silently dropped (bug B1).
            <Button
              size="sm"
              onClick={handlePublishFromVisibility}
              disabled={publish.isPending || saveDraft.isPending}
              aria-label={t('publishButton')}
            >
              {publish.isPending ? t('publishWizardSaving') : t('publishButton')}
            </Button>
          ) : publishMode && activeTab === 'settings' ? (
            <Button
              size="sm"
              onClick={handleSettingsNext}
              disabled={saveDraft.isPending}
              aria-label={t('settingsTab.continueToVisibility')}
            >
              {saveDraft.isPending
                ? t('settingsTab.savingForWizard')
                : t('settingsTab.continueToVisibility')}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handlePublishClick}
              disabled={publish.isPending || saveDraft.isPending}
              aria-label={t('publishButton')}
            >
              {saveDraft.isPending ? t('publishWizardSaving') : t('publishButton')}
            </Button>
          )}
        </div>
      </header>

      {/* ─── Content area ────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {activeTab === 'build' && <ContentTab templateId={templateId} />}
        {activeTab === 'settings' && (
          <SettingsTab
            templateId={templateId}
            {...(publishMode ? { onContinue: handleSettingsNext } : {})}
            isSaving={saveDraft.isPending}
          />
        )}
        {activeTab === 'visibility' && (
          <VisibilityTab
            templateId={templateId}
            onBackToBuild={() => setActiveTab('build')}
            publishMode={publishMode}
            onPublished={handleVisibilityPublish}
            isPublishing={publish.isPending}
            submitRef={visibilitySubmitRef}
          />
        )}
      </div>

      {/* ─── Dialogs ─────────────────────────────────────────────────────── */}
      <Dialog open={showConflict} onOpenChange={setShowConflict}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('conflictTitle')}</DialogTitle>
            <DialogDescription>{t('conflictBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => window.location.reload()} aria-label={t('conflictReload')}>
              {t('conflictReload')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
