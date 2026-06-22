/**
 * Extract a few still frames from an inbound WhatsApp video so Claude's vision
 * can "watch" it. Claude can't read video directly, so we sample frames with
 * ffmpeg (installed on the deploy image via nixpacks) and hand them to the
 * agent as images — the same path Phase 2 uses for photos.
 *
 * Returns [] on any failure (ffmpeg missing, unreadable container, timeout) so
 * the caller can fall back to the interim reply. Temp files are always cleaned.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AgentImage } from './agent-tools';
import { logger } from './logger';

const execFileAsync = promisify(execFile);
const log = logger.child({ module: 'video-frames' });

/** Cap on sampled frames — keeps the vision payload + cost bounded. */
const MAX_FRAMES = 3;

export async function extractVideoFrames(
  base64: string,
  mimeType: string,
): Promise<AgentImage[]> {
  let dir: string | undefined;
  try {
    const buf = Buffer.from(base64, 'base64');
    dir = await mkdtemp(join(tmpdir(), 'wa-video-'));
    const ext = mimeType.includes('quicktime') ? 'mov' : 'mp4';
    const input = join(dir, `input.${ext}`);
    await writeFile(input, buf);

    // One frame every 2s, capped at MAX_FRAMES, scaled down for a small payload.
    await execFileAsync(
      'ffmpeg',
      [
        '-i',
        input,
        '-vf',
        'fps=1/2,scale=768:-1',
        '-frames:v',
        String(MAX_FRAMES),
        '-q:v',
        '5',
        join(dir, 'frame_%02d.jpg'),
      ],
      { timeout: 20_000 },
    );

    const files = (await readdir(dir)).filter((f) => f.startsWith('frame_')).sort();
    const frames: AgentImage[] = [];
    for (const f of files.slice(0, MAX_FRAMES)) {
      const data = await readFile(join(dir, f));
      frames.push({ base64: data.toString('base64'), mediaType: 'image/jpeg' });
    }
    return frames;
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      'frame extraction failed',
    );
    return [];
  } finally {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
