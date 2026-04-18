'use client';

import type { AppRouter } from '@forma360/api';
import { createTRPCReact } from '@trpc/react-query';

/**
 * Shared tRPC React hook root. All React components use this rather than
 * building their own client — it keeps the AppRouter type lock-step with
 * the server.
 */
export const trpc = createTRPCReact<AppRouter>();
