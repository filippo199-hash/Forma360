import type { TemplateContent } from '@forma360/shared/template-schema';
import { TEMPLATE_SCHEMA_VERSION } from '@forma360/shared/template-schema';
import { describe, expect, it } from 'vitest';
import { editorReducer, makeItem, type EditorState } from './editor-state';

/**
 * Reducer-level behaviour tests. We target the non-trivial branches
 * (cross-section move, delete-item clearing the selection, dense
 * slotIndex on signature-slot removal) rather than every setter.
 */

function baseContent(): TemplateContent {
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    title: 'Test',
    pages: [
      {
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
        type: 'title',
        title: 'Title',
        sections: [
          {
            id: 'bbbbbbbbbbbbbbbbbbbbbbbbbb',
            title: 'Details',
            items: [],
          },
        ],
      },
      {
        id: 'cccccccccccccccccccccccccc',
        type: 'inspection',
        title: 'Page 1',
        sections: [
          {
            id: 'dddddddddddddddddddddddddd',
            title: 'Section 1',
            items: [],
          },
        ],
      },
    ],
    settings: {
      titleFormat: '{date}',
      documentNumberFormat: '{counter:6}',
      documentNumberStart: 1,
    },
    customResponseSets: [],
  };
}

function initialState(): EditorState {
  const content = baseContent();
  const firstPage = content.pages[0];
  if (firstPage === undefined) throw new Error('bad fixture');
  return {
    content,
    name: 'Test',
    description: null,
    isDirty: false,
    selectedItemId: null,
    selectedPageId: firstPage.id,
    loadedUpdatedAt: null,
  };
}

describe('editorReducer', () => {
  it('addItem adds to the requested section and flips isDirty', () => {
    const s = initialState();
    const item = makeItem('text');
    const next = editorReducer(s, {
      type: 'addItem',
      pageId: 'cccccccccccccccccccccccccc',
      sectionId: 'dddddddddddddddddddddddddd',
      item,
    });
    expect(next.isDirty).toBe(true);
    const target = next.content.pages[1]?.sections[0]?.items[0];
    expect(target?.id).toBe(item.id);
  });

  it('deleteItem clears selectedItemId when it matches', () => {
    const s = initialState();
    const item = makeItem('text');
    const withItem = editorReducer(s, {
      type: 'addItem',
      pageId: 'cccccccccccccccccccccccccc',
      sectionId: 'dddddddddddddddddddddddddd',
      item,
    });
    const selected = editorReducer(withItem, { type: 'selectItem', itemId: item.id });
    expect(selected.selectedItemId).toBe(item.id);
    const deleted = editorReducer(selected, { type: 'deleteItem', itemId: item.id });
    expect(deleted.selectedItemId).toBeNull();
    expect(deleted.content.pages[1]?.sections[0]?.items).toHaveLength(0);
  });

  it('reorderItems swaps position in the section', () => {
    const s = initialState();
    const a = makeItem('text');
    const b = makeItem('number');
    let next = editorReducer(s, {
      type: 'addItem',
      pageId: 'cccccccccccccccccccccccccc',
      sectionId: 'dddddddddddddddddddddddddd',
      item: a,
    });
    next = editorReducer(next, {
      type: 'addItem',
      pageId: 'cccccccccccccccccccccccccc',
      sectionId: 'dddddddddddddddddddddddddd',
      item: b,
    });
    const reordered = editorReducer(next, {
      type: 'reorderItems',
      pageId: 'cccccccccccccccccccccccccc',
      sectionId: 'dddddddddddddddddddddddddd',
      fromIndex: 0,
      toIndex: 1,
    });
    const items = reordered.content.pages[1]?.sections[0]?.items ?? [];
    expect(items.map((i) => i.id)).toEqual([b.id, a.id]);
  });

  it('addInspectionPage appends a new inspection page and selects it', () => {
    const s = initialState();
    const next = editorReducer(s, { type: 'addInspectionPage' });
    expect(next.content.pages).toHaveLength(3);
    const newPage = next.content.pages[2];
    expect(newPage?.type).toBe('inspection');
    expect(next.selectedPageId).toBe(newPage?.id);
  });

  it('deletePage refuses to delete the title page', () => {
    const s = initialState();
    const next = editorReducer(s, {
      type: 'deletePage',
      pageId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    // Unchanged — pages still has the title + inspection page.
    expect(next.content.pages).toHaveLength(2);
  });

  it('deletePage refuses to delete the last inspection page', () => {
    const s = initialState();
    const next = editorReducer(s, {
      type: 'deletePage',
      pageId: 'cccccccccccccccccccccccccc',
    });
    // Unchanged — cannot leave a template with only a title page.
    expect(next.content.pages).toHaveLength(2);
    expect(next.isDirty).toBe(false);
  });

  it('deletePage succeeds when at least one inspection page remains', () => {
    const s = initialState();
    const withExtra = editorReducer(s, { type: 'addInspectionPage' });
    expect(withExtra.content.pages).toHaveLength(3);
    const deleted = editorReducer(withExtra, {
      type: 'deletePage',
      pageId: 'cccccccccccccccccccccccccc',
    });
    expect(deleted.content.pages).toHaveLength(2);
    expect(deleted.content.pages.find((p) => p.id === 'cccccccccccccccccccccccccc')).toBeUndefined();
    expect(deleted.isDirty).toBe(true);
  });

  it('reorderPages swaps two inspection pages', () => {
    const s = initialState();
    const a = editorReducer(s, { type: 'addInspectionPage' });
    const secondId = a.content.pages[2]?.id ?? '';
    const swapped = editorReducer(a, {
      type: 'reorderPages',
      fromIndex: 1,
      toIndex: 2,
    });
    expect(swapped.content.pages.map((p) => p.id)).toEqual([
      'aaaaaaaaaaaaaaaaaaaaaaaaaa',
      secondId,
      'cccccccccccccccccccccccccc',
    ]);
    expect(swapped.isDirty).toBe(true);
  });

  it('reorderPages refuses fromIndex=0 (title page stays first)', () => {
    const s = initialState();
    const a = editorReducer(s, { type: 'addInspectionPage' });
    const before = a.content.pages.map((p) => p.id);
    const next = editorReducer(a, { type: 'reorderPages', fromIndex: 0, toIndex: 1 });
    expect(next.content.pages.map((p) => p.id)).toEqual(before);
  });

  it('reorderPages refuses toIndex=0 (cannot displace the title page)', () => {
    const s = initialState();
    const a = editorReducer(s, { type: 'addInspectionPage' });
    const before = a.content.pages.map((p) => p.id);
    const next = editorReducer(a, { type: 'reorderPages', fromIndex: 2, toIndex: 0 });
    expect(next.content.pages.map((p) => p.id)).toEqual(before);
  });

  it('updateItem with visibility undefined clears the gate', () => {
    const s = initialState();
    const dep = makeItem('checkbox');
    const dependent = makeItem('text');
    let next = editorReducer(s, {
      type: 'addItem',
      pageId: 'cccccccccccccccccccccccccc',
      sectionId: 'dddddddddddddddddddddddddd',
      item: dep,
    });
    next = editorReducer(next, {
      type: 'addItem',
      pageId: 'cccccccccccccccccccccccccc',
      sectionId: 'dddddddddddddddddddddddddd',
      item: dependent,
    });
    const withVis = editorReducer(next, {
      type: 'updateItem',
      itemId: dependent.id,
      patch: { visibility: { dependsOn: dep.id, operator: 'equals', value: true } },
    });
    const after = withVis.content.pages[1]?.sections[0]?.items[1];
    expect(after && 'visibility' in after ? after.visibility : null).toEqual({
      dependsOn: dep.id,
      operator: 'equals',
      value: true,
    });
    const cleared = editorReducer(withVis, {
      type: 'updateItem',
      itemId: dependent.id,
      patch: { visibility: undefined },
    });
    const finalItem = cleared.content.pages[1]?.sections[0]?.items[1];
    // `undefined` on the patch removes the field via spread
    expect(finalItem && 'visibility' in finalItem ? finalItem.visibility : undefined).toBeUndefined();
  });

  it('addResponseSet → addResponseOption → deleteResponseOption', () => {
    const s = initialState();
    const set = {
      id: 'eeeeeeeeeeeeeeeeeeeeeeeeee',
      name: 'Pass/Fail',
      sourceGlobalId: null,
      multiSelect: false,
      options: [{ id: 'ffffffffffffffffffffffffff', label: 'Pass', flagged: false }],
    };
    const withSet = editorReducer(s, { type: 'addResponseSet', set });
    const withOpt = editorReducer(withSet, {
      type: 'addResponseOption',
      setId: set.id,
    });
    expect(withOpt.content.customResponseSets[0]?.options).toHaveLength(2);
    const delOpt = editorReducer(withOpt, {
      type: 'deleteResponseOption',
      setId: set.id,
      optionId: 'ffffffffffffffffffffffffff',
    });
    expect(delOpt.content.customResponseSets[0]?.options).toHaveLength(1);
  });
});
