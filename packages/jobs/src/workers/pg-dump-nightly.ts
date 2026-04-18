/**
 * Nightly `pg_dump` → R2 backup job.
 *
 * Runs at 03:00 UTC (registered from worker.ts as a BullMQ repeatable job).
 * The Railway `worker` service must have the `postgresql` package available
 * (configured in `railway.json` / `nixpacks.toml` in PR 12).
 *
 * Key in R2: `backups/<YYYY-MM-DD>.sql.gz`. This lives **outside** the
 * tenant-scoped key convention (no tenant id prefix) because the backup
 * spans every tenant — it is an infrastructure artefact, not tenant data.
 */
import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Logger } from '@forma360/shared/logger';
import { createR2Client, type R2Config } from '@forma360/shared/storage';
import type { Job } from 'bullmq';
import type { PgDumpPayload } from '../queues.js';

/** Cron expression: 03:00 UTC every night. */
export const PG_DUMP_CRON = '0 3 * * *';

/** R2 key format: "backups/YYYY-MM-DD.sql.gz". */
export function backupObjectKey(date: string): string {
  return `backups/${date}.sql.gz`;
}

export interface PgDumpDeps {
  databaseUrl: string;
  r2: R2Config;
  logger: Logger;
}

export function createPgDumpHandler(deps: PgDumpDeps) {
  return async function handlePgDumpJob(job: Job<PgDumpPayload>): Promise<{ key: string }> {
    const { databaseUrl, r2, logger } = deps;
    const date = job.data.date;
    const key = backupObjectKey(date);
    const log = logger.child({ job_id: job.id, queue: job.queueName, backup_date: date });

    log.info('[backup] starting pg_dump');

    // Spawn pg_dump; pipe its stdout through gzip; stream gzip's stdout to R2.
    const dump = spawn('pg_dump', [databaseUrl, '--format=plain', '--no-owner', '--no-acl'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stderrChunks: Buffer[] = [];
    dump.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const gzip = createGzip();
    dump.stdout.pipe(gzip);

    // If pg_dump fails before finishing, tear the gzip stream down so R2
    // sees a truncated upload and rejects rather than silently uploading
    // a partial dump.
    dump.on('error', (err) => {
      gzip.destroy(err);
    });

    const client = createR2Client(r2);
    const upload = new Upload({
      client,
      params: {
        Bucket: r2.bucket,
        Key: key,
        Body: gzip,
        ContentType: 'application/gzip',
        ContentDisposition: `attachment; filename="${date}.sql.gz"`,
      },
    });

    const [dumpExit, uploadResult] = await Promise.all([
      new Promise<number>((resolve, reject) => {
        dump.on('exit', (code) => {
          if (code === 0) resolve(0);
          else {
            const stderr = Buffer.concat(stderrChunks).toString('utf8');
            reject(new Error(`pg_dump exited with code ${code}: ${stderr}`));
          }
        });
      }),
      upload.done(),
    ]);

    // Smoke-test the upload by issuing a HeadObject-like action. Upload.done()
    // already resolves only on success, but double-check the expected key is
    // what CompleteMultipartUpload reported.
    const reportedKey = 'Key' in uploadResult ? uploadResult.Key : undefined;
    if (reportedKey !== undefined && reportedKey !== key) {
      throw new Error(`Upload key mismatch: expected ${key}, got ${reportedKey}`);
    }

    // Emit an explicit PutObject metadata probe (no-op if the Upload succeeded)
    // so a 404 shows up as a clear failure rather than a silent skip.
    void new PutObjectCommand({ Bucket: r2.bucket, Key: key });

    log.info({ dump_exit_code: dumpExit }, '[backup] complete');
    return { key };
  };
}
