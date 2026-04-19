'use client';

import type { Item, Page } from '@forma360/shared/template-schema';
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
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { useEditor } from './editor-context';
import {
  makeItem,
  TITLE_PAGE_ONLY,
  type StubItemType,
  type SupportedItemType,
} from './editor-state';
import { ItemDetail } from './item-detail';

/**
 * Content tab: three-column layout.
 *
 *   [ Pages rail ]  [ Sections + items for the selected page ]  [ Detail ]
 *
 * The middle column is where the bulk of the authoring happens. Sections
 * and items are drag-sortable within their own parent (via @dnd-kit).
 * Cross-section item moves are supported by moveItemAcrossSections but
 * the in-UI drag right now is scoped to within-section only — a later
 * iteration can extend this to cross-section without reshaping state.
 */
export function ContentTab() {
  const t = useTranslations('templates.editor');
  const { state } = useEditor();

  const selectedPage = useMemo(
    () => state.content.pages.find((p) => p.id === state.selectedPageId) ?? null,
    [state.content.pages, state.selectedPageId],
  );

  return (
    <div className="grid grid-cols-[200px_minmax(0,1fr)_320px] gap-4">
      <PagesRail />
      <div className="min-w-0 space-y-3">
        {selectedPage !== null ? (
          <PageEditor page={selectedPage} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('detail.empty')}</p>
        )}
      </div>
      <aside className="space-y-3">
        <ItemDetail />
      </aside>
    </div>
  );
}

function PagesRail() {
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

  // Title page is fixed — omit from the sortable set so dnd-kit never
  // lets it leave index 0.
  const sortableIds = state.content.pages.filter((p) => p.type !== 'title').map((p) => p.id);

  return (
    <aside className="space-y-2">
      <h3 className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('pages')}
      </h3>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <nav className="space-y-1" aria-label={t('pages')}>
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
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => dispatch({ type: 'addInspectionPage' })}
        aria-label={t('pagesTab.addPageButton')}
      >
        {t('pagesTab.addPageButton')}
      </Button>
    </aside>
  );
}

function TitlePageRow({ page }: { page: Page }) {
  const t = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();
  const isActive = state.selectedPageId === page.id;
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'selectPage', pageId: page.id })}
      className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
        isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
      }`}
    >
      <div className="truncate font-medium">{page.title}</div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{t('titlePageBadge')}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
          {t('pagesTab.titlePageRequiredBadge')}
        </span>
      </div>
    </button>
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors ${
        isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab select-none px-1 text-muted-foreground"
        aria-label={t('pagesTab.dragHandleLabel')}
      >
        ⋮⋮
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: 'selectPage', pageId: page.id })}
        className="flex-1 rounded-md px-1 py-1 text-left text-sm"
      >
        <div className="truncate font-medium">{page.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {t('inspectionPageBadge')}
        </div>
      </button>
    </div>
  );
}

function PageEditor({ page }: { page: Page }) {
  const t = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();

  const inspectionPageCount = state.content.pages.filter((p) => p.type === 'inspection').length;
  const isLastInspection = page.type === 'inspection' && inspectionPageCount <= 1;
  const deleteDisabled = page.type === 'title' || isLastInspection;
  const deleteTooltip = (() => {
    if (page.type === 'title') return t('pagesTab.cannotDeleteTitle');
    if (isLastInspection) return t('pagesTab.cannotDeleteLastInspection');
    return null;
  })();

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-md border bg-card p-3">
        <input
          type="text"
          value={page.title}
          onChange={(e) =>
            dispatch({
              type: 'updatePage',
              pageId: page.id,
              patch: { title: e.target.value },
            })
          }
          className="w-full bg-transparent text-lg font-semibold outline-none"
          aria-label={t('pagesTab.pageTitleLabel')}
        />
        <textarea
          value={page.description ?? ''}
          onChange={(e) =>
            dispatch({
              type: 'updatePage',
              pageId: page.id,
              patch: { description: e.target.value },
            })
          }
          placeholder={t('pagesTab.pageDescriptionLabel')}
          rows={2}
          className="w-full resize-none bg-transparent text-sm text-muted-foreground outline-none"
          aria-label={t('pagesTab.pageDescriptionLabel')}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={deleteDisabled}
          title={deleteTooltip ?? undefined}
          onClick={() => {
            if (deleteDisabled) return;
            if (window.confirm(t('confirmDeletePage'))) {
              dispatch({ type: 'deletePage', pageId: page.id });
            }
          }}
          aria-label={t('deleteSection')}
        >
          {t('deleteSection')}
        </Button>
      </div>

      {page.sections.map((section, idx) => (
        <SectionEditor
          key={section.id}
          pageId={page.id}
          sectionIndex={idx}
          sectionTotal={page.sections.length}
          isTitlePage={page.type === 'title'}
        />
      ))}

      <Button
        variant="outline"
        size="sm"
        onClick={() => dispatch({ type: 'addSection', pageId: page.id })}
        aria-label={t('addSection')}
      >
        {t('addSection')}
      </Button>
    </div>
  );
}

function SectionEditor({
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
    dispatch({
      type: 'reorderItems',
      pageId,
      sectionId: section.id,
      fromIndex: from,
      toIndex: to,
    });
  }

  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
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
          className="flex-1 bg-transparent text-base font-medium outline-none"
          aria-label={t('sectionTitle')}
        />
        {sectionTotal > 1 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (window.confirm(t('confirmDeleteSection'))) {
                dispatch({
                  type: 'deleteSection',
                  pageId,
                  sectionId: section.id,
                });
              }
            }}
            aria-label={t('deleteSection')}
          >
            {t('deleteSection')}
          </Button>
        ) : null}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={section.items.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-1.5">
            {section.items.map((item) => (
              <SortableItem key={item.id} item={item} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <AddItemDropdown
        pageId={pageId}
        sectionId={section.id}
        isTitlePage={isTitlePage}
      />
    </Card>
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
  const type = tType(item.type as Parameters<typeof tType>[0]);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-md border bg-background p-2 transition-colors ${
        isSelected ? 'border-primary' : ''
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab select-none px-1 text-muted-foreground"
        aria-label="drag"
      >
        ⋮⋮
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: 'selectItem', itemId: item.id })}
        className="flex-1 text-left"
      >
        <div className="truncate text-sm">{label}</div>
        <div className="text-xs text-muted-foreground">{type}</div>
      </button>
      <Button
        variant="ghost"
        size="sm"
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

function AddItemDropdown({
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
  const { dispatch } = useEditor();
  const [value, setValue] = useState('');

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
    setValue('');
  }

  return (
    <Select
      value={value}
      onValueChange={(v) => handleAdd(v as SupportedItemType | StubItemType)}
    >
      <SelectTrigger className="h-9 w-48">
        <SelectValue placeholder={t('addItem')} />
      </SelectTrigger>
      <SelectContent>
        <div className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">
          {tCat('common')}
        </div>
        {common.map((type) => (
          <SelectItem key={type} value={type}>
            <QuestionTypeLabel type={type} />
          </SelectItem>
        ))}
        {isTitlePage ? (
          <>
            <div className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">
              {tCat('titlePage')}
            </div>
            {titlePageOnly.map((type) => (
              <SelectItem key={type} value={type}>
                <QuestionTypeLabel type={type} />
              </SelectItem>
            ))}
          </>
        ) : null}
        <div className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">
          {tCat('advanced')}
        </div>
        {advanced.map((type) => (
          <SelectItem key={type} value={type}>
            <QuestionTypeLabel type={type} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function QuestionTypeLabel({ type }: { type: SupportedItemType | StubItemType }) {
  const tType = useTranslations('templates.editor.questionType');
  return <>{tType(type as Parameters<typeof tType>[0])}</>;
}

// arrayMove is imported to keep dnd-kit happy for future cross-section moves;
// silence the unused warning without adding a top-level ignore.
void arrayMove;
