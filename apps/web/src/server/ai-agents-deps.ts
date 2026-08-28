/**
 * Production deps for the aiAgents router: best-effort blob cleanup when
 * an admin deletes a knowledge document. Dev has no R2 — deletes there
 * only remove the row, which is the failure mode the router already
 * tolerates (the catch swallows).
 */
import type { AiAgentsRouterDeps } from '@forma360/api';
import { env } from './env';
import { storage } from './storage';

export const aiAgentsDeps: AiAgentsRouterDeps = {
  deleteObject:
    env.NODE_ENV === 'production' ? async (key) => storage.deleteObject({ key }) : null,
};
