/**
 * BUG-12 — the prefill decision for the "start a pack from …" tiles.
 *
 * A template pick pre-fills the job title, but the field belongs to the
 * user the moment they type in it. The rules, in order:
 *
 *   - an empty (or whitespace) field takes the template's title;
 *   - a field still holding a PREVIOUS prefill is replaced, so switching
 *     tile A → B never leaves the title and the selected template
 *     mismatched;
 *   - anything the user typed is preserved, always.
 *
 * Provenance travels with the result: `prefill` is the value this pick
 * now owns (so the next pick can recognise an untouched field), and the
 * caller clears it the moment the user edits the input.
 */
export interface TitlePrefillResult {
  /** What the field should now hold. */
  title: string;
  /** The prefill ownership after this pick. */
  prefill: string | null;
}

export function nextTitleOnTemplatePick(
  prev: string,
  lastPrefill: string | null,
  tplTitle: string,
): TitlePrefillResult {
  const untouched = prev.trim().length === 0 || prev === lastPrefill;
  if (!untouched) return { title: prev, prefill: lastPrefill };
  return { title: tplTitle, prefill: tplTitle };
}
