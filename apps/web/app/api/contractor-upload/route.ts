/**
 * Public contractor upload endpoint (no login).
 *
 * A contractor opens their upload link (opaque token) and submits a document
 * for one of their requirements. The token resolves the contractor + tenant;
 * the file is stored and a `contractor_documents` row is created as `pending`
 * for the company to verify. No session — the token is the capability.
 *
 * CT-U01: the period of cover is mandatory — either an expiry date or an
 * explicit "this document never expires". A null expiry means "valid
 * forever" to the compliance derivation and therefore to the gate, so it
 * must never be reachable by simply omitting a field.
 */
import { contractorDocuments, contractorRequirements, contractors } from '@forma360/db/schema';
import { todayIso, validateDocumentPeriod } from '@forma360/shared/contractors';
import { newId } from '@forma360/shared/id';
import { objectKey } from '@forma360/shared/storage';
import { PHONE_IMAGE_MIME, resolveUploadMime } from '@forma360/shared/upload-media';
import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { db } from '../../../src/server/db';
import { env } from '../../../src/server/env';
import { logger } from '../../../src/server/logger';
import { storageThrew } from '../../../src/server/upload-failure';
import { normalisePhoneMedia } from '../../../src/server/phone-media';
import { storage } from '../../../src/server/storage';

const MAX_BYTES = 50 * 1024 * 1024;
// A contractor photographs their certificate with a phone as often as
// they scan it — accept the capture stills (HEIC/HEIF/AVIF) too.
const ACCEPTED_MIME = new Set<string>(['application/pdf', ...PHONE_IMAGE_MIME]);
const FILENAME_SAFE = /[^A-Za-z0-9._-]/g;

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
  const noExpiry = String(form.get('noExpiry') ?? '') === 'true';
  const file = form.get('file');

  if (token.length < 10 || requirementId.length !== 26 || !(file instanceof File)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }
  if (file.size <= 0) return NextResponse.json({ error: 'EMPTY_FILE' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 400 });
  // Some Android browsers report "" or octet-stream for camera files.
  const resolvedMime = resolveUploadMime(file.name, file.type);
  if (resolvedMime === null || !ACCEPTED_MIME.has(resolvedMime)) {
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
    .select({
      id: contractorRequirements.id,
      recurrenceMonths: contractorRequirements.recurrenceMonths,
    })
    .from(contractorRequirements)
    .where(
      and(
        eq(contractorRequirements.tenantId, contractor.tenantId),
        eq(contractorRequirements.id, requirementId),
        eq(contractorRequirements.contractorId, contractor.id),
      ),
    )
    .limit(1);
  const requirement = rRows[0];
  if (requirement === undefined) {
    return NextResponse.json({ error: 'REQUIREMENT_NOT_FOUND' }, { status: 404 });
  }

  // CT-U01: a client that sends neither a date nor the assertion fails
  // closed. This is the enforcement point — the portal form mirrors it for
  // the message, but the token is a public capability and `curl` reaches
  // here directly.
  const period = validateDocumentPeriod({
    startDate,
    endDate,
    noExpiry,
    recurrenceMonths: requirement.recurrenceMonths,
    today: todayIso(),
    rejectExpired: true,
  });
  if (!period.ok) {
    return NextResponse.json({ error: period.error }, { status: 400 });
  }

  // HEIC/HEIF → JPEG so the verification screen can preview the photo.
  const media = await normalisePhoneMedia(
    {
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: resolvedMime,
      filename: sanitizeFilename(file.name),
    },
    logger,
  );
  const key = objectKey({
    tenantId: contractor.tenantId as never,
    module: 'contractor-docs',
    entityId: contractor.id as never,
    filename: media.filename,
  });
  const bytes = media.bytes;

  if (env.NODE_ENV === 'production') {
    try {
      await storage.putObject({ key, contentType: media.mimeType, bytes });
    } catch (err) {
      return storageThrew(logger, 'contractor-upload', key, err);
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
    filename: media.converted ? media.filename : file.name,
    mimeType: media.mimeType,
    sizeBytes: bytes.length,
    startDate: startDate === '' ? null : startDate,
    endDate: endDate === '' ? null : endDate,
    status: 'pending',
  });

  return NextResponse.json({ ok: true });
}
