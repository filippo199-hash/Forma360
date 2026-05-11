'use client';

/**
 * Build tab — single-column canvas UX modelled after SafetyCulture/iAuditor.
 *
 * Layout:
 *   - No sidebar, no right panel.
 *   - Floating toolbar pinned to the left gutter (sticky).
 *   - Canvas: TemplateHeaderCard + one PageBlock per page.
 *   - Each page renders collapsible SectionBlocks.
 *   - Each section renders a question table with inline expansion.
 *   - SortableQuestionRow shows a colored type chip + question + type picker.
 *   - Inline expansion: chip-style toggles row + action row (Logic / Note /
 *     ⋮ More) + collapsible Logic editor (option-trigger editor for MC,
 *     visibility-control for everything else) + collapsible Note textarea.
 *   - TypeOfResponsePicker has inline "Create response set" + per-row pencil
 *     opens a `Sheet` that lets you rename / toggle multi-select / edit
 *     options / delete the set — without leaving the picker.
 *   - Inspection pages are drag-reorderable; title page is pinned.
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
import { newId } from '@forma360/shared/id';
import {
  Box,
  Building2,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  GitBranch,
  GripVertical,
  Hash,
  HelpCircle,
  Image as ImageIcon,
  ImagePlus,
  Info,
  ListChecks,
  MapPin,
  MoreHorizontal,
  MoveDown,
  MoveUp,
  Pencil,
  PenLine,
  Plus,
  Search,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  Type,
  User,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';
import { useEditor } from './editor-context';
import { makeItem, type StubItemType, type SupportedItemType } from './editor-state';
import { OptionTriggerEditor } from './option-trigger-editor';
import { SignatureWorkflowCard } from './signature-workflow-card';
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

// ─── Type-chip catalogue (colored squares on each question row) ──────────────

interface TypeChipStyle {
  bg: string;
  icon: React.ReactNode;
}

/** Returns the chip styling for a given item type. */
function typeChip(type: string): TypeChipStyle {
  switch (type) {
    case 'text':
      return { bg: 'bg-orange-100 text-orange-600', icon: <Type className="h-4 w-4" /> };
    case 'number':
      return { bg: 'bg-blue-100 text-blue-600', icon: <Hash className="h-4 w-4" /> };
    case 'date':
    case 'datetime':
    case 'time':
      return {
        bg: 'bg-emerald-100 text-emerald-600',
        icon: <Calendar className="h-4 w-4" />,
      };
    case 'multipleChoice':
      return {
        bg: 'bg-purple-100 text-purple-600',
        icon: <ListChecks className="h-4 w-4" />,
      };
    case 'checkbox':
      return {
        bg: 'bg-sky-100 text-sky-600',
        icon: <CheckSquare className="h-4 w-4" />,
      };
    case 'signature':
      return { bg: 'bg-teal-100 text-teal-600', icon: <PenLine className="h-4 w-4" /> };
    case 'media':
      return {
        bg: 'bg-pink-100 text-pink-600',
        icon: <ImageIcon className="h-4 w-4" />,
      };
    case 'slider':
      return {
        bg: 'bg-indigo-100 text-indigo-600',
        icon: <SlidersHorizontal className="h-4 w-4" />,
      };
    case 'instruction':
      return { bg: 'bg-amber-100 text-amber-600', icon: <Info className="h-4 w-4" /> };
    case 'conductedBy':
      return { bg: 'bg-violet-100 text-violet-600', icon: <User className="h-4 w-4" /> };
    case 'inspectionDate':
      return {
        bg: 'bg-emerald-100 text-emerald-600',
        icon: <Calendar className="h-4 w-4" />,
      };
    case 'documentNumber':
      return { bg: 'bg-slate-100 text-slate-600', icon: <Hash className="h-4 w-4" /> };
    case 'site':
    case 'location':
      return { bg: 'bg-rose-100 text-rose-600', icon: <MapPin className="h-4 w-4" /> };
    case 'asset':
      return { bg: 'bg-yellow-100 text-yellow-700', icon: <Box className="h-4 w-4" /> };
    case 'company':
      return {
        bg: 'bg-cyan-100 text-cyan-600',
        icon: <Building2 className="h-4 w-4" />,
      };
    case 'annotation':
      return { bg: 'bg-lime-100 text-lime-700', icon: <Pencil className="h-4 w-4" /> };
    default:
      return {
        bg: 'bg-muted text-muted-foreground',
        icon: <HelpCircle className="h-4 w-4" />,
      };
  }
}

// ─── Root export ─────────────────────────────────────────────────────────────

/**
 * Single-column canvas — no sidebar, no right panel.
 * Returned as a flex-1 div so it fits into the editor shell's flex container.
 */
export function ContentTab({ templateId }: { templateId: string }) {
  const { state, dispatch } = useEditor();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sortablePageIds = state.content.pages.filter((p) => p.type !== 'title').map((p) => p.id);

  function onPageDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over === null || active.id === over.id) return;
    const pages = state.content.pages;
    const from = pages.findIndex((p) => p.id === active.id);
    const to = pages.findIndex((p) => p.id === over.id);
    if (from < 0 || to < 0) return;
    dispatch({ type: 'reorderPages', fromIndex: from, toIndex: to });
  }

  return (
    <div className="relative flex-1 overflow-y-auto bg-muted/30">
      {/* Sticky section navigator — left gutter */}
      <SectionNavigator />

      {/* Canvas */}
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
        <TemplateHeaderCard templateId={templateId} />

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onPageDragEnd}>
          {state.content.pages.map((page, idx) =>
            page.type === 'title' ? (
              <PageBlock key={page.id} page={page} pageIndex={idx} templateId={templateId} />
            ) : (
              <SortableContext
                key={page.id}
                items={sortablePageIds}
                strategy={verticalListSortingStrategy}
              >
                <SortablePageBlock page={page} pageIndex={idx} templateId={templateId} />
              </SortableContext>
            ),
          )}
        </DndContext>

        {/* Add page button at bottom of canvas */}
        <div className="mt-4">
          <AddPageButton />
        </div>

        {/* Signature workflow — pinned at the bottom of the template */}
        <div className="mt-6">
          <SignatureWorkflowCard />
        </div>
      </div>
    </div>
  );
}

// ─── Sortable page block wrapper ──────────────────────────────────────────────

function SortablePageBlock({
  page,
  pageIndex,
  templateId,
}: {
  page: Page;
  pageIndex: number;
  templateId: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <PageBlock
        page={page}
        pageIndex={pageIndex}
        templateId={templateId}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

// ─── Page navigator ──────────────────────────────────────────────────────────

/**
 * Sticky list of page titles anchored to the left gutter. No card, no
 * header, no subsections — just plain clickable labels that scroll their
 * page card into view. Easy way to jump around long templates.
 */
function SectionNavigator() {
  const { state } = useEditor();

  function scrollTo(pageId: string) {
    const el = document.getElementById(`page-${pageId}`);
    if (el !== null) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (state.content.pages.length === 0) return null;

  return (
    <div className="absolute left-4 top-10 z-10">
      <ul className="sticky top-10 w-48 space-y-1">
        {state.content.pages.map((page) => (
          <li key={page.id}>
            <button
              type="button"
              onClick={() => scrollTo(page.id)}
              className="block w-full truncate rounded px-2 py-1 text-left text-sm text-muted-foreground hover:text-foreground"
              title={page.title}
            >
              {page.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Template header card ─────────────────────────────────────────────────────

function TemplateHeaderCard({ templateId }: { templateId: string }) {
  const t = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const logoStorageKey = state.content.settings.branding?.logoStorageKey;

  useEffect(() => {
    if (logoStorageKey === undefined || logoStorageKey === '') {
      setPreviewUrl(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(
          `/api/upload/template-logo/signed-url?key=${encodeURIComponent(logoStorageKey)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { url: string };
        if (!cancelled) {
          setPreviewUrl(data.url);
        }
      } catch {
        // silently ignore — preview simply stays null
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [logoStorageKey]);

  async function onFileSelected(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('templateId', templateId);
      form.append('file', file);

      const res = await fetch('/api/upload/template-logo', {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = (await res.json()) as { key: string };

      dispatch({
        type: 'updateSettings',
        patch: {
          branding: {
            ...(state.content.settings.branding ?? {}),
            logoStorageKey: data.key,
          },
        },
      });
    } catch {
      // Error is surfaced via toast in a future iteration; for now we just stop uploading.
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-start gap-6 rounded-lg border border-border/60 bg-card p-6 shadow-sm">
      {/* Logo upload button */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted"
        aria-label={t('clickToUploadLogo')}
      >
        {previewUrl !== null ? (
          <img src={previewUrl} alt="logo" className="h-full w-full rounded-lg object-contain" />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <ImagePlus className="h-8 w-8 text-muted-foreground/40" />
          </span>
        )}
        {uploading ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30 text-xs text-white">
            {t('uploadingLogo')}
          </div>
        ) : null}
      </button>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f !== undefined) void onFileSelected(f);
        }}
      />

      {/* Title + description */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          type="text"
          value={state.content.title}
          onChange={(e) => dispatch({ type: 'updateContentTitle', title: e.target.value })}
          className="mb-2 w-full bg-transparent text-3xl font-bold tracking-tight text-foreground outline-none"
          aria-label={t('settingsTab.templateTitleLabel')}
        />
        <input
          type="text"
          value={state.content.description ?? ''}
          onChange={(e) =>
            dispatch({ type: 'updateContentDescription', description: e.target.value })
          }
          placeholder="Add a description…"
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

function PageBlock({
  page,
  pageIndex,
  templateId: _templateId,
  dragHandleProps,
}: {
  page: Page;
  pageIndex: number;
  templateId: string;
  dragHandleProps?: React.HTMLAttributes<HTMLElement>;
}) {
  const t = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();
  const [collapsed, setCollapsed] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);

  const inspectionPageCount = state.content.pages.filter((p) => p.type === 'inspection').length;
  const canDelete = page.type !== 'title' && inspectionPageCount > 1;

  return (
    <div
      id={`page-${page.id}`}
      className="scroll-mt-8 rounded-lg border border-border/60 bg-card shadow-sm"
    >
      {/* Page header */}
      <div className="flex items-center gap-2 px-5 py-4">
        {/* Drag handle — inspection pages only */}
        {dragHandleProps !== undefined ? (
          <button
            type="button"
            {...dragHandleProps}
            className="shrink-0 cursor-grab text-muted-foreground/50 hover:text-muted-foreground"
            aria-label="Reorder page"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="shrink-0 text-muted-foreground"
          aria-label={collapsed ? 'Expand page' : 'Collapse page'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        <div className="flex min-w-0 flex-1 flex-col">
          {page.type !== 'title' ? (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {`${t('inspectionPageBadge')} ${pageIndex}`}
            </span>
          ) : null}
          {editingTitle ? (
            <input
              autoFocus
              type="text"
              value={page.title}
              onChange={(e) =>
                dispatch({ type: 'updatePage', pageId: page.id, patch: { title: e.target.value } })
              }
              onBlur={() => setEditingTitle(false)}
              className="bg-transparent text-lg font-semibold tracking-tight text-foreground outline-none"
              aria-label={t('pagesTab.pageTitleLabel')}
            />
          ) : (
            <h2 className="text-lg font-semibold tracking-tight text-foreground">{page.title}</h2>
          )}
        </div>

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

      {/* Divider between header and body */}
      <div className="h-px bg-border" />

      {/* Description */}
      {(page.description ?? '') !== '' ? (
        <p className="px-5 pb-2 pt-3 text-sm text-muted-foreground">{page.description}</p>
      ) : null}

      {/* Sections */}
      {!collapsed ? (
        <div className="space-y-4 px-5 pb-5 pt-4">
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
  const itemCount = section.items.length;

  return (
    <div id={`section-${section.id}`} className="space-y-2">
      {/* Section header — slim horizontal bar (only when multiple sections) */}
      {showSectionHeader ? (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
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
          <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {`${String(itemCount)} ${itemCount === 1 ? t('questionColumnHeader').toLowerCase() : t('questionColumnHeader').toLowerCase() + 's'}`}
          </span>
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
        <div className="grid grid-cols-[24px_36px_1fr_260px_40px] border-b bg-muted/20 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <div /> {/* drag handle spacer */}
          <div /> {/* type chip spacer */}
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
        <div className="border-t px-4 py-3">
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
  const tInline = useTranslations('templates.editor.inlineActions');
  const tLogic = useTranslations('templates.editor.logicTab');
  const { state, dispatch } = useEditor();
  const [showLogic, setShowLogic] = useState(false);
  const [showNote, setShowNote] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isSelected = state.selectedItemId === item.id;
  const chip = typeChip(item.type);

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
  const note = 'note' in item ? (item.note ?? '') : '';

  function handlePromptChange(value: string) {
    if (item.type === 'instruction') {
      // instruction has `body`, not `prompt`
      dispatch({ type: 'updateItem', itemId: item.id, patch: { body: value } as Partial<Item> });
    } else if ('prompt' in item) {
      dispatch({ type: 'updateItem', itemId: item.id, patch: { prompt: value } as Partial<Item> });
    }
  }

  function handleNoteChange(value: string) {
    dispatch({ type: 'updateItem', itemId: item.id, patch: { note: value } as Partial<Item> });
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

  function handleDuplicate() {
    // Clone the current item with a fresh id and "(copy)" suffix on the prompt.
    // The cast funnels through `Item` because TS can't reason about generic
    // spreads across a discriminated union — the runtime shape is identical
    // to `item`, only `id` and `prompt`/`body` change.
    const cloned: Item =
      item.type === 'instruction'
        ? { ...item, id: newId(), body: `${item.body} (copy)` }
        : ({ ...item, id: newId(), prompt: `${item.prompt} (copy)` } as Item);
    dispatch({ type: 'addItem', pageId, sectionId: section.id, item: cloned });
    // Re-order so the clone lives right after the source item.
    const newIndex = section.items.length; // before dispatch we know it was appended
    const sourceIdx = section.items.findIndex((i) => i.id === item.id);
    if (sourceIdx >= 0) {
      dispatch({
        type: 'reorderItems',
        pageId,
        sectionId: section.id,
        fromIndex: newIndex,
        toIndex: sourceIdx + 1,
      });
    }
    dispatch({ type: 'selectItem', itemId: cloned.id });
  }

  function handleMoveUp() {
    const idx = section.items.findIndex((i) => i.id === item.id);
    if (idx <= 0) return;
    dispatch({
      type: 'reorderItems',
      pageId,
      sectionId: section.id,
      fromIndex: idx,
      toIndex: idx - 1,
    });
  }

  function handleMoveDown() {
    const idx = section.items.findIndex((i) => i.id === item.id);
    if (idx < 0 || idx >= section.items.length - 1) return;
    dispatch({
      type: 'reorderItems',
      pageId,
      sectionId: section.id,
      fromIndex: idx,
      toIndex: idx + 1,
    });
  }

  function handleDelete() {
    dispatch({ type: 'deleteItem', itemId: item.id });
  }

  const required = 'required' in item ? item.required : false;
  const supportsLogic = 'visibility' in item || item.type === 'multipleChoice';

  // Compute flagged-option count for multipleChoice items (used in chip-row).
  const flaggedCount = useMemo(() => {
    if (item.type !== 'multipleChoice') return 0;
    const rs = state.content.customResponseSets.find((s) => s.id === item.responseSetId);
    return rs?.options.filter((o) => o.flagged).length ?? 0;
  }, [item, state.content.customResponseSets]);

  const responseSetForLogic = useMemo<CustomResponseSet | null>(() => {
    if (item.type !== 'multipleChoice') return null;
    return state.content.customResponseSets.find((s) => s.id === item.responseSetId) ?? null;
  }, [item, state.content.customResponseSets]);

  return (
    <div ref={setNodeRef} style={style} className="group">
      {/* ── Main row ── */}
      <div
        className={`grid grid-cols-[24px_36px_1fr_260px_40px] items-center border-b last:border-b-0 px-3 transition-colors ${
          isSelected ? 'border-l-2 border-l-primary bg-accent' : 'hover:bg-accent/40'
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

        {/* Colored type chip */}
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-md ${chip.bg} ${
            isSelected ? 'ring-2 ring-primary/30' : ''
          }`}
          aria-hidden="true"
        >
          {chip.icon}
        </div>

        {/* Question text */}
        <div className="flex items-center gap-1.5 py-4 pl-2 pr-3">
          {required ? (
            <span className="shrink-0 text-base font-bold text-destructive">*</span>
          ) : null}
          <input
            type="text"
            value={prompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            onClick={() => dispatch({ type: 'selectItem', itemId: item.id })}
            placeholder={t('questionPlaceholder')}
            className="flex-1 bg-transparent text-[15px] font-medium outline-none"
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
        <div className="border-b border-l-2 border-l-primary bg-accent/30">
          {/* Top row — chip-style toggles */}
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-xs">
            {'required' in item ? (
              <label className="flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2.5 py-1">
                <Switch
                  id={`req-${item.id}`}
                  checked={required}
                  onCheckedChange={handleRequiredChange}
                  className="h-4 w-7 [&_[data-state=checked]]:translate-x-3"
                />
                <span className="font-medium">{t('requiredLabel')}</span>
              </label>
            ) : null}

            {item.type === 'multipleChoice' ? <MultipleSelectionChip item={item} /> : null}

            {item.type === 'multipleChoice' && flaggedCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-orange-100 px-2 py-1 text-[11px] font-medium text-orange-700">
                {tInline('flaggedCount', { count: flaggedCount })}
              </span>
            ) : null}
          </div>

          {/* Bottom row — action buttons */}
          <div className="flex flex-wrap items-center gap-1 px-3 py-2 text-sm">
            {supportsLogic ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowLogic((v) => !v)}
                className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <GitBranch className="h-3.5 w-3.5" />
                {showLogic ? tInline('hideLogic') : tInline('addLogic')}
              </Button>
            ) : null}

            {'note' in item ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowNote((v) => !v)}
                className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <StickyNote className="h-3.5 w-3.5" />
                {showNote ? tInline('hideNote') : tInline('addNote')}
              </Button>
            ) : null}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                  aria-label={tInline('more')}
                >
                  <MoreHorizontal className="h-4 w-4" />
                  {tInline('more')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuItem onSelect={handleDuplicate}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  {tInline('duplicate')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleMoveUp}>
                  <MoveUp className="mr-2 h-3.5 w-3.5" />
                  {tInline('moveUp')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleMoveDown}>
                  <MoveDown className="mr-2 h-3.5 w-3.5" />
                  {tInline('moveDown')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={handleDelete}
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  {tInline('delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Note editor */}
          {showNote && 'note' in item ? (
            <div className="border-t border-dashed border-muted-foreground/20 px-4 py-3">
              <Textarea
                value={note}
                onChange={(e) => handleNoteChange(e.target.value)}
                placeholder={tInline('notePlaceholder')}
                aria-label={t('itemNote')}
                className="min-h-[64px] bg-background text-sm"
              />
            </div>
          ) : null}

          {/* Logic editor */}
          {showLogic ? (
            <div className="space-y-2 border-t border-dashed border-muted-foreground/20 px-4 py-3">
              {item.type === 'multipleChoice' ? (
                responseSetForLogic === null ? (
                  <p className="text-xs text-muted-foreground">{tLogic('noResponseSetAssigned')}</p>
                ) : (
                  <div className="space-y-3">
                    {responseSetForLogic.options.map((opt) => (
                      <OptionTriggerEditor
                        key={opt.id}
                        setId={responseSetForLogic.id}
                        option={opt}
                      />
                    ))}
                  </div>
                )
              ) : (
                <VisibilityControl item={item} allItemsBefore={itemsBefore} />
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Multiple selection chip ──────────────────────────────────────────────────

function MultipleSelectionChip({ item }: { item: Extract<Item, { type: 'multipleChoice' }> }) {
  const t = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();

  const responseSet = state.content.customResponseSets.find((rs) => rs.id === item.responseSetId);
  const multiSelect = responseSet?.multiSelect ?? false;

  function handleChange(next: boolean) {
    dispatch({
      type: 'updateResponseSet',
      setId: item.responseSetId,
      patch: { multiSelect: next },
    });
  }

  return (
    <label className="flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2.5 py-1">
      <Switch
        id={`ms-${item.id}`}
        checked={multiSelect}
        onCheckedChange={handleChange}
        className="h-4 w-7 [&_[data-state=checked]]:translate-x-3"
      />
      <span className="font-medium">{t('multipleSelectionLabel')}</span>
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
  const tPicker = useTranslations('templates.editor.responseSetsPicker');
  const tType = useTranslations('templates.editor.questionType');
  const { state, dispatch } = useEditor();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [editingSetId, setEditingSetId] = useState<string | null>(null);

  const customResponseSets = state.content.customResponseSets;
  const filteredSets =
    search.trim() === ''
      ? customResponseSets
      : customResponseSets.filter((rs) => rs.name.toLowerCase().includes(search.toLowerCase()));

  /** Replace the item type by deleting + re-adding with copied prompt. */
  function replaceItemType(newType: SupportedItemType | StubItemType, responseSetId?: string) {
    const savedPrompt =
      item.type === 'instruction' ? item.body : 'prompt' in item ? item.prompt : 'New question';

    dispatch({ type: 'deleteItem', itemId: item.id });

    const newItem =
      newType === 'multipleChoice' && responseSetId !== undefined
        ? {
            ...makeItem('multipleChoice'),
            prompt: savedPrompt,
            responseSetId,
          }
        : {
            ...makeItem(newType),
            ...('prompt' in makeItem(newType) ? { prompt: savedPrompt } : {}),
          };

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

  function handleCreateNewSet() {
    // Create a blank-slate set so the user explicitly defines what options
    // they want — no Yes/No/N/A presets to mislead them. One placeholder
    // row is kept because the schema requires at least one option; the user
    // renames it (or deletes + adds new) in the Sheet that opens next.
    const newSetId = newId();
    dispatch({
      type: 'addResponseSet',
      set: {
        id: newSetId,
        name: '',
        sourceGlobalId: null,
        multiSelect: false,
        options: [{ id: newId(), label: 'Option 1', flagged: false }],
      },
    });
    // Attach (or swap) the set onto the current item.
    if (item.type === 'multipleChoice') {
      dispatch({
        type: 'updateItem',
        itemId: item.id,
        patch: { responseSetId: newSetId } as Partial<Item>,
      });
    } else {
      const savedPrompt =
        item.type === 'instruction' ? item.body : 'prompt' in item ? item.prompt : 'New question';
      dispatch({ type: 'deleteItem', itemId: item.id });
      const newItem = {
        ...makeItem('multipleChoice'),
        prompt: savedPrompt,
        responseSetId: newSetId,
      };
      dispatch({ type: 'addItem', pageId, sectionId, item: newItem });
      dispatch({ type: 'selectItem', itemId: newItem.id });
    }
    // Close the picker popover and open the manage Sheet so the user is
    // looking at exactly one surface — the set they're about to build.
    setOpen(false);
    setEditingSetId(newSetId);
  }

  function selectType(type: OtherType) {
    if (item.type === type) {
      setOpen(false);
      return;
    }
    replaceItemType(type as SupportedItemType | StubItemType);
  }

  const editingSet =
    editingSetId !== null
      ? (customResponseSets.find((rs) => rs.id === editingSetId) ?? null)
      : null;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-full w-full items-center gap-2 border-l px-4 py-4 text-sm hover:bg-muted/20"
          >
            <span className="flex flex-1 flex-wrap gap-1 overflow-hidden">
              <ResponseTypeTrigger
                item={item}
                customResponseSets={customResponseSets}
                tType={tType}
              />
            </span>
            <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>

        <PopoverContent className="flex w-[520px] p-0" align="start" side="bottom">
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
                  <div
                    key={rs.id}
                    className={`flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors ${
                      isActive ? 'bg-accent' : 'hover:bg-accent'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => selectResponseSet(rs.id)}
                      className="flex flex-1 flex-wrap gap-1 overflow-hidden text-left"
                    >
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
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingSetId(rs.id);
                      }}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                      aria-label={tPicker('editSet')}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
              {customResponseSets.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">{t('noResponseSets')}</p>
              ) : null}
            </div>

            <div className="border-t px-3 py-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCreateNewSet}
                className="w-full justify-start text-primary hover:bg-accent hover:text-primary"
                aria-label={tPicker('createNew')}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {tPicker('createNew')}
              </Button>
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

      {/* Inline manage-set sheet */}
      <ResponseSetManageSheet set={editingSet} onClose={() => setEditingSetId(null)} />
    </>
  );
}

// ─── Response set "manage" sheet ──────────────────────────────────────────────

function ResponseSetManageSheet({
  set,
  onClose,
}: {
  set: CustomResponseSet | null;
  onClose: () => void;
}) {
  const tPicker = useTranslations('templates.editor.responseSetsPicker');
  const { dispatch } = useEditor();

  const open = set !== null;

  function handleDeleteSet() {
    if (set === null) return;
    dispatch({ type: 'deleteResponseSet', setId: set.id });
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{tPicker('manageSet')}</SheetTitle>
          <SheetDescription>{tPicker('editSet')}</SheetDescription>
        </SheetHeader>

        {set !== null ? (
          <div className="mt-6 space-y-6">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor={`set-name-${set.id}`}>{tPicker('setNameLabel')}</Label>
              <Input
                id={`set-name-${set.id}`}
                value={set.name}
                placeholder={tPicker('setNamePlaceholder')}
                autoFocus={set.name === ''}
                onChange={(e) =>
                  dispatch({
                    type: 'updateResponseSet',
                    setId: set.id,
                    patch: { name: e.target.value },
                  })
                }
              />
            </div>

            {/* Multi-select toggle */}
            <label className="flex cursor-pointer items-center justify-between rounded-md border bg-card p-3">
              <span className="text-sm font-medium">{tPicker('multipleSelectionLabel')}</span>
              <Switch
                checked={set.multiSelect}
                onCheckedChange={(v) =>
                  dispatch({
                    type: 'updateResponseSet',
                    setId: set.id,
                    patch: { multiSelect: v },
                  })
                }
                aria-label={tPicker('multipleSelectionLabel')}
              />
            </label>

            {/* Options list */}
            <div className="space-y-2">
              <Label>{tPicker('optionLabel')}</Label>
              <div className="rounded-md border bg-card">
                {set.options.map((opt) => (
                  <div
                    key={opt.id}
                    className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
                  >
                    <Input
                      value={opt.label}
                      placeholder={tPicker('optionLabel')}
                      aria-label={tPicker('optionLabel')}
                      className="flex-1 border-0 p-0 text-sm shadow-none focus-visible:ring-0"
                      onChange={(e) =>
                        dispatch({
                          type: 'updateResponseOption',
                          setId: set.id,
                          optionId: opt.id,
                          patch: { label: e.target.value },
                        })
                      }
                    />
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
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
                        aria-label={tPicker('flaggedLabel')}
                      />
                      <Label htmlFor={`flag-${opt.id}`} className="text-xs text-muted-foreground">
                        {tPicker('flaggedLabel')}
                      </Label>
                    </div>
                    {set.options.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          dispatch({
                            type: 'deleteResponseOption',
                            setId: set.id,
                            optionId: opt.id,
                          })
                        }
                        aria-label={tPicker('optionLabel')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => dispatch({ type: 'addResponseOption', setId: set.id })}
                aria-label={tPicker('addOption')}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {tPicker('addOption')}
              </Button>
            </div>

            {/* Delete */}
            <div className="border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDeleteSet}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label={tPicker('deleteSet')}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {tPicker('deleteSet')}
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
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
