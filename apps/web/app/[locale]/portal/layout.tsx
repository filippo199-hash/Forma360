import type { ReactNode } from 'react';

/** Distinct canvas for the external contractor portal. */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-full w-full bg-[#eef4fb] dark:bg-slate-900/40">{children}</div>;
}
