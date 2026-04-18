'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { useEditor } from './editor-context';

/**
 * Template-level settings: title, description, inspection-title format,
 * document-number format + counter start. Access rule picker lands in a
 * later PR.
 */
export function SettingsTab() {
  const t = useTranslations('templates.editor.settingsTab');
  const { state, dispatch } = useEditor();

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t('templateTitleLabel')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">{t('templateTitleLabel')}</Label>
            <Input
              id="tpl-name"
              value={state.content.title}
              onChange={(e) => dispatch({ type: 'updateContentTitle', title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-desc">{t('templateDescriptionLabel')}</Label>
            <Textarea
              id="tpl-desc"
              value={state.content.description ?? ''}
              onChange={(e) =>
                dispatch({ type: 'updateContentDescription', description: e.target.value })
              }
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('titleFormatLabel')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="title-fmt">{t('titleFormatLabel')}</Label>
            <Input
              id="title-fmt"
              value={state.content.settings.titleFormat}
              onChange={(e) =>
                dispatch({ type: 'updateSettings', patch: { titleFormat: e.target.value } })
              }
            />
            <p className="text-xs text-muted-foreground">{t('titleFormatHelp')}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-fmt">{t('documentNumberFormatLabel')}</Label>
            <Input
              id="doc-fmt"
              value={state.content.settings.documentNumberFormat}
              onChange={(e) =>
                dispatch({
                  type: 'updateSettings',
                  patch: { documentNumberFormat: e.target.value },
                })
              }
            />
            <p className="text-xs text-muted-foreground">{t('documentNumberFormatHelp')}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-start">{t('documentNumberStartLabel')}</Label>
            <Input
              id="doc-start"
              type="number"
              min={1}
              value={state.content.settings.documentNumberStart}
              onChange={(e) =>
                dispatch({
                  type: 'updateSettings',
                  patch: { documentNumberStart: Math.max(1, Number(e.target.value) || 1) },
                })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('accessRuleLabel')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">{t('accessRuleHelp')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
