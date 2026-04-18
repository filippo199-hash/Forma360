'use client';

import { newId } from '@forma360/shared/id';
import { useTranslations } from 'next-intl';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { useEditor } from './editor-context';

/**
 * Response-sets tab: CRUD the template's snapshotted response sets.
 * Multiple-choice questions reference these by id. Globals live in
 * their own table; this UI covers the snapshots only — the global
 * picker lands alongside a full "attach from globals" flow later.
 */
export function ResponseSetsTab() {
  const t = useTranslations('templates.editor.responseSetsTab');
  const { state, dispatch } = useEditor();

  function handleAdd() {
    const id = newId();
    dispatch({
      type: 'addResponseSet',
      set: {
        id,
        name: 'New response set',
        sourceGlobalId: null,
        multiSelect: false,
        options: [{ id: newId(), label: 'Yes', flagged: false }],
      },
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={handleAdd} aria-label={t('addButton')}>
          {t('addButton')}
        </Button>
      </div>

      {state.content.customResponseSets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        state.content.customResponseSets.map((set) => (
          <Card key={set.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor={`rs-name-${set.id}`}>{t('nameLabel')}</Label>
                  <Input
                    id={`rs-name-${set.id}`}
                    value={set.name}
                    onChange={(e) =>
                      dispatch({
                        type: 'updateResponseSet',
                        setId: set.id,
                        patch: { name: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="flex items-center gap-2 self-end pb-1.5">
                  <Switch
                    id={`rs-ms-${set.id}`}
                    checked={set.multiSelect}
                    onCheckedChange={(v) =>
                      dispatch({
                        type: 'updateResponseSet',
                        setId: set.id,
                        patch: { multiSelect: v },
                      })
                    }
                  />
                  <Label htmlFor={`rs-ms-${set.id}`}>{t('multiSelectLabel')}</Label>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => dispatch({ type: 'deleteResponseSet', setId: set.id })}
                  aria-label={t('removeOption')}
                >
                  ×
                </Button>
              </div>

              <div className="space-y-2">
                <Label>{t('optionsLabel')}</Label>
                {set.options.map((opt) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    <Input
                      value={opt.label}
                      placeholder={t('optionLabel')}
                      aria-label={t('optionLabel')}
                      onChange={(e) =>
                        dispatch({
                          type: 'updateResponseOption',
                          setId: set.id,
                          optionId: opt.id,
                          patch: { label: e.target.value },
                        })
                      }
                    />
                    <div className="flex items-center gap-1 whitespace-nowrap">
                      <Switch
                        id={`flag-${opt.id}`}
                        checked={opt.flagged}
                        onCheckedChange={(v) =>
                          dispatch({
                            type: 'updateResponseOption',
                            setId: set.id,
                            optionId: opt.id,
                            patch: { flagged: v },
                          })
                        }
                      />
                      <Label htmlFor={`flag-${opt.id}`} className="text-xs">
                        {t('flaggedLabel')}
                      </Label>
                    </div>
                    {set.options.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          dispatch({
                            type: 'deleteResponseOption',
                            setId: set.id,
                            optionId: opt.id,
                          })
                        }
                        aria-label={t('removeOption')}
                      >
                        ×
                      </Button>
                    ) : null}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => dispatch({ type: 'addResponseOption', setId: set.id })}
                  aria-label={t('addOption')}
                >
                  {t('addOption')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
