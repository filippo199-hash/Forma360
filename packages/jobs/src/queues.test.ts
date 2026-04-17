import { describe, expect, it } from 'vitest';
import {
  pgDumpPayloadSchema,
  QUEUE_NAMES,
  QUEUE_PAYLOAD_SCHEMAS,
  testPayloadSchema,
} from './queues';
import { backupObjectKey, PG_DUMP_CRON } from './workers/pg-dump-nightly';

describe('queue registry', () => {
  it('exposes the two Phase 0 queues', () => {
    expect(QUEUE_NAMES.TEST).toBe('forma360:test');
    expect(QUEUE_NAMES.BACKUPS).toBe('forma360:backups');
  });

  it('has a payload schema for every queue name', () => {
    for (const name of Object.values(QUEUE_NAMES)) {
      expect(QUEUE_PAYLOAD_SCHEMAS[name]).toBeDefined();
    }
  });

  it('test payload schema rejects an empty message', () => {
    expect(() => testPayloadSchema.parse({ message: '' })).toThrow();
  });

  it('pg-dump payload schema rejects a non-ISO date', () => {
    expect(() => pgDumpPayloadSchema.parse({ date: '18/04/2026' })).toThrow();
    expect(() => pgDumpPayloadSchema.parse({ date: '2026-4-18' })).toThrow();
  });

  it('pg-dump payload schema accepts YYYY-MM-DD', () => {
    expect(pgDumpPayloadSchema.parse({ date: '2026-04-18' })).toEqual({ date: '2026-04-18' });
  });
});

describe('pg-dump-nightly constants', () => {
  it('runs at 03:00 every night', () => {
    expect(PG_DUMP_CRON).toBe('0 3 * * *');
  });

  it('builds a tenant-agnostic backups/ key', () => {
    expect(backupObjectKey('2026-04-18')).toBe('backups/2026-04-18.sql.gz');
  });
});
