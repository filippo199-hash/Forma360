/**
 * The address pick must land as the form fields the letterhead prints —
 * street line composed in the country's convention, city resolved from
 * whichever of Nominatim's four settlement keys is present.
 */
import { describe, expect, it } from 'vitest';
import { companyAddressFromNominatim } from './nominatim-address';

describe('companyAddressFromNominatim', () => {
  it('writes UK addresses number-first and fills city/postcode/country', () => {
    expect(
      companyAddressFromNominatim({
        display_name: '23, Milton Avenue, London, England, N6 5QF, United Kingdom',
        address: {
          house_number: '23',
          road: 'Milton Avenue',
          city: 'London',
          postcode: 'N6 5QF',
          country: 'United Kingdom',
          country_code: 'gb',
        },
      }),
    ).toEqual({
      addressLine1: '23 Milton Avenue',
      city: 'London',
      postcode: 'N6 5QF',
      country: 'United Kingdom',
    });
  });

  it('writes continental addresses street-first', () => {
    expect(
      companyAddressFromNominatim({
        display_name: 'Miltonstraße 23, Berlin',
        address: {
          house_number: '23',
          road: 'Miltonstraße',
          city: 'Berlin',
          postcode: '10115',
          country: 'Deutschland',
          country_code: 'de',
        },
      }).addressLine1,
    ).toBe('Miltonstraße 23');
  });

  it('resolves the settlement from town/village when city is absent', () => {
    expect(
      companyAddressFromNominatim({
        display_name: 'High Street, Ambleside',
        address: { road: 'High Street', town: 'Ambleside', country_code: 'gb' },
      }),
    ).toEqual({ addressLine1: 'High Street', city: 'Ambleside' });
  });

  it('falls back to the first display segment when there is no road', () => {
    expect(
      companyAddressFromNominatim({
        display_name: 'Riverside Business Park, Leeds, United Kingdom',
        address: { city: 'Leeds', country: 'United Kingdom', country_code: 'gb' },
      }),
    ).toEqual({
      addressLine1: 'Riverside Business Park',
      city: 'Leeds',
      country: 'United Kingdom',
    });
  });

  it('never invents fields the hit does not carry', () => {
    expect(
      companyAddressFromNominatim({ display_name: 'Somewhere', address: { road: 'Somewhere' } }),
    ).toEqual({ addressLine1: 'Somewhere' });
  });
});
