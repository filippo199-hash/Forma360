/**
 * Pure resolution of the gas-reading form's draft state (NR3-08 / NR-03).
 *
 * The substance default used to be event-driven: picking a limit in the
 * <select> wrote the limit's label into the substance field once, and the
 * post-record reset cleared the field without re-running that write — so
 * the first reading recorded "with no Substance typed" and the second
 * refused until one was typed. The requirement looked inconsistent; it was
 * a default that only existed inside one change handler. Deriving the
 * effective substance here makes it hold on every render, including after
 * the success reset.
 */
import {
  GAS_READING_BOUNDS,
  isGasReadingValueInBounds,
  type GasReadingUnit,
} from '@forma360/shared/permits';

export interface GasReadingDraft {
  /** What will be recorded: typed text, else the selected limit's label. */
  substance: string;
  /** Parsed reading; NaN while the field is empty or not a number. */
  value: number;
  /**
   * NR-03: false only when a parsed number sits outside the unit's
   * physical bounds — the state that shows the inline bounds hint.
   */
  valueInBounds: boolean;
  /** Everything required to press Record. */
  canRecord: boolean;
}

export function resolveGasReadingDraft(args: {
  typedSubstance: string;
  selectedLimitLabel: string | null;
  reading: string;
  unit: GasReadingUnit;
}): GasReadingDraft {
  const typed = args.typedSubstance.trim();
  const substance = typed !== '' ? typed : (args.selectedLimitLabel ?? '');
  const raw = args.reading.trim();
  const value = raw === '' ? Number.NaN : Number(raw);
  const valueInBounds = Number.isNaN(value) ? true : isGasReadingValueInBounds(args.unit, value);
  return {
    substance,
    value,
    valueInBounds,
    canRecord: substance !== '' && !Number.isNaN(value) && valueInBounds,
  };
}

export { GAS_READING_BOUNDS };
