import type { ReactNode } from 'react';

/**
 * The standard frame every module home renders inside: the neutral
 * canvas and the centered 1200px column. Defined once here so the
 * background, max width and page padding are identical across Inspections,
 * Permits, COSHH, Incidents, Fire Safety, RAMS and the rest.
 *
 * The canvas is `bg-muted` — the same token `FocusedPageShell` already
 * uses, so the whole app sits on ONE canvas colour. It replaced a
 * hardcoded periwinkle (`#ebefff`, a product decision after a side-by-side
 * comparison): status chips and the primary blue read more honestly on a
 * neutral ground, and a token — unlike a hex — is visible to dark mode
 * and the ADR 0018 tenant theming. The `dark:` override is kept so dark
 * mode is pixel-for-pixel unchanged by that swap; in dark, `muted` (18%
 * lightness) sits ABOVE `card` (12%), so using it as the canvas would
 * invert elevation.
 *
 * Inspections is the reference the rest follow (navigation review / ADR
 * 0014 amendment). Before this, module layouts each hand-rolled the
 * wrapper: some painted the blue background and some did not, widths
 * disagreed (`max-w-[1400px]` vs `max-w-6xl`), and page padding came in
 * four incompatible schemes — so the same list looked different depending
 * on which module you were in. One component removes that drift.
 *
 * Detail, editor and print routes that deliberately break out of the
 * column (full-bleed conduct, fixed-inset editors) simply don't use this.
 *
 * The cap is 1400px (raised from 1200 in the density pass, alongside
 * register rows going py-2 → py-1.5): registers are scan surfaces, and on
 * a 1920 monitor the extra 200px goes almost entirely to the Title
 * column. `FocusedPageShell` and the settings layout deliberately stay at
 * 1200 — forms and editors read better in a narrower column. Note the cap
 * only binds above ~1440 viewport width; at the laptop default the rail
 * plus padding is the constraint, which is why the density comparison had
 * to be shot at 1920 to show it.
 */
export function ModuleShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-muted dark:bg-slate-900/40">
      <div className="mx-auto w-full max-w-[1400px] px-4 py-4 sm:py-6">{children}</div>
    </div>
  );
}
