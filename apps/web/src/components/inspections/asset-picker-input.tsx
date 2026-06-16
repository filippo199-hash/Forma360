'use client';

import type { Item } from '@forma360/shared/template-schema';
import { ChevronRight, Package } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Checkbox } from '../ui/checkbox';
import { trpc } from '../../lib/trpc/client';
import { useConduct } from './conduct-context';

type AssetWithChildren = {
  id: string;
  name: string;
  parentId: string | null;
  typeId: string | null;
  typeName: string | null;
  children: Array<{
    id: string;
    name: string;
    parentId: string | null;
    typeId: string | null;
    typeName: string | null;
  }>;
};

interface AssetResponse {
  assetIds: string[];
}

function parseResponse(raw: unknown): AssetResponse {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    'assetIds' in raw &&
    Array.isArray((raw as { assetIds: unknown }).assetIds)
  ) {
    const ids = (raw as { assetIds: unknown[] }).assetIds.filter(
      (id) => typeof id === 'string',
    ) as string[];
    return { assetIds: ids };
  }
  return { assetIds: [] };
}

export function AssetPickerInput({
  item,
  readonly,
}: {
  item: Extract<Item, { type: 'asset' }>;
  readonly: boolean;
}) {
  const t = useTranslations('inspections.conduct.response.asset');
  const { state, dispatch } = useConduct();
  const assetsQuery = trpc.assets.listWithChildren.useQuery();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const parents: AssetWithChildren[] = assetsQuery.data ?? [];

  const raw = state.responses[item.id];
  const { assetIds: selected } = parseResponse(raw);
  const selectedSet = new Set(selected);

  function setResponse(next: Set<string>) {
    dispatch({
      type: 'SET_RESPONSE',
      itemId: item.id,
      value: { assetIds: [...next] },
    });
  }

  function toggleExpand(parentId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }

  function toggleParent(parent: AssetWithChildren) {
    if (readonly) return;
    const next = new Set(selectedSet);
    const allChildIds = parent.children.map((c) => c.id);
    const allSelected =
      selectedSet.has(parent.id) && allChildIds.every((cid) => selectedSet.has(cid));

    if (allSelected) {
      next.delete(parent.id);
      for (const cid of allChildIds) next.delete(cid);
    } else {
      next.add(parent.id);
      for (const cid of allChildIds) next.add(cid);
    }
    setResponse(next);
  }

  function toggleChild(childId: string) {
    if (readonly) return;
    const next = new Set(selectedSet);
    if (next.has(childId)) next.delete(childId);
    else next.add(childId);
    setResponse(next);
  }

  function getParentCheckState(parent: AssetWithChildren): boolean | 'indeterminate' {
    const allChildIds = parent.children.map((c) => c.id);
    const parentChecked = selectedSet.has(parent.id);
    if (allChildIds.length === 0) return parentChecked;
    const checkedChildren = allChildIds.filter((cid) => selectedSet.has(cid));
    if (!parentChecked && checkedChildren.length === 0) return false;
    if (parentChecked && checkedChildren.length === allChildIds.length) return true;
    return 'indeterminate';
  }

  if (assetsQuery.isPending) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }

  if (assetsQuery.isError) {
    return <p className="text-sm text-destructive">{t('error')}</p>;
  }

  if (parents.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <div className="space-y-1 rounded-md border bg-background p-2">
      {parents.map((parent) => {
        const isExpanded = expanded.has(parent.id);
        const checkState = getParentCheckState(parent);

        return (
          <div key={parent.id}>
            <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50">
              <Checkbox
                checked={checkState === true}
                data-state={checkState === 'indeterminate' ? 'indeterminate' : undefined}
                onCheckedChange={() => toggleParent(parent)}
                disabled={readonly}
                aria-label={parent.name}
              />
              <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm font-medium">{parent.name}</span>
              {parent.children.length > 0 && (
                <button
                  type="button"
                  onClick={() => toggleExpand(parent.id)}
                  className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  aria-label={isExpanded ? t('collapse') : t('expand')}
                >
                  <ChevronRight
                    className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  />
                  <span>{parent.children.length}</span>
                </button>
              )}
            </div>

            {isExpanded && parent.children.length > 0 && (
              <div className="ml-6 space-y-0.5 border-l pl-3 pt-0.5">
                {parent.children.map((child) => (
                  <div
                    key={child.id}
                    className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedSet.has(child.id)}
                      onCheckedChange={() => toggleChild(child.id)}
                      disabled={readonly}
                      aria-label={child.name}
                    />
                    <span className="text-sm">{child.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
