/**
 * Public contractor upload endpoint (no login).
 *
 * A contractor opens their upload link (opaque token) and submits a document
 * for one of their requirements. The token resolves the contractor + tenant;
 * the file is stored and a `contractor_documents` row is created as `pending`
 * for the company to verify. No session — the token is the capability.
 */
import { contractorDocuments, contractorRequirements, contractors } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { objectKey } from '@forma360/shared/storage';
import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { db } from '../../../src/server/db';
import { env } from '../../../src/server/env';
import { storage } from '../../../src/server/storage';

const MAX_BYTES = 50 * 1024 * 1024;
const ACCEPTED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const FILENAME_SAFE = /[^A-Za-z0-9._-]/g;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeFilename(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, '_').replace(FILENAME_SAFE, '_');
  return `${Date.now().toString(36)}_${cleaned || 'document'}`.slice(0, 200);
}

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const token = String(form.get('token') ?? '');
  const requirementId = String(form.get('requirementId') ?? '');
  const startDate = String(form.get('startDate') ?? '');
  const endDate = String(form.get('endDate') ?? '');
  const file = form.get('file');

  if (token.length < 10 || requirementId.length !== 26 || !(file instanceof File)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }
  if (file.size <= 0) return NextResponse.json({ error: 'EMPTY_FILE' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 400 });
  if (!ACCEPTED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  }

  // Resolve contractor by token, then verify the requirement belongs to it.
  const cRows = await db
    .select({ id: contractors.id, tenantId: contractors.tenantId })
    .from(contractors)
    .where(and(eq(contractors.uploadToken, token), isNull(contractors.archivedAt)))
    .limit(1);
  const contractor = cRows[0];
  if (contractor === undefined) {
    return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 404 });
  }
  const rRows = await db
    .select({ id: contractorRequirements.id })
    .from(contractorRequirements)
    .where(
      and(
        eq(contractorRequirements.id, requirementId),
        eq(contractorRequirements.contractorId, contractor.id),
      ),
    )
    .limit(1);
  if (rRows[0] === undefined) {
    return NextResponse.json({ error: 'REQUIREMENT_NOT_FOUND' }, { status: 404 });
  }

  const key = objectKey({
    tenantId: contractor.tenantId as never,
    module: 'contractor-docs',
    entityId: contractor.id as never,
    filename: sanitizeFilename(file.name),
  });
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (env.NODE_ENV === 'production') {
    try {
      const uploadUrl = await storage.getSignedUploadUrl({
        key,
        contentType: file.type || 'application/octet-stream',
      });
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: bytes,
        headers: { 'content-type': file.type || 'application/octet-stream' },
      });
      if (!res.ok) return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    } catch {
      return NextResponse.json({ error: 'STORAGE_FAILED' }, { status: 500 });
    }
  } else {
    const target = join(process.cwd(), '.local-storage', key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  await db.insert(contractorDocuments).values({
    id: newId(),
    tenantId: contractor.tenantId,
    contractorId: contractor.id,
    requirementId,
    storageKey: key,
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    startDate: DATE_RE.test(startDate) ? startDate : null,
    endDate: DATE_RE.test(endDate) ? endDate : null,
    status: 'pending',
  });

  return NextResponse.json({ ok: true });
}
