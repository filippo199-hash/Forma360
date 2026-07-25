'use client';

import { ChevronRight, FolderOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  visibleToGroupIds: unknown;
  visibleToSiteIds: unknown;
}

export interface FolderCrumb {
  id: string;
  name: string;
  visibleToGroupIds?: string[];
  visibleToSiteIds?: string[];
}

function toCrumb(f: FolderNode): FolderCrumb {
  return {
    id: f.id,
    name: f.name,
    visibleToGroupIds: Array.isArray(f.visibleToGroupIds) ? (f.visibleToGroupIds as string[]) : [],
    visibleToSiteIds: Array.isArray(f.visibleToSiteIds) ? (f.visibleToSiteIds as string[]) : [],
  };
}

/**
 * Explorer-style folder tree for the documents sidebar. Renders every folder
 * nested under its parent with expand/collapse chevrons, so it's obvious where
 * a subfolder lives. Selecting a folder navigates the page (the full breadcrumb
 * path is computed by walking parentId to the root).
 */
export function FolderTree({
  folders,
  currentFolderId,
  allDocumentsLabel,
  onNavigate,
}: {
  folders: FolderNode[];
  currentFolderId: string | null;
  allDocumentsLabel: string;
  onNavigate: (crumbs: FolderCrumb[]) => void;
}) {
  const t = useTranslations('documents.folder');
  const byId = new Map(folders.map((f) => [f.id, f]));
  const children = new Map<string | null, FolderNode[]>();
  for (const f of folders) {
    const arr = children.get(f.parentId) ?? [];
    arr.push(f);
    children.set(f.parentId, arr);
  }
  for (const arr of children.values()) arr.sort((a, b) => a.name.localeCompare(b.name));

  function pathTo(id: string): FolderCrumb[] {
    const crumbs: FolderCrumb[] = [];
    let cur: FolderNode | undefined = byId.get(id);
    let guard = 0;
    while (cur !== undefined && guard < 64) {
      crumbs.unshift(toCrumb(cur));
      cur = cur.parentId !== null ? byId.get(cur.parentId) : undefined;
      guard += 1;
    }
    return crumbs;
  }

  // Ancestors of the current folder are always shown expanded so the active
  // row stays visible even after navigating via the main-area cards.
  const ancestorsOfCurrent = new Set<string>();
  {
    let cur = currentFolderId !== null ? byId.get(currentFolderId) : undefined;
    let guard = 0;
    while (cur?.parentId != null && guard < 64) {
      ancestorsOfCurrent.add(cur.parentId);
      cur = byId.get(cur.parentId);
      guard += 1;
    }
  }

  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setManualExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderLevel(parentId: string | null, depth: number): ReactNode {
    const kids = children.get(parentId) ?? [];
    return kids.map((f) => {
      const hasKids = (children.get(f.id) ?? []).length > 0;
      const open = manualExpanded.has(f.id) || ancestorsOfCurrent.has(f.id);
      const active = currentFolderId === f.id;
      return (
        <div key={f.id}>
          <div
            className={cn(
              'flex items-center rounded-md transition-colors',
              active
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
            style={{ paddingLeft: `${depth * 14 + 2}px` }}
          >
            <button
              type="button"
              onClick={() => hasKids && toggle(f.id)}
              className={cn(
                'flex h-7 w-5 shrink-0 items-center justify-center',
                hasKids ? 'hover:text-foreground' : 'invisible',
              )}
              aria-label={open ? t('collapse') : t('expand')}
              aria-expanded={hasKids ? open : undefined}
            >
              <ChevronRight
                className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')}
              />
            </button>
            <button
              type="button"
              onClick={() => onNavigate(pathTo(f.id))}
              className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-sm"
            >
              <FolderOpen className="h-4 w-4 shrink-0" />
              <span className="truncate" title={f.name}>
                {f.name}
              </span>
            </button>
          </div>
          {hasKids && open ? renderLevel(f.id, depth + 1) : null}
        </div>
      );
    });
  }

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => onNavigate([])}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
          currentFolderId === null
            ? 'bg-primary/10 font-medium text-primary'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        )}
      >
        <FolderOpen className="h-4 w-4 shrink-0" />
        {allDocumentsLabel}
      </button>
      {renderLevel(null, 0)}
    </div>
  );
}
