/**
 * tRPC v11 initialisation.
 *
 * Every procedure in the app is built on the `t` helper exported here.
 * superjson is the transformer so we can pass Dates, Maps, ULID brands, etc.
 * across the wire without manual serialisation.
 *
 * Ground rule: every procedure has an input Zod schema. The `zodFlattener`
 * in `errorFormatter` surfaces Zod validation issues as structured JSON in
 * responses so the client can display per-field errors without re-parsing
 * a generic message.
 */
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import type { Context } from './context';

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodIssues: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/** Build routers. */
export const router = t.router;
/** Merge routers. Used by the root router to combine namespaces. */
export const mergeRouters = t.mergeRouters;
/** Create-caller factory for server-side invocation (used by tests + RSC). */
export const createCallerFactory = t.createCallerFactory;
/** Low-level procedure builder. Prefer the helpers in ./procedures.ts. */
export const procedure = t.procedure;
/** Middleware builder. */
export const middleware = t.middleware;

export { TRPCError };
