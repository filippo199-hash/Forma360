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
      siteId: null,
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
