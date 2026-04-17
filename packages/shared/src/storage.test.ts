import { describe, expect, it } from 'vitest';
import { newId } from './id.js';
import { createR2Client, isObjectKey, objectKey, objectKeySchema } from './storage.js';

const tenantId = newId();
const entityId = newId();

describe('objectKey', () => {
  it('builds a valid key from well-formed parts', () => {
    const key = objectKey({
      tenantId,
      module: 'inspections',
      entityId,
      filename: 'photo.jpg',
    });
    expect(key).toBe(`${tenantId}/inspections/${entityId}/photo.jpg`);
    expect(isObjectKey(key)).toBe(true);
  });

  it('accepts filenames with dots, dashes, and underscores', () => {
    const key = objectKey({
      tenantId,
      module: 'documents',
      entityId,
      filename: 'quarterly_report.v2-final.pdf',
    });
    expect(isObjectKey(key)).toBe(true);
  });

  it('rejects an invalid tenantId', () => {
    expect(() =>
      objectKey({
        tenantId: 'not-a-ulid' as never,
        module: 'inspections',
        entityId,
        filename: 'x.jpg',
      }),
    ).toThrow(/Invalid tenantId/);
  });

  it('rejects an invalid entityId', () => {
    expect(() =>
      objectKey({
        tenantId,
        module: 'inspections',
        entityId: 'bad' as never,
        filename: 'x.jpg',
      }),
    ).toThrow(/Invalid entityId/);
  });

  it('rejects modules that are not lowercase kebab-case', () => {
    expect(() =>
      objectKey({ tenantId, module: 'Inspections', entityId, filename: 'x.jpg' }),
    ).toThrow(/Invalid module/);
    expect(() =>
      objectKey({ tenantId, module: 'inspect ions', entityId, filename: 'x.jpg' }),
    ).toThrow(/Invalid module/);
  });

  it('rejects filenames with whitespace or path separators', () => {
    expect(() =>
      objectKey({ tenantId, module: 'inspections', entityId, filename: 'hello world.jpg' }),
    ).toThrow(/Invalid filename/);
    expect(() =>
      objectKey({ tenantId, module: 'inspections', entityId, filename: '../etc/passwd' }),
    ).toThrow(/Invalid filename/);
  });
});

describe('objectKeySchema (Zod)', () => {
  it('accepts a valid key', () => {
    const key = `${tenantId}/inspections/${entityId}/photo.jpg`;
    expect(objectKeySchema.parse(key)).toBe(key);
  });

  it('rejects keys with the wrong number of segments', () => {
    expect(() => objectKeySchema.parse(`${tenantId}/inspections/${entityId}`)).toThrow();
    expect(() =>
      objectKeySchema.parse(`${tenantId}/inspections/${entityId}/sub/dir/photo.jpg`),
    ).toThrow();
  });

  it('rejects keys that try to escape the tenant scope', () => {
    expect(() =>
      objectKeySchema.parse(`../${entityId}/inspections/${entityId}/photo.jpg`),
    ).toThrow();
  });
});

describe('createR2Client', () => {
  it('builds a client pointed at the Cloudflare R2 endpoint', async () => {
    const client = createR2Client({
      accountId: 'testacct',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucket: 'forma360-test',
    });

    const endpoint = await client.config.endpoint?.();
    expect(endpoint?.hostname).toBe('testacct.r2.cloudflarestorage.com');

    const region = await client.config.region();
    expect(region).toBe('auto');
  });

  it('uses path-style addressing (R2 does not support virtual-hosted style)', async () => {
    const client = createR2Client({
      accountId: 'a',
      accessKeyId: 'k',
      secretAccessKey: 's',
      bucket: 'b',
    });
    // `forcePathStyle` lives on the internal resolved config. Use the public
    // getter if available, else fall back to the raw config object.
    const resolved = client.config as { forcePathStyle?: boolean };
    expect(resolved.forcePathStyle).toBe(true);
  });
});
