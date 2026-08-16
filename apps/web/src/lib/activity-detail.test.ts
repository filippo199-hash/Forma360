/**
 * BUG-16 / NR3-08: what a COSHH activity line may show after its label.
 *
 * The rows are append-only evidence and keep their machine shapes —
 * "routesOfExposure, personsCount | was {…}" on `updated`, `v2` on
 * `published` — so the DISPLAY layer is what keeps raw column names, JSON
 * blobs and bare counts away from readers.
 */
import { describe, expect, it } from 'vitest';
import { coshhEventDisplay, displayableDetail } from './activity-detail';

describe('coshhEventDisplay (BUG-16)', () => {
  it('renders updated rows as a field list, never the before-values JSON', () => {
    expect(
      coshhEventDisplay(
        'updated',
        'routesOfExposure, personsCount | was {"routesOfExposure":[],"personsCount":null}',
      ),
    ).toEqual({ type: 'fields', fields: ['routesOfExposure', 'personsCount'] });
    expect(coshhEventDisplay('updated', 'plainSummary | was {"plainSummary":"old"}')).toEqual({
      type: 'fields',
      fields: ['plainSummary'],
    });
  });

  it('skips unknown field names rather than showing them raw', () => {
    expect(coshhEventDisplay('updated', 'notAField | was {"notAField":1}')).toBeNull();
    expect(coshhEventDisplay('updated', 'notAField, personsCount | was {"notAField":1}')).toEqual({
      type: 'fields',
      fields: ['personsCount'],
    });
  });

  it('NR3-08: published rows carry the version number; legacy action counts are suppressed', () => {
    expect(coshhEventDisplay('published', 'v2')).toEqual({ type: 'publishedVersion', version: 2 });
    expect(coshhEventDisplay('published', 'v1')).toEqual({ type: 'publishedVersion', version: 1 });
    // Pre-fix rows logged the created-actions count — "Assessment
    // published — 0" is exactly the reported string.
    expect(coshhEventDisplay('published', '0')).toBeNull();
    expect(coshhEventDisplay('published', '3')).toBeNull();
  });

  it('other kinds keep genuine prose and drop machine values', () => {
    expect(coshhEventDisplay('control_added', 'Nitrile gloves and goggles')).toEqual({
      type: 'text',
      text: 'Nitrile gloves and goggles',
    });
    expect(coshhEventDisplay('surveillance_enrolled', '01KZH2DSEHDT8H08K0DXPGXB03')).toBeNull();
    expect(coshhEventDisplay('created', '')).toBeNull();
    expect(coshhEventDisplay('created', null)).toBeNull();
  });

  it('a prose detail containing " | was " on a non-updated kind is untouched', () => {
    expect(coshhEventDisplay('review_recorded', 'Checked | was fine on inspection')).toEqual({
      type: 'text',
      text: 'Checked | was fine on inspection',
    });
  });
});

describe('displayableDetail — pure-number suppression (BUG-16)', () => {
  it('drops bare counts', () => {
    expect(displayableDetail('0')).toBeNull();
    expect(displayableDetail('42')).toBeNull();
    expect(displayableDetail('1.5')).toBeNull();
  });

  it('still keeps prose', () => {
    expect(displayableDetail('Nitrile gloves and goggles')).toBe('Nitrile gloves and goggles');
    expect(displayableDetail('toluene: 62 ppm')).toBe('toluene: 62 ppm');
  });
});
