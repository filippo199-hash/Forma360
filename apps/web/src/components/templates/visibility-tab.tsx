'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Separator } from '../ui/separator';
import { GroupPicker, SitePicker } from './audience-pickers';

type AccessMode = 'everyone' | 'specific';

/**
 * Visibility tab of the template editor. Users pick the audience that
 * should see and use the template (groups + sites) and persist that
 * choice via `templates.updateAccess` — independent of publishing a new
 * template version.
 *
 * Audience scoping is fronted as "Everyone" vs "Specific groups & sites".
 * Behind the scenes the server creates / updates a single `[auto] …`
 * access_rule keyed to the template. Users never see the rule.
 *
 * In publish wizard mode (`publishMode = true`) the primary action
 * becomes "Publish" instead of "Save changes". After persisting the
 * access settings it calls `onPublished()` — the shell then calls
 * `templates.publish` and redirects to the template list.
 */
export function VisibilityTab({
  templateId,
  onBackToBuild,
  publishMode = false,
  onPublished,
  isPublishing = false,
  submitRef,
}: {
  templateId: string;
  onBackToBuild: () => void;
  /** True when called from the publish wizard (Build → Settings → Visibility). */
  publishMode?: boolean;
  /** Called after access settings are saved so the shell can fire `templates.publish`. */
  onPublished?: () => void;
  /** True while the publish mutation in the shell is in flight. */
  isPublishing?: boolean;
  /**
   * Populated with the save→publish handler so the shell's top-bar "Publish"
   * button can trigger the same flow as the in-tab button.
   */
  submitRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const t = useTranslations('templates.editor.visibilityTab');
  const utils = trpc.useUtils();

  const { data: currentAccess } = trpc.templates.getAccess.useQuery({ templateId });

  const [mode, setMode] = useState<AccessMode>('everyone');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [siteIds, setSiteIds] = useState<string[]>([]);

  // Hydrate local state from server-side access config on first load.
  useEffect(() => {
    if (currentAccess === undefined) return;
    setMode(currentAccess.mode);
    setGroupIds([...currentAccess.groupIds]);
    setSiteIds([...currentAccess.siteIds]);
  }, [currentAccess]);

  // Whether the in-flight save should be followed by publishing. A ref (not
  // state) so the mutation's onSuccess reads the latest intent without a stale
  // closure when the shell's top-bar button triggers a save→publish.
  const publishAfterSaveRef = useRef(false);

  const updateAccess = trpc.templates.updateAccess.useMutation({
    onSuccess: () => {
      void utils.templates.get.invalidate({ templateId });
      void utils.templates.list.invalidate();
      void utils.templates.getAccess.invalidate({ templateId });
      if (publishAfterSaveRef.current) {
        publishAfterSaveRef.current = false;
        // Save→publish flow: the shell fires `templates.publish` and shows the
        // "Template published" toast, so we stay quiet here.
        onPublished?.();
      } else {
        toast.success(t('saveSuccess'));
      }
    },
    onError: () => {
      publishAfterSaveRef.current = false;
      toast.error(t('saveError'));
    },
  });

  function persistAccess() {
    updateAccess.mutate({ templateId, access: { mode, groupIds, siteIds } });
  }

  /** In-tab "Save changes" (non-wizard): persist the audience, no publish. */
  function handleSaveOnly() {
    publishAfterSaveRef.current = false;
    persistAccess();
  }

  /**
   * Persist the audience and then publish. Used by the in-tab "Publish" button
   * (wizard mode) AND by the shell's top-bar Publish button — so a selection
   * made after jumping straight to this tab via the stepper (outside the
   * wizard) is committed rather than silently dropped on publish (bug B1).
   */
  function handleSaveAndPublish() {
    publishAfterSaveRef.current = true;
    persistAccess();
  }

  // The shell's top-bar Publish button always saves the current selection then
  // publishes (captures the current mode/groups/sites via closure).
  if (submitRef !== undefined) submitRef.current = handleSaveAndPublish;

  return (
    <div className="flex-1 overflow-y-auto bg-muted/30">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
        <div>
          <h2 className="text-2xl font-bold">{t('title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('accessTitle')}</CardTitle>
            <CardDescription>{t('accessSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="sr-only">{t('accessTitle')}</legend>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent/30">
                <input
                  type="radio"
                  name="audience-mode"
                  value="everyone"
                  checked={mode === 'everyone'}
                  onChange={() => setMode('everyone')}
                  className="mt-1 h-4 w-4 cursor-pointer accent-primary"
                />
                <div>
                  <div className="font-medium">{t('everyoneLabel')}</div>
                  <div className="text-sm text-muted-foreground">{t('everyoneDescription')}</div>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent/30">
                <input
                  type="radio"
                  name="audience-mode"
                  value="specific"
                  checked={mode === 'specific'}
                  onChange={() => setMode('specific')}
                  className="mt-1 h-4 w-4 cursor-pointer accent-primary"
                />
                <div>
                  <div className="font-medium">{t('specificLabel')}</div>
                  <div className="text-sm text-muted-foreground">{t('specificDescription')}</div>
                </div>
              </label>
            </fieldset>

            {mode === 'specific' && (
              <>
                <Separator />
                <GroupPicker selected={groupIds} onChange={setGroupIds} />
                <SitePicker selected={siteIds} onChange={setSiteIds} />
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onBackToBuild}>
            {t('backToBuild')}
          </Button>
          {publishMode ? (
            <Button
              onClick={handleSaveAndPublish}
              disabled={updateAccess.isPending || isPublishing}
              className="min-w-[140px]"
            >
              {updateAccess.isPending
                ? t('saving')
                : isPublishing
                  ? t('publishing')
                  : t('publishButton')}
            </Button>
          ) : (
            <Button
              onClick={handleSaveOnly}
              disabled={updateAccess.isPending}
              className="min-w-[140px]"
            >
              {updateAccess.isPending ? t('saving') : t('saveButton')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
