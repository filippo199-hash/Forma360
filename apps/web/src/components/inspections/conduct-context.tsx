'use client';

import type { Dispatch, ReactNode } from 'react';
import { createContext, useContext, useMemo, useReducer } from 'react';
import { conductReducer, initialConductState, type ConductAction, type ConductState } from './conduct-state';

interface ConductContextValue {
  state: ConductState;
  dispatch: Dispatch<ConductAction>;
}

const ConductContext = createContext<ConductContextValue | null>(null);

export function ConductProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial: Omit<ConductState, 'saveStatus'>;
}) {
  const [state, dispatch] = useReducer(conductReducer, initial, initialConductState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <ConductContext.Provider value={value}>{children}</ConductContext.Provider>;
}

export function useConduct(): ConductContextValue {
  const ctx = useContext(ConductContext);
  if (ctx === null) {
    throw new Error('useConduct must be called inside ConductProvider');
  }
  return ctx;
}
