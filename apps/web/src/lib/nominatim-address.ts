/**
 * Nominatim (OpenStreetMap) address search → Company-details fields.
 *
 * The company settings form autofills city/postcode/country when the
 * admin picks a suggestion under "Address line 1". Same free service the
 * site location card already uses (its host is allowlisted in the CSP's
 * `connect-src`), asked with `addressdetails=1` so each hit carries a
 * structured address object instead of only a display string.
 *
 * Kept pure and separate from the form so the mapping — including the
 * house-number-before-street convention that differs by country — is
 * unit-testable without a network.
 */

export interface NominatimAddressHit {
  display_name: string;
  address?: {
    house_number?: string;
    road?: string;
    pedestrian?: string;
    neighbourhood?: string;
    suburb?: string;
    village?: string;
    town?: string;
    city?: string;
    municipality?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
}

export interface CompanyAddressFill {
  addressLine1?: string;
  city?: string;
  postcode?: string;
  country?: string;
}

/**
 * Countries that write the house number before the street
 * ("23 Milton Avenue"); most of continental Europe writes it after
 * ("Miltonstraße 23"). Only the ones our locales plausibly serve —
 * an unknown country falls into street-first, which reads fine
 * everywhere and is trivially edited.
 */
const NUMBER_FIRST = new Set(['gb', 'ie', 'us', 'ca', 'au', 'nz', 'fr']);

export function companyAddressFromNominatim(hit: NominatimAddressHit): CompanyAddressFill {
  const a = hit.address;
  const fill: CompanyAddressFill = {};
  if (a === undefined) {
    // No structured breakdown — fall back to the first display segment so
    // the pick still does something visible.
    const first = hit.display_name.split(',')[0]?.trim();
    if (first !== undefined && first.length > 0) fill.addressLine1 = first;
    return fill;
  }

  const street = a.road ?? a.pedestrian;
  if (street !== undefined) {
    if (a.house_number !== undefined) {
      const numberFirst = NUMBER_FIRST.has((a.country_code ?? '').toLowerCase());
      fill.addressLine1 = numberFirst
        ? `${a.house_number} ${street}`
        : `${street} ${a.house_number}`;
    } else {
      fill.addressLine1 = street;
    }
  } else {
    const first = hit.display_name.split(',')[0]?.trim();
    if (first !== undefined && first.length > 0) fill.addressLine1 = first;
  }

  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county;
  if (city !== undefined) fill.city = city;
  if (a.postcode !== undefined) fill.postcode = a.postcode;
  if (a.country !== undefined) fill.country = a.country;
  return fill;
}
