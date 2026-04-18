import { beforeEach, describe, expect, it } from 'vitest';
import {
  getDependents,
  registerDependentResolver,
  resetDependentsRegistryForTests,
} from './dependents';

beforeEach(() => {
  resetDependentsRegistryForTests();
});

describe('dependents registry', () => {
  it('returns empty counts for every known module when nothing is registered', async () => {
    const counts = await getDependents({ db: {} as never } as never, {
      entity: 'group',
      id: 'g-1',
      tenantId: 't-1',
    });
    // Every known module key present, every value 0.
    expect(counts.accessRules).toBe(0);
    expect(counts.templates).toBe(0);
    expect(counts.inspections).toBe(0);
    expect(counts.issues).toBe(0);
  });

  it('registered resolver contributes to the result', async () => {
    registerDependentResolver('templates', async () => 42);
    const counts = await getDependents({ db: {} as never } as never, {
      entity: 'group',
      id: 'g-1',
      tenantId: 't-1',
    });
    expect(counts.templates).toBe(42);
    expect(counts.inspections).toBe(0);
  });

  it('multiple resolvers across modules run in parallel and their counts merge', async () => {
    registerDependentResolver('templates', async () => 3);
    registerDependentResolver('inspections', async () => 5);
    registerDependentResolver('accessRules', async () => 7);

    const counts = await getDependents({ db: {} as never } as never, {
      entity: 'group',
      id: 'g-1',
      tenantId: 't-1',
    });
    expect(counts.templates).toBe(3);
    expect(counts.inspections).toBe(5);
    expect(counts.accessRules).toBe(7);
  });

  it('passes entity / id / tenantId through to resolvers', async () => {
    let seen: { entity: string; id: string; tenantId: string } | null = null;
    registerDependentResolver('templates', async (_deps, input) => {
      seen = { entity: input.entity, id: input.id, tenantId: input.tenantId };
      return 1;
    });

    await getDependents({ db: {} as never } as never, {
      entity: 'site',
      id: 's-42',
      tenantId: 't-99',
    });
    expect(seen).toEqual({ entity: 'site', id: 's-42', tenantId: 't-99' });
  });

  it('a throwing resolver does not break the aggregate — it counts as 0 and logs', async () => {
    registerDependentResolver('templates', async () => {
      throw new Error('boom');
    });
    registerDependentResolver('inspections', async () => 3);

    const counts = await getDependents({ db: {} as never } as never, {
      entity: 'group',
      id: 'g-1',
      tenantId: 't-1',
    });
    expect(counts.templates).toBe(0);
    expect(counts.inspections).toBe(3);
  });

  it('hasDependents returns true iff any count is > 0', async () => {
    const { hasDependents } = await import('./dependents');
    registerDependentResolver('templates', async () => 0);
    expect(
      hasDependents(
        await getDependents({ db: {} as never } as never, {
          entity: 'group',
          id: 'g',
          tenantId: 't',
        }),
      ),
    ).toBe(false);

    registerDependentResolver('templates', async () => 1);
    expect(
      hasDependents(
        await getDependents({ db: {} as never } as never, {
          entity: 'group',
          id: 'g',
          tenantId: 't',
        }),
      ),
    ).toBe(true);
  });

  it('re-registering a module replaces its resolver (last write wins)', async () => {
    registerDependentResolver('templates', async () => 1);
    registerDependentResolver('templates', async () => 99);

    const counts = await getDependents({ db: {} as never } as never, {
      entity: 'group',
      id: 'g',
      tenantId: 't',
    });
    expect(counts.templates).toBe(99);
  });
});
