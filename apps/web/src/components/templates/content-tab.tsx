'use client';

import type { Item, Page, Section } from '@forma360/shared/template-schema';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useEditor } from './editor-context';
import {
  makeItem,
  TITLE_PAGE_ONLY,
  type StubItemType,
  type SupportedItemType,
} from './editor-state';
import { ItemDetail } from './item-detail';

/**
 * Build tab: three-panel layout that fills the editor's flex-1 content area.
 *
 *   [ Left sidebar: Pages + section sub-rows ]
 *   [ Centre canvas: PageCanvas with sections + items ]
 *   [ Right panel: ItemDetail ]
 */
export function ContentTab() {
  const { state } = useEditor();

  const selectedPage = useMemo(
    () => state.content.pages.find((p) => p.id === state.selectedPageId) ?? null,
    [state.content.pages, state.selectedPageId],
  );

  return (
    <>
      {/* Left sidebar */}
      <PagesSidebar />

      {/* Centre canvas */}
      <div className="flex-1 overflow-y-auto bg-muted/30 p-6">
        {selectedPage !== null ? (
          <PageCanvas page={selectedPage} />
        ) : null}
      </div>

      {/* Right panel */}
      <div className="w-80 shrink-0 overflow-y-auto border-l bg-background">
        <ItemDetail />
      </div>
    </>
  );
}

// ─── Pages sidebar ────────────────────────────────────────────────────────────

function PagesSidebar() {
  const t = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over === null || active.id === over.id) return;
    const pages = state.content.pages;
    const from = pages.findIndex((p) => p.id === active.id);
    const to = pages.findIndex((p) => p.id === over.id);
    if (from < 0 || to < 0) return;
    dispatch({ type: 'reorderPages', fromIndex: from, toIndex: to });
  }

  const sortableIds = state.content.pages
    .filter((p) => p.type !== 'title')
    .map((p) => p.id);

  return (
    <div className="flex w-60 shrink-0 flex-col overflow-hidden border-r bg-background">
      <p className="px-4 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('pages')}
      </p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <nav className="flex-1 overflow-y-auto px-2 pb-2" aria-label={t('pages')}>
          {state.content.pages.map((p) =>
            p.type === 'title' ? (
              <TitlePageRow key={p.id} page={p} />
            ) : (
              <SortableContext
                key={p.id}
                items={sortableIds}
                strategy={verticalListSortingStrategy}
              >
                <SortablePageRow page={p} />
              </SortableContext>
            ),
          )}
        </nav>
      </DndContext>

      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-primary hover:bg-accent hover:text-primary"
          onClick={() => dispatch({ type: 'addInspectionPage' })}
          aria-label={t('pagesTab.addPageButton')}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t('pagesTab.addPageButton')}
        </Button>
      </div>
    </div>
  );
}

function TitlePageRow({ page }: { page: Page }) {
  const t = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();
  const isActive = state.selectedPageId === page.id;

  return (
    <div>
      <button
        type="button"
        onClick={() => dispatch({ type: 'selectPage', pageId: page.id })}
        className={`flex h-9 w-full items-start rounded-md px-2 py-1 text-left text-sm transition-colors ${
          isActive
            ? 'border-l-2 border-primary bg-accent text-accent-foreground'
            : 'hover:bg-accent/60'
        }`}
      >
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium leading-tight">{page.title}</span>
          <span className="truncate text-[10px] text-muted-foreground">{t('titlePageBadge')}</span>
        </div>
      </button>
      {/* Sub-rows for sections when selected */}
      {isActive &&
        page.sections.map((section) => (
          <SectionSubRow key={section.id} section={section} />
        ))}
    </div>
  );
}

function SortablePageRow({ page }: { page: Page }) {
  const t = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const isActive = state.selectedPageId === page.id;
  const sectionCount = page.sections.length;

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`flex h-9 items-center gap-1 rounded-md transition-colors ${
          isActive
            ? 'border-l-2 border-primary bg-accent text-accent-foreground'
            : 'hover:bg-accent/60'
        }`}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="shrink-0 cursor-grab px-1 text-muted-foreground"
          aria-label={t('pagesTab.dragHandleLabel')}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'selectPage', pageId: page.id })}
          className="flex min-w-0 flex-1 items-center justify-between gap-1 pr-1 text-left"
        >
          <span className="truncate text-sm font-medium leading-tight">{page.title}</span>
          <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
            {sectionCount}
          </span>
        </button>
      </div>
      {/* Sub-rows for sections when selected */}
      {isActive &&
        page.sections.map((section) => (
          <SectionSubRow key={section.id} section={section} />
        ))}
    </div>
  );
}

function SectionSubRow({ section }: { section: Section }) {
  return (
    <button
      type="button"
      onClick={() => {
        const el = document.getElementById(`section-${section.id}`);
        if (el !== null) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }}
      className="flex h-7 w-full items-center truncate pl-6 pr-2 text-left text-xs text-muted-foreground hover:bg-accent/60"
    >
      <span className="truncate">{section.title}</span>
    </button>
  );
}

// ─── Centre canvas ────────────────────────────────────────────────────────────

function PageCanvas({ page }: { page: Page }) {
  const t = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();

  const inspectionPageCount = state.content.pages.filter((p) => p.type === 'inspection').length;
  const isLastInspection = page.type === 'inspection' && inspectionPageCount <= 1;
  const canDelete = page.type !== 'title' && !isLastInspection;

  return (
    <div className="space-y-4">
      {/* Page header card */}
      <div className="rounded-md border bg-card p-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <input
            type="text"
            value={page.title}
            onChange={(e) =>
              dispatch({ type: 'updatePage', pageId: page.id, patch: { title: e.target.value } })
            }
            className="flex-1 bg-transparent text-xl font-semibold text-foreground outline-none"
            aria-label={t('pagesTab.pageTitleLabel')}
          />
          {canDelete ? (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => {
                if (window.confirm(t('confirmDeletePage'))) {
                  dispatch({ type: 'deletePage', pageId: page.id });
                }
              }}
              aria-label={t('deleteSection')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <textarea
          value={page.description ?? ''}
          onChange={(e) =>
            dispatch({ type: 'updatePage', pageId: page.id, patch: { description: e.target.value } })
          }
          placeholder={t('pagesTab.pageDescriptionLabel')}
          rows={2}
          className="mt-1 w-full resize-none bg-transparent text-sm text-muted-foreground outline-none"
          aria-label={t('pagesTab.pageDescriptionLabel')}
        />
      </div>

      {/* Sections */}
      {page.sections.map((section, idx) => (
        <SectionCard
          key={section.id}
          pageId={page.id}
          sectionIndex={idx}
          sectionTotal={page.sections.length}
          isTitlePage={page.type === 'title'}
        />
      ))}

      {/* Add section */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => dispatch({ type: 'addSection', pageId: page.id })}
        aria-label={t('addSection')}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        {t('addSection')}
      </Button>
    </div>
  );
}

function SectionCard({
  pageId,
  sectionIndex,
  sectionTotal,
  isTitlePage,
}: {
  pageId: string;
  sectionIndex: number;
  sectionTotal: number;
  isTitlePage: boolean;
}) {
  const t = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();
  const page = state.content.pages.find((p) => p.id === pageId);
  const section = page?.sections[sectionIndex];
  if (page === undefined || section === undefined) return null;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    if (section === undefined) return;
    const { active, over } = e;
    if (over === null || active.id === over.id) return;
    const from = section.items.findIndex((i) => i.id === active.id);
    const to = section.items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    dispatch({ type: 'reorderItems', pageId, sectionId: section.id, fromIndex: from, toIndex: to });
  }

  return (
    <div
      id={`section-${section.id}`}
      className="rounded-md border bg-card shadow-sm"
    >
      {/* Section header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
        <input
          type="text"
          value={section.title}
          onChange={(e) =>
            dispatch({
              type: 'updateSection',
              pageId,
              sectionId: section.id,
              patch: { title: e.target.value },
            })
          }
          className="flex-1 bg-transparent text-sm font-medium text-foreground outline-none"
          aria-label={t('sectionTitle')}
        />
        {sectionTotal > 1 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => {
              if (window.confirm(t('confirmDeleteSection'))) {
                dispatch({ type: 'deleteSection', pageId, sectionId: section.id });
              }
            }}
            aria-label={t('deleteSection')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>

      {/* Items */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={section.items.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul>
            {section.items.map((item) => (
              <SortableItem key={item.id} item={item} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {/* Add question */}
      <div className="px-3 py-2">
        <AddItemPopover pageId={pageId} sectionId={section.id} isTitlePage={isTitlePage} />
      </div>
    </div>
  );
}

function SortableItem({ item }: { item: Item }) {
  const { state, dispatch } = useEditor();
  const t = useTranslations('templates.editor');
  const tType = useTranslations('templates.editor.questionType');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const isSelected = state.selectedItemId === item.id;
  const label = itemPreview(item);
  const typeLabel = tType(item.type as Parameters<typeof tType>[0]);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`group flex h-12 items-center gap-2 border-b px-3 transition-colors last:border-b-0 ${
        isSelected
          ? 'border-l-2 border-l-primary bg-accent'
          : 'hover:bg-accent/60'
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="drag"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {/* Type badge */}
      <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
        {typeLabel.slice(0, 2)}
      </span>
      <button
        type="button"
        onClick={() => dispatch({ type: 'selectItem', itemId: item.id })}
        className="flex min-w-0 flex-1 items-center text-left"
      >
        <span className="truncate text-sm text-foreground">{label}</span>
      </button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 shrink-0 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        onClick={() => {
          if (window.confirm(t('confirmDeleteItem'))) {
            dispatch({ type: 'deleteItem', itemId: item.id });
          }
        }}
        aria-label={t('deleteItem')}
      >
        ×
      </Button>
    </li>
  );
}

function itemPreview(item: Item): string {
  if (item.type === 'instruction') return item.body.slice(0, 80) || '(instruction)';
  if ('prompt' in item) return item.prompt;
  return '(item)';
}

// ─── Add item popover ─────────────────────────────────────────────────────────

function AddItemPopover({
  pageId,
  sectionId,
  isTitlePage,
}: {
  pageId: string;
  sectionId: string;
  isTitlePage: boolean;
}) {
  const t = useTranslations('templates.editor');
  const tCat = useTranslations('templates.editor.questionCategory');
  const tType = useTranslations('templates.editor.questionType');
  const { dispatch } = useEditor();
  const [open, setOpen] = useState(false);

  const common: SupportedItemType[] = [
    'text',
    'number',
    'date',
    'datetime',
    'multipleChoice',
    'checkbox',
    'signature',
    'media',
    'instruction',
    'slider',
  ];
  const titlePageOnly: SupportedItemType[] = [
    'conductedBy',
    'inspectionDate',
    'documentNumber',
  ];
  const advanced: StubItemType[] = ['site', 'location', 'asset', 'company', 'annotation'];

  function handleAdd(type: SupportedItemType | StubItemType) {
    if (TITLE_PAGE_ONLY.has(type) && !isTitlePage) return;
    const item = makeItem(type);
    dispatch({ type: 'addItem', pageId, sectionId, item });
    dispatch({ type: 'selectItem', itemId: item.id });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-primary hover:bg-accent hover:text-primary"
          aria-label={t('addItem')}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('addItem')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
          {tCat('common')}
        </div>
        {common.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => handleAdd(type)}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent hover:text-primary"
          >
            {tType(type as Parameters<typeof tType>[0])}
          </button>
        ))}
        {isTitlePage ? (
          <>
            <div className="mt-1 px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
              {tCat('titlePage')}
            </div>
            {titlePageOnly.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => handleAdd(type)}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent hover:text-primary"
              >
                {tType(type as Parameters<typeof tType>[0])}
              </button>
            ))}
          </>
        ) : null}
        <div className="mt-1 px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
          {tCat('advanced')}
        </div>
        {advanced.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => handleAdd(type)}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent hover:text-primary"
          >
            {tType(type as Parameters<typeof tType>[0])}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// arrayMove is imported to keep dnd-kit happy for future cross-section moves;
// silence the unused warning without adding a top-level ignore.
void arrayMove;
