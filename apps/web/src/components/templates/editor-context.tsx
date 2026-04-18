'use client';

import type { Dispatch, ReactNode } from 'react';
import { createContext, useContext, useMemo, useReducer } from 'react';
import type { TemplateContent } from '@forma360/shared/template-schema';
import type { EditorAction, EditorState } from './editor-state';
import { editorReducer } from './editor-state';

interface EditorContextValue {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({
  children,
  initialContent,
  initialName,
  initialDescription,
  initialUpdatedAt,
}: {
  children: ReactNode;
  initialContent: TemplateContent;
  initialName: string;
  initialDescription: string | null;
  initialUpdatedAt: string | null;
}) {
  const initial: EditorState = {
    content: initialContent,
    name: initialName,
    description: initialDescription,
    isDirty: false,
    selectedItemId: null,
    selectedPageId: initialContent.pages[0]?.id ?? '',
    loadedUpdatedAt: initialUpdatedAt,
  };
  const [state, dispatch] = useReducer(editorReducer, initial);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (ctx === null) {
    throw new Error('useEditor must be called inside EditorProvider');
  }
  return ctx;
}
