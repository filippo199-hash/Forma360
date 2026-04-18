import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseCsv, toCsv } from './csv';

const userRowSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.string().optional(),
});

describe('parseCsv', () => {
  it('parses valid rows and reports empty rejections', () => {
    const csv = `email,name,role
alice@acme.test,Alice,Auditor
bob@acme.test,Bob,Operator`;
    const result = parseCsv(csv, { schema: userRowSchema });
    expect(result.ok).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(result.ok[0]?.row).toEqual({ email: 'alice@acme.test', name: 'Alice', role: 'Auditor' });
    expect(result.ok[0]?.line).toBe(2);
  });

  it('collects per-row errors with line numbers (G-E05)', () => {
    const csv = `email,name,role
alice@acme.test,Alice,Auditor
not-an-email,Bob,Operator
charlie@acme.test,,Manager`;
    const result = parseCsv(csv, { schema: userRowSchema });
    expect(result.ok).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]?.line).toBe(3);
    expect(result.errors[0]?.message).toMatch(/email/i);
    expect(result.errors[1]?.line).toBe(4);
    expect(result.errors[1]?.message).toMatch(/name/i);
  });

  it('treats empty cells as undefined so optional fields parse', () => {
    const csv = `email,name,role
alice@acme.test,Alice,`;
    const result = parseCsv(csv, { schema: userRowSchema });
    expect(result.ok).toHaveLength(1);
    expect(result.ok[0]?.row.role).toBeUndefined();
  });

  it('skips blank lines without counting them as errors', () => {
    const csv = `email,name,role
alice@acme.test,Alice,Auditor

bob@acme.test,Bob,`;
    const result = parseCsv(csv, { schema: userRowSchema });
    expect(result.ok).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('honours limit and rejects overflow rows', () => {
    const csv = `email,name
a@a.test,A
b@b.test,B
c@c.test,C`;
    const result = parseCsv(csv, { schema: userRowSchema, limit: 2 });
    expect(result.ok).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/limit/i);
  });

  it('rejectedCsv() produces a downloadable CSV with line + error + raw cells', () => {
    const csv = `email,name
bad,Bob`;
    const result = parseCsv(csv, { schema: userRowSchema });
    const rejected = result.rejectedCsv();
    expect(rejected).toMatch(/^line,error,email,name/);
    expect(rejected).toMatch(/bad/);
    expect(rejected).toMatch(/Bob/);
  });

  it('rejectedCsv() returns empty string when there are no errors', () => {
    const csv = `email,name
alice@acme.test,Alice`;
    const result = parseCsv(csv, { schema: userRowSchema });
    expect(result.rejectedCsv()).toBe('');
  });
});

describe('toCsv', () => {
  it('preserves column order', () => {
    const out = toCsv(
      [
        { a: 1, b: 2 },
        { a: 3, b: 4 },
      ],
      ['a', 'b'],
    );
    expect(out).toMatch(/^a,b\n1,2\n3,4/);
  });

  it('respects explicit column order when fewer columns are requested', () => {
    const out = toCsv([{ a: 1, b: 2, c: 3 }], ['c', 'a']);
    expect(out).toMatch(/^c,a\n3,1/);
  });

  it('serialises nullable cells as empty', () => {
    const out = toCsv([{ a: null, b: 'x' }], ['a', 'b']);
    expect(out).toMatch(/^a,b\n,x/);
  });
});
