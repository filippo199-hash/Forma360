'use client';

/**
 * Collapse state for the left rail, lifted out of the sidebar.
 *
 * The collapse control used to sit in the sidebar's own 56px header,
 * which is what split the top of the app into two bars with a seam down
 * the middle. The bar is one continuous strip now, so the toggle lives
 * in the header while the width it controls lives in the sidebar — two
 * components either side of the layout tree, hence a context rather than
 * component state.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/** localStorage key for the collapsed rail. */
const COLLAPSE_KEY = 'forma360.nav.collapsed';

interface NavCollapseValue {
  collapsed: boolean;
  toggle: () => void;
}

/**
 * Default for consumers rendered outside the app shell (the public
 * header): expanded, and toggling is a no-op — there is no rail to fold.
 */
const NavCollapseContext = createContext<NavCollapseValue>({
  collapsed: false,
  toggle: () => undefined,
});

export function NavCollapseProvider({ children }: { children: ReactNode }) {
  // Deliberately a lazy `false` on the server: the sidebar renders
  // expanded during SSR and settles on the stored value after hydration,
  // which is a one-frame width change rather than a hydration mismatch.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // Private-mode storage refusal — stay expanded.
    }
  }, []);

  // ADR 0018: full-width surfaces (the dashboard) ask the rail to fold on
  // entry. One-way and not persisted as a preference: the user can
  // re-expand, and their stored choice is untouched.
  useEffect(() => {
    const onCollapse = (): void => setCollapsed(true);
    window.addEventListener('forma360:nav-collapse', onCollapse);
    return () => window.removeEventListener('forma360:nav-collapse', onCollapse);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Non-fatal: the preference just won't survive the session.
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ collapsed, toggle }), [collapsed, toggle]);

  return <NavCollapseContext.Provider value={value}>{children}</NavCollapseContext.Provider>;
}

export function useNavCollapse(): NavCollapseValue {
  return useContext(NavCollapseContext);
}
