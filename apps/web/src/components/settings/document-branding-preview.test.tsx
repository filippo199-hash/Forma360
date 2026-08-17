/**
 * The Branding card's document mock-ups must show the LIVE branding on
 * the surfaces it actually lands on: the real letterhead component with
 * the company details, the uploaded logo, and the primary/accent colours
 * placed exactly where the inspection print layout places them. An admin
 * judges a logo against these papers, so a preview that drifted from the
 * renderer would defeat its purpose.
 *
 * Messages are provided inline so the test pins the component contract,
 * not the (centrally merged) locale bundles.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentBrandingPreview } from './document-branding-preview';
import type { CompanyDetailsValue } from './company-details-form';

afterEach(cleanup);

const messages = {
  settings: {
    company: {
      branding: {
        docPreview: {
          title: 'On your documents',
          help: 'A live preview.',
          recordCaption: 'Permits, assessments and reports carry the letterhead.',
          inspectionCaption: 'Inspection report covers use your colours.',
          emptyHint: 'Fill in Company details above to complete the letterhead.',
        },
      },
    },
  },
};

function renderPreview({
  details = null,
  logoUrl = null,
}: {
  details?: CompanyDetailsValue | null;
  logoUrl?: string | null;
} = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DocumentBrandingPreview
        companyName="Acme Scaffolding Ltd"
        details={details}
        logoUrl={logoUrl}
        primaryColor="#0f766e"
        accentColor="#f97316"
      />
    </NextIntlClientProvider>,
  );
}

describe('DocumentBrandingPreview', () => {
  it('renders the letterhead with the company name and saved details on both papers', () => {
    renderPreview({
      details: { addressLine1: '12 Foundry Lane', city: 'Leeds', companyNumber: '12345678' },
    });
    // Both mock papers mount the real CompanyLetterhead.
    expect(screen.getAllByText('Acme Scaffolding Ltd')).toHaveLength(2);
    expect(screen.getAllByText(/12 Foundry Lane, Leeds/)).toHaveLength(2);
    expect(screen.getAllByText(/Company No\. 12345678/)).toHaveLength(2);
    expect(
      screen.queryByText('Fill in Company details above to complete the letterhead.'),
    ).toBeNull();
  });

  it('places the live logo on the record letterhead and the inspection cover bar', () => {
    const { container } = renderPreview({ logoUrl: 'https://cdn.example.com/logo.png' });
    const imgs = [...container.querySelectorAll('img')];
    expect(imgs.length).toBe(2);
    for (const img of imgs) {
      expect(img.getAttribute('src')).toBe('https://cdn.example.com/logo.png');
    }
  });

  it('paints the cover bar with the primary colour and the section rule with the accent', () => {
    const { container } = renderPreview();
    // The DOM may keep the hex or normalise to rgb() — accept either.
    const primary = /^(#0f766e|rgb\(15,\s*118,\s*110\))$/;
    const cover = [...container.querySelectorAll('div')].find((el) =>
      primary.test(el.style.backgroundColor),
    );
    expect(cover?.textContent ?? '').toContain('Weekly site inspection');
    const rule = [...container.querySelectorAll('div')].find(
      (el) => el.textContent === 'Site conditions',
    );
    // The DOM may keep the hex or normalise to rgb() — accept either.
    const ruleStyle = `${rule?.style.borderBottom ?? ''} ${rule?.style.borderBottomColor ?? ''}`;
    expect(/#f97316|rgb\(249,\s*115,\s*22\)/.test(ruleStyle)).toBe(true);
  });

  it('nudges towards the Company details card when nothing is filled in yet', () => {
    renderPreview({ details: null });
    expect(
      screen.getByText('Fill in Company details above to complete the letterhead.'),
    ).toBeTruthy();
  });
});
