/**
 * AC-G01 — the status dropdown's assignee whitelist must equal the server's.
 *
 * `actions.updateStatus` lets a non-manager assignee move their own action
 * only between a fixed set of statuses; the dropdown mirrors that set so it
 * never offers a transition the server will refuse. `packages/api` and
 * `apps/web` cannot share the constant (workspace direction), so this test
 * scrapes the router source — the enqueue-names pattern: if either side
 * changes its list, the suite fails before a user sees a doomed option.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTION_STATUSES } from './action-status-dropdown';

const ROUTER_PATH = join(__dirname, '../../../../../packages/api/src/routers/actions.ts');

function scrapeServerAssigneeStatuses(): string[] {
  const source = readFileSync(ROUTER_PATH, 'utf8');
  const match = source.match(/assigneeStatuses:\s*ReadonlyArray<string>\s*=\s*\[([^\]]+)\]/);
  if (match?.[1] === undefined) {
    throw new Error(
      'Could not find the assigneeStatuses whitelist in packages/api/src/routers/actions.ts — update this scraper alongside the router.',
    );
  }
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
}

// The client constant is module-private on purpose (nothing else should
// import it) — scrape it the same way the server side is scraped.
function scrapeClientAssigneeStatuses(): string[] {
  const source = readFileSync(join(__dirname, 'action-status-dropdown.tsx'), 'utf8');
  const match = source.match(/ASSIGNEE_STATUSES:\s*ReadonlyArray<ActionStatus>\s*=\s*\[([^\]]+)\]/);
  if (match?.[1] === undefined) {
    throw new Error('Could not find ASSIGNEE_STATUSES in action-status-dropdown.tsx.');
  }
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
}

describe('action status dropdown ↔ server parity (AC-G01)', () => {
  it('offers assignees exactly the statuses the server accepts from them', () => {
    expect(scrapeClientAssigneeStatuses()).toEqual(scrapeServerAssigneeStatuses());
  });

  it('only offers statuses that exist on the server enum', () => {
    const source = readFileSync(ROUTER_PATH, 'utf8');
    for (const status of ACTION_STATUSES) {
      expect(source.includes(`'${status}'`), `status '${status}' unknown to the router`).toBe(true);
    }
  });
});
