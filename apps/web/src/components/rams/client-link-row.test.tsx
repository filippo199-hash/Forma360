/**
 * NR3-07: after a re-issue, a live client link pinned to the superseded
 * version must say so on the pack page — before this, the v1 row looked
 * identical to a current one and the issuer assumed the client saw v2.
 *
 * Messages are provided inline so the test pins the component contract,
 * not the (centrally merged) locale bundles.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { ClientLinkRow, isStaleClientLink, type ClientLinkRowLink } from './client-link-row';

afterEach(cleanup);

const messages = {
  rams: {
    versionLabel: 'v{version}',
    client: {
      unnamed: 'Unnamed recipient',
      revoked: 'revoked',
      showLink: 'Show link',
      revokeLink: 'Revoke',
      staleLink: 'points at superseded v{version} — current is v{current}',
    },
    clientDecision: {
      pending: 'Awaiting decision',
      accepted: 'Accepted',
      changes_requested: 'Changes requested',
    },
  },
};

function link(overrides: Partial<ClientLinkRowLink> = {}): ClientLinkRowLink {
  return {
    id: 'link-1',
    versionNumber: 1,
    issuedToName: 'Dana Client',
    decision: 'pending',
    decidedAt: null,
    revokedAt: null,
    decisionComment: '',
    ...overrides,
  };
}

function renderRow(l: ClientLinkRowLink, currentVersion: number) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ul>
        <ClientLinkRow
          link={l}
          currentVersion={currentVersion}
          revokePending={false}
          onShowLink={() => undefined}
          onRevoke={() => undefined}
        />
      </ul>
    </NextIntlClientProvider>,
  );
}

describe('ClientLinkRow (NR3-07)', () => {
  it('marks a live link pinned to a superseded version as stale', () => {
    renderRow(link({ versionNumber: 1 }), 2);
    expect(screen.getByText('points at superseded v1 — current is v2')).toBeTruthy();
  });

  it('shows no stale marker when the link points at the current version', () => {
    renderRow(link({ versionNumber: 2 }), 2);
    expect(screen.queryByText(/points at superseded/)).toBeNull();
  });

  it('shows no stale marker (and no actions) on a revoked link', () => {
    renderRow(link({ versionNumber: 1, revokedAt: new Date('2026-08-01T10:00:00Z') }), 2);
    expect(screen.queryByText(/points at superseded/)).toBeNull();
    expect(screen.queryByText('Show link')).toBeNull();
  });

  it('exposes the staleness predicate the pack page prompts from', () => {
    expect(isStaleClientLink({ revokedAt: null, versionNumber: 1 }, 2)).toBe(true);
    expect(isStaleClientLink({ revokedAt: null, versionNumber: 2 }, 2)).toBe(false);
    expect(isStaleClientLink({ revokedAt: new Date(), versionNumber: 1 }, 2)).toBe(false);
  });
});
