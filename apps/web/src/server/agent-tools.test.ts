import { describe, expect, it } from 'vitest';
import {
  CALLER_TOOL_NAMES,
  TOOLS,
  type ToolName,
  toToolError,
  WRITE_INSTRUCTIONS,
  WRITE_TOOL_NAMES,
} from './agent-tools';

describe('toToolError', () => {
  it('maps a FORBIDDEN tRPC error to permission_denied', () => {
    expect(toToolError({ code: 'FORBIDDEN', message: 'Missing permission: actions.create' })).toEqual(
      { error: 'permission_denied', message: 'Missing permission: actions.create' },
    );
  });

  it('maps NOT_FOUND and BAD_REQUEST', () => {
    expect(toToolError({ code: 'NOT_FOUND', message: 'x' }).error).toBe('not_found');
    expect(toToolError({ code: 'BAD_REQUEST', message: 'x' }).error).toBe('invalid_input');
  });

  it('falls back to "failed" for unknown codes and plain errors', () => {
    expect(toToolError({ code: 'INTERNAL_SERVER_ERROR', message: 'boom' }).error).toBe('failed');
    const err = new Error('kaboom');
    expect(toToolError(err)).toEqual({ error: 'failed', message: 'kaboom' });
  });

  it('stringifies non-Error throwables', () => {
    expect(toToolError('plain string').message).toBe('plain string');
  });
});

describe('TOOLS definitions', () => {
  const byName = new Map(TOOLS.map((t) => [t.name, t]));

  it('exposes every read + write tool', () => {
    const expected: ToolName[] = [
      'list_inspections',
      'list_issues',
      'list_actions',
      'list_assets',
      'list_headsup',
      'list_documents',
      'list_schedules',
      'list_observation_categories',
      'list_users',
      'create_observation',
      'create_action',
      'comment_on_action',
      'comment_on_observation',
      'record_asset_reading',
      'create_headsup',
    ];
    for (const name of expected) expect(byName.has(name), `missing tool ${name}`).toBe(true);
    expect(TOOLS).toHaveLength(expected.length);
  });

  it('declares the required fields each write tool needs', () => {
    const required = (name: string): readonly string[] =>
      ((byName.get(name)?.input_schema.required as string[] | undefined) ?? []).slice().sort();
    expect(required('create_observation')).toEqual(['categoryId', 'title']);
    expect(required('create_action')).toEqual(['title']);
    expect(required('comment_on_action')).toEqual(['actionId', 'body']);
    expect(required('comment_on_observation')).toEqual(['body', 'observationId']);
    expect(required('record_asset_reading')).toEqual(['assetId', 'fieldName', 'value']);
    expect(required('create_headsup')).toEqual(['description', 'title']);
  });
});

describe('tool routing sets', () => {
  it('routes every write tool through the caller', () => {
    for (const name of WRITE_TOOL_NAMES) {
      expect(CALLER_TOOL_NAMES.has(name), `${name} must use the caller`).toBe(true);
    }
  });

  it('keeps the plain db reads off the caller path', () => {
    const dbReads: ToolName[] = ['list_inspections', 'list_actions', 'list_assets'];
    for (const name of dbReads) expect(CALLER_TOOL_NAMES.has(name)).toBe(false);
  });

  it('routes the two permission-gated reads through the caller', () => {
    expect(CALLER_TOOL_NAMES.has('list_observation_categories')).toBe(true);
    expect(CALLER_TOOL_NAMES.has('list_users')).toBe(true);
  });
});

describe('WRITE_INSTRUCTIONS', () => {
  it('states the confirm-before-write contract', () => {
    expect(WRITE_INSTRUCTIONS).toMatch(/confirm with the user BEFORE/i);
    expect(WRITE_INSTRUCTIONS).toMatch(/DRAFT/);
  });
});
