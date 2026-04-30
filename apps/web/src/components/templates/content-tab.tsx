'use client';

/**
 * Build tab — single-column canvas UX modelled after SafetyCulture/iAuditor.
 *
 * Layout:
 *   - No sidebar, no right panel.
 *   - Floating toolbar pinned to the left gutter (sticky).
 *   - Canvas: TemplateHeaderCard + one PageBlock per page.
 *   - Each page renders collapsible SectionBlocks.
 *   - Each section renders a 2-column question table with inline expansion.
 *   - TypeOfResponsePicker opens as a popover with two columns.
 */

import type { CustomResponseSet, Item, Page, Section } from '@forma360/shared/template-schema';
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
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GripVertical,
  Hash,
  Image as ImageIcon,
  ImagePlus,
  Info,
  LayoutList,
  MapPin,
  MoreHorizontal,
  Pencil,
  PenLine,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useEditor } from './editor-context';
import { makeItem, type StubItemType, type SupportedItemType } from './editor-state';
import { VisibilityControl } from './visibility-control';

// arrayMove is imported for dnd-kit; silence unused-var lint.
void arrayMove;

// ─── Other response type catalogue ───────────────────────────────────────────

type OtherType = Exclude<SupportedItemType | StubItemType, 'multipleChoice'>;

/** Ordered list of "other responses" shown in the right column of the picker. */
const OTHER_TYPES: ReadonlyArray<{
  type: OtherType;
  icon: React.ReactNode;
}> = [
  { type: 'text', icon: <Type className="h-4 w-4 text-orange-500" /> },
  { type: 'number', icon: <Hash className="h-4 w-4 text-blue-500" /> },
  { type: 'checkbox', icon: <CheckSquare className="h-4 w-4 text-blue-500" /> },
  { type: 'datetime', icon: <Calendar className="h-4 w-4 text-green-500" /> },
  { type: 'media', icon: <ImageIcon className="h-4 w-4 text-teal-500" /> },
  { type: 'slider', icon: <SlidersHorizontal className="h-4 w-4 text-purple-500" /> },
  { type: 'annotation', icon: <Pencil className="h-4 w-4 text-yellow-500" /> },
  { type: 'signature', icon: <PenLine className="h-4 w-4 text-teal-500" /> },
  { type: 'location', icon: <MapPin className="h-4 w-4 text-orange-500" /> },
  { type: 'instruction', icon: <Info className="h-4 w-4 text-blue-400" /> },
] as const;

// ─── Root export ─────────────────────────────────────────────────────────────

/**
 * Single-column canvas — no sidebar, no right panel.
 * Returned as a flex-1 div so it fits into the editor shell's flex container.
 */
export function ContentTab() {
  const { state } = useEditor();

  // Identify the "selected" page for the floating toolbar's quick-add.
  const selectedPageId = state.selectedPageId;

  return (
    <div className="relative flex-1 overflow-y-auto bg-muted/30">
      {/* Floating toolbar — left gutter */}
      <FloatingToolbar selectedPageId={selectedPageId} />

      {/* Canvas */}
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <TemplateHeaderCard />

        {state.content.pages.map((page) => (
          <PageBlock key={page.id} page={page} />
        ))}

        {/* Add page button at bottom of canvas */}
        <AddPageButton />
      </div>
    </div>
  );
}

// ─── Floating toolbar ─────────────────────────────────────────────────────────

function FloatingToolbar({ selectedPageId }: { selectedPageId: string }) {
  const t = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();

  function handleAddQuestion() {
    const page = state.content.pages.find((p) => p.id === selectedPageId);
    if (page === undefined) return;
    const firstSection = page.sections[0];
    if (firstSection === undefined) return;
    const item = makeItem('text');
    dispatch({ type: 'addItem', pageId: selectedPageId, sectionId: firstSection.id, item });
    dispatch({ type: 'selectItem', itemId: item.id });
  }

  function handleAddSection() {
    dispatch({ type: 'addSection', pageId: selectedPageId });
  }

  return (
    <div className="absolute left-4 top-8 z-10">
      <div className="sticky top-8 rounded-xl border bg-background shadow-sm">
        <div className="flex flex-col items-center gap-1 p-1">
          <button
            type="button"
            onClick={handleAddQuestion}
            className="flex w-full flex-col items-center gap-0.5 rounded-lg p-2 text-center hover:bg-accent"
            aria-label={t('addQuestion')}
          >
            <Plus className="h-4 w-4" />
            <span className="text-[10px]">{t('addQuestion')}</span>
          </button>
          <div className="h-px w-6 bg-border" />
          <button
            type="button"
            onClick={handleAddSection}
            className="flex w-full flex-col items-center gap-0.5 rounded-lg p-2 text-center hover:bg-accent"
            aria-label={t('addSection')}
          >
            <LayoutList className="h-4 w-4" />
            <span className="text-[10px]">{t('addSection')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Template header card ─────────────────────────────────────────────────────

function TemplateHeaderCard() {
  const t = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();

  return (
    <div className="flex items-start gap-6 rounded-lg border bg-card p-6">
      {/* Logo placeholder */}
      <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted">
        <ImagePlus className="h-8 w-8 text-muted-foreground/40" />
      </div>

      {/* Title + description */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          type="text"
          value={state.content.title}
          onChange={(e) => dispatch({ type: 'updateContentTitle', title: e.target.value })}
          className="w-full bg-transparent text-2xl font-bold text-foreground outline-none"
          aria-label={t('settingsTab.templateTitleLabel')}
        />
        <input
          type="text"
          value={state.content.description ?? ''}
          onChange={(e) =>
            dispatch({ type: 'updateContentDescription', description: e.target.value })
          }
          placeholder={t('pagesTab.pageDescriptionLabel')}
          className="w-full bg-transparent text-sm text-muted-foreground outline-none"
          aria-label={t('pagesTab.pageDescriptionLabel')}
        />
      </div>
    </div>
  );
}

// ─── Add page button ──────────────────────────────────────────────────────────

function AddPageButton() {
  const t = useTranslations('templates.editor');
  const { dispatch } = useEditor();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => dispatch({ type: 'addInspectionPage' })}
      aria-label={t('pagesTab.addPageButton')}
    >
      <Plus className="mr-1.5 h-3.5 w-3.5" />
      {t('pagesTab.addPageButton')}
    </Button>
  );
}

// ─── Page block ───────────────────────────────────────────────────────────────

function PageBlock({ page }: { page: Page }) {
  const t = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();
  const [collapsed, setCollapsed] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);

  const inspectionPageCount = state.content.pages.filter((p) => p.type === 'inspection').length;
  const canDelete = page.type !== 'title' && inspectionPageCount > 1;

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Page header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="shrink-0 text-muted-foreground"
          aria-label={collapsed ? 'Expand page' : 'Collapse page'}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {editingTitle ? (
          <input
            autoFocus
            type="text"
            value={page.title}
            onChange={(e) =>
              dispatch({ type: 'updatePage', pageId: page.id, patch: { title: e.target.value } })
            }
            onBlur={() => setEditingTitle(false)}
            className="flex-1 bg-transparent text-base font-semibold text-foreground outline-none"
            aria-label={t('pagesTab.pageTitleLabel')}
          />
        ) : (
          <h2 className="flex-1 text-base font-semibold">{page.title}</h2>
        )}

        {/* Edit pencil */}
        <button
          type="button"
          onClick={() => setEditingTitle(true)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={t('pagesTab.pageTitleLabel')}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>

        {/* Delete (inspection pages only, not last) */}
        {canDelete ? (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t('confirmDeletePage'))) {
                dispatch({ type: 'deletePage', pageId: page.id });
              }
            }}
            className="text-muted-foreground hover:text-destructive"
            aria-label={t('confirmDeletePage')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {/* Description */}
      {(page.description ?? '') !== '' ? (
        <p className="px-4 pb-2 text-sm text-muted-foreground">{page.description}</p>
      ) : null}

      {/* Sections */}
      {!collapsed ? (
        <div className="space-y-3 px-4 pb-4">
          {page.sections.map((section, idx) => (
            <SectionBlock
              key={section.id}
              pageId={page.id}
              section={section}
              sectionIndex={idx}
              sectionTotal={page.sections.length}
              isTitlePage={page.type === 'title'}
            />
          ))}

          {/* Add section link (inspection pages only) */}
          {page.type === 'inspection' ? (
            <button
              type="button"
              onClick={() => dispatch({ type: 'addSection', pageId: page.id })}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('addSection')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Section block ────────────────────────────────────────────────────────────

function SectionBlock({
  pageId,
  section,
  sectionIndex,
  sectionTotal,
  isTitlePage,
}: {
  pageId: string;
  section: Section;
  sectionIndex: number;
  sectionTotal: number;
  isTitlePage: boolean;
}) {
  const t = useTranslations('templates.editor');
  const { dispatch } = useEditor();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over === null || active.id === over.id) return;
    const from = section.items.findIndex((i) => i.id === active.id);
    const to = section.items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    dispatch({ type: 'reorderItems', pageId, sectionId: section.id, fromIndex: from, toIndex: to });
  }

  function addQuestion() {
    const item = makeItem('text');
    dispatch({ type: 'addItem', pageId, sectionId: section.id, item });
    dispatch({ type: 'selectItem', itemId: item.id });
  }

  const showSectionHeader = sectionTotal > 1;

  return (
    <div id={`section-${section.id}`} className="space-y-2">
      {/* Section header (only when multiple sections) */}
      {showSectionHeader ? (
        <div className="flex items-center gap-2">
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
          {sectionIndex > 0 ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t('confirmDeleteSection'))) {
                  dispatch({ type: 'deleteSection', pageId, sectionId: section.id });
                }
              }}
              className="text-muted-foreground hover:text-destructive"
              aria-label={t('deleteSection')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Question table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        {/* Table header */}
        <div className="grid grid-cols-[24px_1fr_260px_40px] border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
          <div /> {/* drag handle spacer */}
          <div>{t('questionColumnHeader')}</div>
          <div>{t('typeColumnHeader')}</div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={addQuestion}
              className="flex h-5 w-5 items-center justify-center rounded hover:bg-accent"
              aria-label={t('addItem')}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Question rows */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={section.items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <div>
              {section.items.map((item) => (
                <SortableQuestionRow
                  key={item.id}
                  item={item}
                  pageId={pageId}
                  section={section}
                  isTitlePage={isTitlePage}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {/* Add new footer */}
        <div className="border-t px-3 py-2">
          <button
            type="button"
            onClick={addQuestion}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('addNew')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sortable question row ────────────────────────────────────────────────────

function SortableQuestionRow({
  item,
  pageId,
  section,
  isTitlePage: _isTitlePage,
}: {
  item: Item;
  pageId: string;
  section: Section;
  isTitlePage: boolean;
}) {
  const t = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();
  const [showLogic, setShowLogic] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isSelected = state.selectedItemId === item.id;

  // Compute items that appear before this item across all pages/sections.
  const itemsBefore = useMemo((): ReadonlyArray<Item> => {
    const result: Item[] = [];
    for (const p of state.content.pages) {
      for (const s of p.sections) {
        for (const i of s.items) {
          if (i.id === item.id) return result;
          result.push(i);
        }
      }
    }
    return result;
  }, [state.content.pages, item.id]);

  const prompt = item.type === 'instruction' ? item.body : 'prompt' in item ? item.prompt : '';

  function handlePromptChange(value: string) {
    if (item.type === 'instruction') {
      // instruction has `body`, not `prompt`
      dispatch({ type: 'updateItem', itemId: item.id, patch: { body: value } as Partial<Item> });
    } else if ('prompt' in item) {
      dispatch({ type: 'updateItem', itemId: item.id, patch: { prompt: value } as Partial<Item> });
    }
  }

  function handleRequiredChange(checked: boolean) {
    if ('required' in item) {
      dispatch({
        type: 'updateItem',
        itemId: item.id,
        patch: { required: checked } as Partial<Item>,
      });
    }
  }

  const required = 'required' in item ? item.required : false;

  return (
    <div ref={setNodeRef} style={style} className="group">
      {/* ── Main row ── */}
      <div
        className={`grid grid-cols-[24px_1fr_260px_40px] items-center border-b last:border-b-0 px-3 transition-colors ${
          isSelected ? 'bg-accent/40' : 'hover:bg-muted/20'
        }`}
      >
        {/* Drag handle */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="drag"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        {/* Question text */}
        <div className="flex items-center gap-1 py-3 pr-3">
          {required ? <span className="shrink-0 text-xs text-destructive">*</span> : null}
          <input
            type="text"
            value={prompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            onClick={() => dispatch({ type: 'selectItem', itemId: item.id })}
            placeholder={t('questionPlaceholder')}
            className={`flex-1 bg-transparent text-sm outline-none ${
              isSelected ? 'ring-1 ring-primary rounded px-1' : ''
            }`}
          />
        </div>

        {/* Type picker */}
        <TypeOfResponsePicker item={item} pageId={pageId} sectionId={section.id} />

        {/* Delete */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => dispatch({ type: 'deleteItem', itemId: item.id })}
            className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            aria-label={t('deleteItem')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Inline expansion (selected only) ── */}
      {isSelected ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-accent/20 px-3 py-2 text-sm">
            {/* Add logic toggle */}
            <button
              type="button"
              onClick={() => setShowLogic((v) => !v)}
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <GitBranch className="h-3.5 w-3.5" />
              {showLogic ? t('hideLogic') : t('addLogic')}
            </button>

            {/* Required */}
            {'required' in item ? (
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={required}
                  onChange={(e) => handleRequiredChange(e.target.checked)}
                  className="rounded"
                />
                <span>{t('requiredLabel')}</span>
              </label>
            ) : null}

            {/* Multiple selection (multipleChoice only) */}
            {item.type === 'multipleChoice' ? (
              <MultipleSelectionCheckbox item={item} />
            ) : null}

            {/* More options */}
            <Button variant="ghost" size="sm" className="ml-auto h-7 w-7 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>

          {/* Logic editor */}
          {showLogic ? (
            <div className="border-b bg-muted/10 px-4 py-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">{t('logicLabel')}</p>
              <VisibilityControl item={item} allItemsBefore={itemsBefore} />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ─── Multiple selection checkbox ──────────────────────────────────────────────

function MultipleSelectionCheckbox({
  item,
}: {
  item: Extract<Item, { type: 'multipleChoice' }>;
}) {
  const t = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();

  const responseSet = state.content.customResponseSets.find((rs) => rs.id === item.responseSetId);
  const multiSelect = responseSet?.multiSelect ?? false;

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    dispatch({
      type: 'updateResponseSet',
      setId: item.responseSetId,
      patch: { multiSelect: e.target.checked },
    });
  }

  return (
    <label className="flex cursor-pointer items-center gap-1.5">
      <input type="checkbox" checked={multiSelect} onChange={handleChange} className="rounded" />
      <span>{t('multipleSelectionLabel')}</span>
    </label>
  );
}

// ─── Type of response picker ──────────────────────────────────────────────────

function TypeOfResponsePicker({
  item,
  pageId,
  sectionId,
}: {
  item: Item;
  pageId: string;
  sectionId: string;
}) {
  const t = useTranslations('templates.editor');
  const tType = useTranslations('templates.editor.questionType');
  const { state, dispatch } = useEditor();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const customResponseSets = state.content.customResponseSets;
  const filteredSets = search.trim() === ''
    ? customResponseSets
    : customResponseSets.filter((rs) =>
        rs.name.toLowerCase().includes(search.toLowerCase()),
      );

  /** Replace the item type by deleting + re-adding with copied prompt. */
  function replaceItemType(newType: SupportedItemType | StubItemType, responseSetId?: string) {
    const savedPrompt =
      item.type === 'instruction'
        ? item.body
        : 'prompt' in item
        ? item.prompt
        : 'New question';

    dispatch({ type: 'deleteItem', itemId: item.id });

    const newItem =
      newType === 'multipleChoice' && responseSetId !== undefined
        ? {
            ...makeItem('multipleChoice'),
            prompt: savedPrompt,
            responseSetId,
          }
        : { ...makeItem(newType), ...('prompt' in makeItem(newType) ? { prompt: savedPrompt } : {}) };

    dispatch({ type: 'addItem', pageId, sectionId, item: newItem });
    dispatch({ type: 'selectItem', itemId: newItem.id });
    setOpen(false);
  }

  function selectResponseSet(setId: string) {
    if (item.type === 'multipleChoice') {
      // Already multipleChoice — just swap the set
      dispatch({
        type: 'updateItem',
        itemId: item.id,
        patch: { responseSetId: setId } as Partial<Item>,
      });
      setOpen(false);
    } else {
      replaceItemType('multipleChoice', setId);
    }
  }

  function selectType(type: OtherType) {
    if (item.type === type) {
      setOpen(false);
      return;
    }
    replaceItemType(type as SupportedItemType | StubItemType);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-full w-full items-center gap-2 border-l px-3 py-2 text-sm hover:bg-muted/20"
        >
          <span className="flex flex-1 flex-wrap gap-1 overflow-hidden">
            <ResponseTypeTrigger item={item} customResponseSets={customResponseSets} tType={tType} />
          </span>
          <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="flex w-[520px] p-0"
        align="start"
        side="bottom"
        // Override default popover z-index; it renders inside a fixed overlay so z-50 is fine.
      >
        {/* Left column — response sets */}
        <div className="flex w-[240px] shrink-0 flex-col border-r">
          <div className="px-3 pb-2 pt-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              {t('multipleChoiceResponsesLabel')}
            </p>
            <div className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                placeholder={t('searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent text-xs outline-none"
              />
            </div>
          </div>

          <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
            {filteredSets.map((rs) => {
              const isActive = item.type === 'multipleChoice' && item.responseSetId === rs.id;
              return (
                <button
                  key={rs.id}
                  type="button"
                  onClick={() => selectResponseSet(rs.id)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-accent ${
                    isActive ? 'bg-accent' : ''
                  }`}
                >
                  <div className="flex flex-wrap gap-1">
                    {rs.options.slice(0, 4).map((opt) => (
                      <span
                        key={opt.id}
                        className={`rounded-full px-1.5 py-0.5 text-[11px] ${
                          opt.flagged
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {opt.label}
                      </span>
                    ))}
                    {rs.options.length > 4 ? (
                      <span className="text-[11px] text-muted-foreground">
                        +{rs.options.length - 4}
                      </span>
                    ) : null}
                  </div>
                  <Pencil className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
            {customResponseSets.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">{t('noResponseSets')}</p>
            ) : null}
          </div>

          <div className="border-t px-3 py-2">
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => {
                // Navigating to the response sets tab is handled by the shell —
                // for now, close the picker so the user can switch tabs manually.
                setOpen(false);
              }}
            >
              + {t('addResponseSet')}
            </button>
          </div>
        </div>

        {/* Right column — other types */}
        <div className="flex-1 p-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">
            {t('otherResponsesLabel')}
          </p>
          <div className="space-y-0.5">
            {OTHER_TYPES.map(({ type, icon }) => {
              const isActive = item.type === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => selectType(type)}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent ${
                    isActive ? 'bg-accent font-medium' : ''
                  }`}
                >
                  {icon}
                  {tType(type as Parameters<typeof tType>[0])}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Response type trigger display ────────────────────────────────────────────

function ResponseTypeTrigger({
  item,
  customResponseSets,
  tType,
}: {
  item: Item;
  customResponseSets: ReadonlyArray<CustomResponseSet>;
  tType: (key: string) => string;
}) {
  if (item.type === 'multipleChoice') {
    const rs = customResponseSets.find((s) => s.id === item.responseSetId);
    if (rs === undefined) {
      return <span className="text-xs text-muted-foreground">Pick a set</span>;
    }
    return (
      <>
        {rs.options.slice(0, 3).map((opt) => (
          <span
            key={opt.id}
            className={`rounded-full px-1.5 py-0.5 text-[11px] ${
              opt.flagged ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
            }`}
          >
            {opt.label}
          </span>
        ))}
        {rs.options.length > 3 ? (
          <span className="text-[11px] text-muted-foreground">+{rs.options.length - 3}</span>
        ) : null}
      </>
    );
  }

  const label = tType(item.type as Parameters<typeof tType>[0]);
  return <span className="truncate text-sm">{label}</span>;
}
