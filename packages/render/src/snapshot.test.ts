/**
 * Content-hash stability tests for {@link hashInspectionSnapshot}.
 */
import { describe, expect, it } from 'vitest';
import {
  hashDashboardSnapshot,
  hashInspectionSnapshot,
  type DashboardRenderSnapshot,
  type InspectionRenderSnapshot,
} from './snapshot';

function baseSnap(): InspectionRenderSnapshot {
  return {
    inspection: {
      id: 'I1',
      tenantId: 'T1',
      title: 'Hello',
      documentNumber: 'A000001',
      status: 'completed',
      conductedBy: 'u1',
      conductedByName: null,
      siteId: null,
      siteName: null,
      responses: { q1: 'ok' },
      score: null,
      startedAt: '2026-04-18T00:00:00.000Z',
      submittedAt: '2026-04-18T00:05:00.000Z',
      completedAt: '2026-04-18T00:10:00.000Z',
      rejectedAt: null,
      rejectedReason: null,
      createdBy: 'u1',
    },
    template: {
      id: 'TPL1',
      name: 'Template',
      versionId: 'V1',
      versionNumber: 1,
      content: { schemaVersion: '1', title: 'Template', pages: [], settings: {} },
    },
    signatures: [],
    approvals: [],
  };
}

describe('hashInspectionSnapshot', () => {
  it('produces the same hash for the same content', () => {
    expect(hashInspectionSnapshot(baseSnap())).toBe(hashInspectionSnapshot(baseSnap()));
  });

  it('differs when responses change', () => {
    const a = baseSnap();
    const b = baseSnap();
    b.inspection.responses = { q1: 'different' };
    expect(hashInspectionSnapshot(a)).not.toBe(hashInspectionSnapshot(b));
  });

  it('differs when a signature is added', () => {
    const a = baseSnap();
    const b = baseSnap();
    b.signatures.push({
      id: 'S1',
      slotIndex: 0,
      slotId: 'SLT1',
      signerUserId: 'u2',
      signerName: 'Bob',
      signerRole: null,
      signatureData: 'data:image/svg+xml,<svg/>',
      signedAt: '2026-04-18T00:06:00.000Z',
    });
    expect(hashInspectionSnapshot(a)).not.toBe(hashInspectionSnapshot(b));
  });

  it('differs when template version changes', () => {
    const a = baseSnap();
    const b = baseSnap();
    b.template.versionId = 'V2';
    expect(hashInspectionSnapshot(a)).not.toBe(hashInspectionSnapshot(b));
  });

  it('ignores template.name (which is mutable and not a render input)', () => {
    const a = baseSnap();
    const b = baseSnap();
    b.template.name = 'Renamed template';
    expect(hashInspectionSnapshot(a)).toBe(hashInspectionSnapshot(b));
  });

  it('produces a 64-char lowercase hex digest', () => {
    expect(hashInspectionSnapshot(baseSnap())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashDashboardSnapshot', () => {
  function baseDashSnap(): DashboardRenderSnapshot {
    return {
      dashboard: {
        id: 'D1',
        tenantId: 'T1',
        title: 'Weekly overview',
        description: 'The Monday pack',
        status: 'published',
        spec: { version: '1', widgets: [{ id: 'w1' }] },
        updatedAt: '2026-08-01T09:00:00.000Z',
      },
      tenantName: 'Acme',
    };
  }

  it('produces the same hash for the same content', () => {
    expect(hashDashboardSnapshot(baseDashSnap())).toBe(hashDashboardSnapshot(baseDashSnap()));
  });

  it('differs when the spec, title or updatedAt changes', () => {
    const a = baseDashSnap();
    const spec = baseDashSnap();
    spec.dashboard.spec = { version: '1', widgets: [{ id: 'w2' }] };
    const title = baseDashSnap();
    title.dashboard.title = 'Renamed';
    const updated = baseDashSnap();
    updated.dashboard.updatedAt = '2026-08-02T09:00:00.000Z';
    expect(hashDashboardSnapshot(spec)).not.toBe(hashDashboardSnapshot(a));
    expect(hashDashboardSnapshot(title)).not.toBe(hashDashboardSnapshot(a));
    expect(hashDashboardSnapshot(updated)).not.toBe(hashDashboardSnapshot(a));
  });

  it('ignores description, status and tenantName (not render-cache inputs)', () => {
    const a = baseDashSnap();
    const b = baseDashSnap();
    b.dashboard.description = null;
    b.dashboard.status = 'draft';
    b.tenantName = 'Other Co';
    expect(hashDashboardSnapshot(a)).toBe(hashDashboardSnapshot(b));
  });
});
