import type { ReactNode } from 'react';

/**
 * The standard frame every module home renders inside: the light-blue
 * canvas and the centered 1200px column. Defined once here so the
 * background, max width and page padding are identical across Inspections,
 * Permits, COSHH, Incidents, Fire Safety, RAMS and the rest.
 *
 * Inspections is the reference the rest follow (navigation review / ADR
 * 0014 amendment). Before this, module layouts each hand-rolled the
 * wrapper: some painted the blue background and some did not, widths
 * disagreed (`max-w-[1200px]` vs `max-w-6xl`), and page padding came in
 * four incompatible schemes — so the same list looked different depending
 * on which module you were in. One component removes that drift.
 *
 * Detail, editor and print routes that deliberately break out of the
 * column (full-bleed conduct, fixed-inset editors) simply don't use this.
 */
export function ModuleShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-[#eef4fb] dark:bg-slate-900/40">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-4 sm:py-6">{children}</div>
    </div>
  );
}
