import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { InspectionRenderSnapshot } from '@forma360/render';
import { PrintLayout } from './print-layout';

afterEach(cleanup);

/** Minimal snapshot with one flagged multiple-choice answer + one plain text answer. */
function snapshot(responses: Record<string, unknown>): InspectionRenderSnapshot {
  const content = {
    schemaVersion: '1',
    title: 'Daily Checklist',
    pages: [
      {
        id: 'title',
        type: 'title',
        title: 'Title',
        sections: [{ id: 'ts', title: 'H', items: [] }],
      },
      {
        id: 'pg1',
        type: 'inspection',
        title: 'Safety',
        sections: [
          {
            id: 'sec1',
            title: 'Checks',
            items: [
              {
                id: 'q1',
                type: 'multipleChoice',
                prompt: 'Guard rail secure?',
                required: false,
                responseSetId: 'rs1',
                flaggedOptionIds: ['risk'],
              },
              {
                id: 'q2',
                type: 'text',
                prompt: 'Notes',
                required: false,
                multiline: true,
                maxLength: 100,
              },
            ],
          },
        ],
      },
    ],
    settings: {
      titleFormat: '{date}',
      documentNumberFormat: '{counter:6}',
      documentNumberStart: 1,
    },
    customResponseSets: [
      {
        id: 'rs1',
        name: 'Safe / At Risk',
        sourceGlobalId: null,
        multiSelect: false,
        options: [
          { id: 'safe', label: 'Safe', color: 'green' },
          { id: 'risk', label: 'At Risk', color: 'red' },
        ],
      },
    ],
  };
  return {
    inspection: {
      id: 'insp1',
      tenantId: 't1',
      title: 'Daily Checklist',
      documentNumber: 'DC-1',
      status: 'completed',
      conductedBy: null,
      conductedByName: null,
      siteId: null,
      siteName: null,
      responses,
      score: null,
      startedAt: '2026-06-19T00:00:00.000Z',
      submittedAt: null,
      completedAt: '2026-06-19T01:00:00.000Z',
      rejectedAt: null,
      rejectedReason: null,
      createdBy: 'u1',
    },
    template: { id: 'tpl1', name: 'Daily', versionId: 'v1', versionNumber: 1, content },
    signatures: [],
    approvals: [],
    company: {
      name: 'Acme Scaffolding',
      legalName: null,
      addressLine1: '12 Foundry Lane',
      addressLine2: null,
      city: 'Leeds',
      postcode: 'LS1 4DN',
      country: null,
      phone: null,
      email: null,
      website: null,
      companyNumber: '12345678',
      vatNumber: null,
      logoStorageKey: null,
    },
  };
}

describe('PrintLayout — flagged answers in the report', () => {
  it('renders multiple-choice answers as their labels, not raw ULIDs', () => {
    render(<PrintLayout snapshot={snapshot({ q1: 'safe', q2: 'all good' })} />);
    expect(screen.getByText('Safe')).toBeTruthy();
    // The raw option id should never appear as the answer text.
    expect(screen.queryByText('safe')).toBeNull();
  });

  it('shows a "Flagged items" summary at the top when a flagged option is selected', () => {
    render(<PrintLayout snapshot={snapshot({ q1: 'risk' })} />);
    expect(screen.getByText(/Flagged items \(1\)/)).toBeTruthy();
    // The flagged answer carries a FLAGGED badge in the body.
    expect(screen.getByText('FLAGGED')).toBeTruthy();
  });

  it('shows NO flagged summary when only non-flagged options are selected', () => {
    render(<PrintLayout snapshot={snapshot({ q1: 'safe' })} />);
    expect(screen.queryByText(/Flagged items/)).toBeNull();
    expect(screen.queryByText('FLAGGED')).toBeNull();
  });
});

describe('PrintLayout — company letterhead', () => {
  it('prints the company name and details from the snapshot', () => {
    render(<PrintLayout snapshot={snapshot({ q1: 'safe' })} />);
    expect(screen.getByText('Acme Scaffolding')).toBeTruthy();
    expect(screen.getByText(/12 Foundry Lane, Leeds, LS1 4DN/)).toBeTruthy();
    expect(screen.getByText(/Company No\. 12345678/)).toBeTruthy();
  });
});

describe('PrintLayout — tenant branding fallback (ADR 0018)', () => {
  it('renders the tenant logo + primary when the template sets no branding', () => {
    const { container } = render(
      <PrintLayout
        snapshot={snapshot({ q1: 'safe' })}
        tenantBranding={{ logoUrl: 'https://cdn.example.com/logo.png', primaryColor: '#0f766e' }}
      />,
    );
    const img = container.querySelector('.print-cover img');
    expect(img?.getAttribute('src')).toBe('https://cdn.example.com/logo.png');
    const cover = container.querySelector('.print-cover');
    expect((cover as HTMLElement | null)?.style.backgroundColor).not.toBe('');
  });

  it('renders no cover block at all without template or tenant branding', () => {
    const { container } = render(<PrintLayout snapshot={snapshot({ q1: 'safe' })} />);
    expect(container.querySelector('.print-cover')).toBeNull();
  });

  it('prefers the template logo over the tenant fallback', () => {
    const { container } = render(
      <PrintLayout
        snapshot={snapshot({ q1: 'safe' })}
        logoUrl="https://cdn.example.com/template.png"
        tenantBranding={{ logoUrl: 'https://cdn.example.com/tenant.png' }}
      />,
    );
    const img = container.querySelector('.print-cover img');
    expect(img?.getAttribute('src')).toBe('https://cdn.example.com/template.png');
  });
});
