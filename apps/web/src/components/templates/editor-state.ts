/**
 * Template-editor reducer + context. Drives the whole builder UI.
 *
 * We keep the entire template content blob in a single reducer so every
 * mutation is atomic and can be validated / persisted in one place.
 * State is deliberately NOT Zustand — `useReducer` + React context is
 * fine for this scope and avoids another dep.
 *
 * The reducer is tenant-agnostic (no network calls, no tRPC imports).
 * Callers wire `saveDraft` / `publish` mutations around the serialised
 * content returned by the context's `getContent()` helper.
 */
import { newId } from '@forma360/shared/id';
import type {
  CustomResponseSet,
  Item,
  Page,
  ResponseOption,
  Section,
  TemplateContent,
  TemplateSettings,
} from '@forma360/shared/template-schema';

// ─── Reducer state ──────────────────────────────────────────────────────────

export interface EditorState {
  content: TemplateContent;
  /** Template-level metadata — kept outside `content` so renames don't dirty the schema. */
  name: string;
  description: string | null;
  /** `isDirty` flips on every edit; cleared after a successful save. */
  isDirty: boolean;
  /** Currently selected item id (right-side detail panel). */
  selectedItemId: string | null;
  /** Currently selected page id (middle column). */
  selectedPageId: string;
  /** updatedAt of the draft version we loaded — sent back on save for T-E18 optimistic concurrency. */
  loadedUpdatedAt: string | null;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export type EditorAction =
  | { type: 'hydrate'; content: TemplateContent; name: string; description: string | null; loadedUpdatedAt: string | null }
  | { type: 'markClean' }
  | { type: 'selectPage'; pageId: string }
  | { type: 'selectItem'; itemId: string | null }
  | { type: 'setTemplateName'; name: string }
  | { type: 'setTemplateDescription'; description: string }
  | { type: 'updateContentTitle'; title: string }
  | { type: 'updateContentDescription'; description: string }
  | { type: 'updateSettings'; patch: Partial<TemplateSettings> }
  | { type: 'addInspectionPage' }
  | { type: 'deletePage'; pageId: string }
  | { type: 'reorderPages'; fromIndex: number; toIndex: number }
  | { type: 'updatePage'; pageId: string; patch: Partial<Pick<Page, 'title' | 'description'>> }
  | { type: 'addSection'; pageId: string }
  | { type: 'deleteSection'; pageId: string; sectionId: string }
  | {
      type: 'updateSection';
      pageId: string;
      sectionId: string;
      patch: Partial<Pick<Section, 'title' | 'description'>>;
    }
  | {
      type: 'reorderSections';
      pageId: string;
      fromIndex: number;
      toIndex: number;
    }
  | { type: 'addItem'; pageId: string; sectionId: string; item: Item }
  | { type: 'deleteItem'; itemId: string }
  | { type: 'updateItem'; itemId: string; patch: Partial<Item> }
  | {
      type: 'reorderItems';
      pageId: string;
      sectionId: string;
      fromIndex: number;
      toIndex: number;
    }
  | {
      type: 'moveItemAcrossSections';
      itemId: string;
      targetPageId: string;
      targetSectionId: string;
      targetIndex: number;
    }
  | { type: 'addResponseSet'; set: CustomResponseSet }
  | { type: 'updateResponseSet'; setId: string; patch: Partial<CustomResponseSet> }
  | { type: 'deleteResponseSet'; setId: string }
  | {
      type: 'updateResponseOption';
      setId: string;
      optionId: string;
      patch: Partial<ResponseOption>;
    }
  | { type: 'addResponseOption'; setId: string }
  | { type: 'deleteResponseOption'; setId: string; optionId: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapPages(state: EditorState, fn: (p: Page) => Page): EditorState {
  return {
    ...state,
    isDirty: true,
    content: { ...state.content, pages: state.content.pages.map(fn) },
  };
}

function mapPage(state: EditorState, pageId: string, fn: (p: Page) => Page): EditorState {
  return mapPages(state, (p) => (p.id === pageId ? fn(p) : p));
}

function mapSection(
  state: EditorState,
  pageId: string,
  sectionId: string,
  fn: (s: Section) => Section,
): EditorState {
  return mapPage(state, pageId, (p) => ({
    ...p,
    sections: p.sections.map((s) => (s.id === sectionId ? fn(s) : s)),
  }));
}

function findItemLocation(
  content: TemplateContent,
  itemId: string,
): { pageId: string; sectionId: string } | null {
  for (const p of content.pages) {
    for (const s of p.sections) {
      if (s.items.some((i) => i.id === itemId)) {
        return { pageId: p.id, sectionId: s.id };
      }
    }
  }
  return null;
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'hydrate': {
      const firstPageId = action.content.pages[0]?.id ?? '';
      return {
        content: action.content,
        name: action.name,
        description: action.description,
        isDirty: false,
        selectedItemId: null,
        selectedPageId: firstPageId,
        loadedUpdatedAt: action.loadedUpdatedAt,
      };
    }
    case 'markClean':
      return { ...state, isDirty: false };
    case 'selectPage':
      return { ...state, selectedPageId: action.pageId, selectedItemId: null };
    case 'selectItem':
      return { ...state, selectedItemId: action.itemId };
    case 'setTemplateName':
      return { ...state, name: action.name, isDirty: true };
    case 'setTemplateDescription':
      return { ...state, description: action.description, isDirty: true };
    case 'updateContentTitle':
      return {
        ...state,
        isDirty: true,
        content: { ...state.content, title: action.title },
      };
    case 'updateContentDescription':
      return {
        ...state,
        isDirty: true,
        content: { ...state.content, description: action.description },
      };
    case 'updateSettings':
      return {
        ...state,
        isDirty: true,
        content: { ...state.content, settings: { ...state.content.settings, ...action.patch } },
      };
    case 'addInspectionPage': {
      const newPage: Page = {
        id: newId(),
        type: 'inspection',
        title: 'Inspection page',
        sections: [{ id: newId(), title: 'Section 1', items: [] }],
      };
      return {
        ...state,
        isDirty: true,
        selectedPageId: newPage.id,
        content: { ...state.content, pages: [...state.content.pages, newPage] },
      };
    }
    case 'deletePage': {
      const target = state.content.pages.find((p) => p.id === action.pageId);
      if (target === undefined || target.type === 'title') return state;
      // Refuse to delete the last remaining inspection page — the root
      // schema requires at least one non-title page for a useful template.
      const inspectionPages = state.content.pages.filter((p) => p.type === 'inspection');
      if (target.type === 'inspection' && inspectionPages.length <= 1) {
        return state;
      }
      const remaining = state.content.pages.filter((p) => p.id !== action.pageId);
      const nextSelected = remaining[0]?.id ?? state.selectedPageId;
      return {
        ...state,
        isDirty: true,
        selectedPageId: nextSelected,
        selectedItemId: null,
        content: { ...state.content, pages: remaining },
      };
    }
    case 'reorderPages': {
      // Title page is fixed at index 0 — refuse any swap that involves it.
      if (action.fromIndex === 0 || action.toIndex === 0) return state;
      const pages = state.content.pages;
      if (
        action.fromIndex < 0 ||
        action.toIndex < 0 ||
        action.fromIndex >= pages.length ||
        action.toIndex >= pages.length
      ) {
        return state;
      }
      const next = [...pages];
      const [moved] = next.splice(action.fromIndex, 1);
      if (moved === undefined) return state;
      next.splice(action.toIndex, 0, moved);
      return {
        ...state,
        isDirty: true,
        content: { ...state.content, pages: next },
      };
    }
    case 'updatePage':
      return mapPage(state, action.pageId, (p) => {
        const patched: Page = {
          ...p,
          ...('title' in action.patch && action.patch.title !== undefined
            ? { title: action.patch.title }
            : {}),
          ...('description' in action.patch && action.patch.description !== undefined
            ? { description: action.patch.description }
            : {}),
        };
        return patched;
      });
    case 'addSection':
      return mapPage(state, action.pageId, (p) => ({
        ...p,
        sections: [...p.sections, { id: newId(), title: 'New section', items: [] }],
      }));
    case 'deleteSection':
      return mapPage(state, action.pageId, (p) => ({
        ...p,
        sections: p.sections.filter((s) => s.id !== action.sectionId),
      }));
    case 'updateSection':
      return mapSection(state, action.pageId, action.sectionId, (s) => ({
        ...s,
        ...(action.patch.title !== undefined ? { title: action.patch.title } : {}),
        ...(action.patch.description !== undefined ? { description: action.patch.description } : {}),
      }));
    case 'reorderSections': {
      return mapPage(state, action.pageId, (p) => {
        const next = [...p.sections];
        const [moved] = next.splice(action.fromIndex, 1);
        if (moved === undefined) return p;
        next.splice(action.toIndex, 0, moved);
        return { ...p, sections: next };
      });
    }
    case 'addItem':
      return mapSection(state, action.pageId, action.sectionId, (s) => ({
        ...s,
        items: [...s.items, action.item],
      }));
    case 'deleteItem': {
      const loc = findItemLocation(state.content, action.itemId);
      if (loc === null) return state;
      const next = mapSection(state, loc.pageId, loc.sectionId, (s) => ({
        ...s,
        items: s.items.filter((i) => i.id !== action.itemId),
      }));
      return {
        ...next,
        selectedItemId:
          state.selectedItemId === action.itemId ? null : state.selectedItemId,
      };
    }
    case 'updateItem': {
      const loc = findItemLocation(state.content, action.itemId);
      if (loc === null) return state;
      return mapSection(state, loc.pageId, loc.sectionId, (s) => ({
        ...s,
        items: s.items.map((i) =>
          i.id === action.itemId ? ({ ...i, ...action.patch } as Item) : i,
        ),
      }));
    }
    case 'reorderItems':
      return mapSection(state, action.pageId, action.sectionId, (s) => {
        const next = [...s.items];
        const [moved] = next.splice(action.fromIndex, 1);
        if (moved === undefined) return s;
        next.splice(action.toIndex, 0, moved);
        return { ...s, items: next };
      });
    case 'moveItemAcrossSections': {
      const loc = findItemLocation(state.content, action.itemId);
      if (loc === null) return state;
      // Find & detach
      let detached: Item | null = null;
      const withoutSource = mapSection(state, loc.pageId, loc.sectionId, (s) => {
        detached = s.items.find((i) => i.id === action.itemId) ?? null;
        return { ...s, items: s.items.filter((i) => i.id !== action.itemId) };
      });
      if (detached === null) return state;
      // Attach at target
      const moved: Item = detached;
      return mapSection(
        withoutSource,
        action.targetPageId,
        action.targetSectionId,
        (s) => {
          const next = [...s.items];
          next.splice(Math.max(0, Math.min(action.targetIndex, next.length)), 0, moved);
          return { ...s, items: next };
        },
      );
    }
    case 'addResponseSet':
      return {
        ...state,
        isDirty: true,
        content: {
          ...state.content,
          customResponseSets: [...state.content.customResponseSets, action.set],
        },
      };
    case 'updateResponseSet':
      return {
        ...state,
        isDirty: true,
        content: {
          ...state.content,
          customResponseSets: state.content.customResponseSets.map((rs) =>
            rs.id === action.setId ? { ...rs, ...action.patch } : rs,
          ),
        },
      };
    case 'deleteResponseSet':
      return {
        ...state,
        isDirty: true,
        content: {
          ...state.content,
          customResponseSets: state.content.customResponseSets.filter(
            (rs) => rs.id !== action.setId,
          ),
        },
      };
    case 'updateResponseOption':
      return {
        ...state,
        isDirty: true,
        content: {
          ...state.content,
          customResponseSets: state.content.customResponseSets.map((rs) =>
            rs.id === action.setId
              ? {
                  ...rs,
                  options: rs.options.map((o) =>
                    o.id === action.optionId ? { ...o, ...action.patch } : o,
                  ),
                }
              : rs,
          ),
        },
      };
    case 'addResponseOption':
      return {
        ...state,
        isDirty: true,
        content: {
          ...state.content,
          customResponseSets: state.content.customResponseSets.map((rs) =>
            rs.id === action.setId
              ? {
                  ...rs,
                  options: [
                    ...rs.options,
                    { id: newId(), label: 'New option', flagged: false },
                  ],
                }
              : rs,
          ),
        },
      };
    case 'deleteResponseOption':
      return {
        ...state,
        isDirty: true,
        content: {
          ...state.content,
          customResponseSets: state.content.customResponseSets.map((rs) =>
            rs.id === action.setId
              ? { ...rs, options: rs.options.filter((o) => o.id !== action.optionId) }
              : rs,
          ),
        },
      };
    default:
      return state;
  }
}

// ─── Item factory ────────────────────────────────────────────────────────────

export type SupportedItemType =
  | 'text'
  | 'number'
  | 'date'
  | 'datetime'
  | 'time'
  | 'multipleChoice'
  | 'checkbox'
  | 'signature'
  | 'media'
  | 'slider'
  | 'instruction'
  | 'conductedBy'
  | 'inspectionDate'
  | 'documentNumber';

/** Exotic types that are stubbed in the UI — creatable but not fully editable. */
export type StubItemType = 'site' | 'location' | 'asset' | 'company' | 'annotation';

/** Types allowed on the title page only. */
export const TITLE_PAGE_ONLY = new Set<string>([
  'site',
  'conductedBy',
  'inspectionDate',
  'documentNumber',
  'location',
  'asset',
  'company',
]);

/**
 * Create a blank item of the given type. Produces a schema-valid stub so
 * it can be added to the editor state without ZodErrors firing.
 */
export function makeItem(type: SupportedItemType | StubItemType): Item {
  const id = newId();
  const base = { id, prompt: 'New question', required: false };
  switch (type) {
    case 'text':
      return { ...base, type: 'text', multiline: false, maxLength: 2000 };
    case 'number':
      return { ...base, type: 'number', decimalPlaces: 2 };
    case 'date':
      return { ...base, type: 'date' };
    case 'datetime':
      return { ...base, type: 'datetime' };
    case 'time':
      return { ...base, type: 'time' };
    case 'multipleChoice':
      // responseSetId is filled in once a set is attached — the editor
      // forces this before save. Until then the item is flagged invalid.
      return { ...base, type: 'multipleChoice', responseSetId: id };
    case 'checkbox':
      return { ...base, type: 'checkbox', label: 'Confirm' };
    case 'signature':
      return {
        ...base,
        type: 'signature',
        mode: 'parallel',
        slots: [{ slotIndex: 0, assigneeUserId: null }],
      };
    case 'media':
      return { ...base, type: 'media', mediaKind: 'any', maxCount: 10 };
    case 'slider':
      return { ...base, type: 'slider', min: 0, max: 10, step: 1 };
    case 'instruction':
      return { id, type: 'instruction', body: '', mediaKeys: [] };
    case 'conductedBy':
      return { ...base, type: 'conductedBy', prompt: 'Conducted by' };
    case 'inspectionDate':
      return { ...base, type: 'inspectionDate', prompt: 'Inspection date' };
    case 'documentNumber':
      return { ...base, type: 'documentNumber', prompt: 'Document number' };
    case 'site':
      return { ...base, type: 'site', prompt: 'Site' };
    case 'location':
      return { ...base, type: 'location', prompt: 'Location' };
    case 'asset':
      return { ...base, type: 'asset', prompt: 'Asset' };
    case 'company':
      return { ...base, type: 'company', prompt: 'Company' };
    case 'annotation':
      return { ...base, type: 'annotation', prompt: 'Annotate the image' };
  }
}
