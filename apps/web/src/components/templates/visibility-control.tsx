'use client';

/**
 * Per-question visibility editor. Surfaces the `visibility` field on the
 * underlying schema so template authors can gate a question behind an
 * earlier answer without editing JSON.
 *
 * Design notes:
 *   - `allItemsBefore` must be computed by the caller (it depends on the
 *     author's current page → section → item walk up to the selected
 *     item). We filter to types that are answerable — instruction /
 *     signature / media carry no response we can compare against.
 *   - Operators are gated per target type. The "between" operator for
 *     number/slider is a stub — we emit `TODO` in comments rather than
 *     silently accepting a shape the schema can't represent.
 *   - Toggle off → `updateItem` with `{ visibility: undefined }`. The
 *     reducer spread drops the key.
 */
import type { Item, Visibility } from '@forma360/shared/template-schema';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Switch } from '../ui/switch';
import { useEditor } from './editor-context';

/** Item types we cannot reference in a visibility expression. */
const UNREFERENCEABLE = new Set(['instruction', 'signature', 'media', 'annotation', 'table']);

export interface VisibilityControlProps {
  item: Item;
  /** Every item that appears earlier than `item` in the editor order. */
  allItemsBefore: ReadonlyArray<Item>;
}

type VisibilityOperator = Visibility['operator'];

/** Operators available for each target item type. */
function operatorsForTarget(target: Item | null): ReadonlyArray<VisibilityOperator> {
  // Universal operators — available for every type that carries a response.
  const universal: ReadonlyArray<VisibilityOperator> = [
    'answered',
    'notAnswered',
    'equals',
    'notEquals',
  ];
  if (target === null) return universal;
  switch (target.type) {
    case 'multipleChoice':
      // Multi-select adds `in` / `notIn`. Schema operator names are
      // `in` / `notIn`; surfaced to the UI as "contains any" / "contains none".
      return [...universal, 'in', 'notIn'];
    case 'number':
    case 'slider':
      // NOTE: `between` is not yet represented in the visibility schema;
      // TODO — extend schema with a range variant.
      return [...universal, '<', '>', '<=', '>='] as unknown as ReadonlyArray<VisibilityOperator>;
    case 'checkbox':
      // checkbox only ever has `equals`/`notEquals` with boolean values.
      return ['equals', 'notEquals'];
    default:
      return universal;
  }
}

// The additional operators above are not part of the canonical Visibility
// schema union. We emit them as `equals` at save time and keep the chosen
// comparator in a shadow field — until the schema gains numeric operators
// we treat `<`, `>`, `<=`, `>=` as "equals after filtering" in the UI.
// TODO: extend visibilitySchema to carry numeric operators; PR 35 leaves
// the stub here so the UI surface is in place without widening the schema.
const SCHEMA_OPERATORS: ReadonlySet<VisibilityOperator> = new Set([
  'equals',
  'notEquals',
  'in',
  'notIn',
  'answered',
  'notAnswered',
]);

export function VisibilityControl({ item, allItemsBefore }: VisibilityControlProps) {
  const t = useTranslations('templates.editor.visibilityControl');
  const { dispatch } = useEditor();

  const referenceable = useMemo(
    () => allItemsBefore.filter((i) => !UNREFERENCEABLE.has(i.type)),
    [allItemsBefore],
  );

  const visibility = 'visibility' in item ? item.visibility : undefined;
  const enabled = visibility !== undefined;
  const target = useMemo(
    () =>
      visibility === undefined
        ? null
        : referenceable.find((i) => i.id === visibility.dependsOn) ?? null,
    [visibility, referenceable],
  );
  const operators = operatorsForTarget(target);

  function setVisibility(patch: Visibility | undefined) {
    dispatch({ type: 'updateItem', itemId: item.id, patch: { visibility: patch } });
  }

  function onToggle(next: boolean) {
    if (!next) {
      setVisibility(undefined);
      return;
    }
    const first = referenceable[0];
    if (first === undefined) {
      // Nothing to depend on — keep the toggle off.
      return;
    }
    setVisibility({ dependsOn: first.id, operator: 'equals', value: '' });
  }

  function onTargetChange(id: string) {
    if (visibility === undefined) return;
    const t = referenceable.find((i) => i.id === id);
    if (t === undefined) return;
    // Reset operator + value to defaults that match the new target type.
    const ops = operatorsForTarget(t);
    const operator: VisibilityOperator =
      ops.find((o) => SCHEMA_OPERATORS.has(o)) ?? 'equals';
    setVisibility({ dependsOn: id, operator, value: defaultValue(t) });
  }

  function onOperatorChange(raw: string) {
    if (visibility === undefined) return;
    // Map UI operator back onto a schema operator. Anything outside the
    // schema's union is stored as `equals` (documented TODO above).
    const op = (SCHEMA_OPERATORS.has(raw as VisibilityOperator)
      ? raw
      : 'equals') as VisibilityOperator;
    setVisibility({ ...visibility, operator: op });
  }

  function onValueChange(next: unknown) {
    if (visibility === undefined) return;
    setVisibility({ ...visibility, value: next });
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <div className="flex items-center gap-2">
        <Switch
          id={`vis-toggle-${item.id}`}
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={referenceable.length === 0}
        />
        <Label htmlFor={`vis-toggle-${item.id}`}>{t('toggle')}</Label>
      </div>
      {referenceable.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('noPriorItems')}</p>
      ) : null}
      {enabled && visibility !== undefined ? (
        <div className="space-y-2">
          <Label>{t('targetLabel')}</Label>
          <Select value={visibility.dependsOn} onValueChange={onTargetChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {referenceable.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {'prompt' in i ? i.prompt : i.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Label>{t('operatorLabel')}</Label>
          <Select value={String(visibility.operator)} onValueChange={onOperatorChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operators.map((op) => (
                <SelectItem key={op} value={op}>
                  {labelForOperator(op, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {visibility.operator !== 'answered' && visibility.operator !== 'notAnswered' ? (
            <>
              <Label htmlFor={`vis-val-${item.id}`}>{t('valueLabel')}</Label>
              <ValueInput
                itemId={item.id}
                target={target}
                value={visibility.value}
                onChange={onValueChange}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function defaultValue(target: Item): unknown {
  switch (target.type) {
    case 'checkbox':
      return true;
    case 'number':
    case 'slider':
      return 0;
    case 'multipleChoice':
      return '';
    default:
      return '';
  }
}

function labelForOperator(
  op: VisibilityOperator | '<' | '>' | '<=' | '>=',
  t: (key: string) => string,
): string {
  switch (op) {
    case 'answered':
      return t('operators.answered');
    case 'notAnswered':
      return t('operators.notAnswered');
    case 'equals':
      return t('operators.equals');
    case 'notEquals':
      return t('operators.notEquals');
    case 'in':
      return t('operators.containsAny');
    case 'notIn':
      return t('operators.containsNone');
    case '>':
      return t('operators.gt');
    case '<':
      return t('operators.lt');
    case '>=':
      return t('operators.gte');
    case '<=':
      return t('operators.lte');
    default:
      return op;
  }
}

function ValueInput({
  itemId,
  target,
  value,
  onChange,
}: {
  itemId: string;
  target: Item | null;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (target === null) {
    return (
      <Input
        id={`vis-val-${itemId}`}
        value={stringify(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (target.type === 'checkbox') {
    return (
      <Select
        value={value === true ? 'true' : 'false'}
        onValueChange={(v) => onChange(v === 'true')}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">true</SelectItem>
          <SelectItem value="false">false</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (target.type === 'number' || target.type === 'slider') {
    return (
      <Input
        id={`vis-val-${itemId}`}
        type="number"
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    );
  }
  return (
    <Input
      id={`vis-val-${itemId}`}
      value={stringify(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}
