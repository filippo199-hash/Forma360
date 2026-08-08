import type { ReactNode } from 'react';

/**
 * "For me" canvas. The queue itself owns its centered column, so this only
 * paints the shared page background — the same one `ModuleShell` gives every
 * module home — across `/my-work`, `/my-work/actions` and
 * `/my-work/acknowledgements`.
 */
export default function MyWorkLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen w-full bg-[#e1edfb] dark:bg-slate-900/40">{children}</div>;
}
