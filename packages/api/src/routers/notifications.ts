/**
 * Notification centre router (platform HSE review PF-23).
 *
 * The bell in the header polls `unreadCount`; the dropdown pages through
 * `list`. Rows are strictly the caller's own — there is no cross-user read
 * surface. Prefs live on the user row (`notificationPrefs` jsonb) — a map
 * of `{ [key]: boolean }` where a missing key means enabled; the digest
 * workers consult them before emailing (in-app rows are always written, so
 * turning email off never hides information).
 */
import { notifications, user } from '@forma360/db/schema';
import { and, count, desc, eq, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { tenantProcedure } from '../procedures';
import { router } from '../trpc';

/** The known pref keys — the settings UI renders exactly these toggles. */
export const NOTIFICATION_PREF_KEYS = [
  'emailActionReminders',
  'emailScheduleMissed',
  'emailDocumentExpiry',
  'emailMaintenance',
] as const;
export type NotificationPrefKey = (typeof NOTIFICATION_PREF_KEYS)[number];

export const notificationsRouter = router({
  list: tenantProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(20),
          /** Keyset cursor: createdAt ISO of the last row seen. */
          before: z.string().datetime().optional(),
          unreadOnly: z.boolean().default(false),
        })
        .default({ limit: 20, unreadOnly: false }),
    )
    .query(async ({ ctx, input }) => {
      const where = [
        eq(notifications.tenantId, ctx.tenantId),
        eq(notifications.userId, ctx.auth.userId),
      ];
      if (input.unreadOnly) where.push(isNull(notifications.readAt));
      if (input.before !== undefined) {
        where.push(lt(notifications.createdAt, new Date(input.before)));
      }
      const rows = await ctx.db
        .select()
        .from(notifications)
        .where(and(...where))
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      return { rows: rows.slice(0, input.limit), hasMore };
    }),

  unreadCount: tenantProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ n: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, ctx.tenantId),
          eq(notifications.userId, ctx.auth.userId),
          isNull(notifications.readAt),
        ),
      );
    return { count: rows[0]?.n ?? 0 };
  }),

  markRead: tenantProcedure
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.tenantId, ctx.tenantId),
            eq(notifications.userId, ctx.auth.userId),
            eq(notifications.id, input.id),
          ),
        );
      return { ok: true as const };
    }),

  markAllRead: tenantProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.tenantId, ctx.tenantId),
          eq(notifications.userId, ctx.auth.userId),
          isNull(notifications.readAt),
        ),
      );
    return { ok: true as const };
  }),

  /** The caller's own pref map (missing key = enabled). */
  prefs: tenantProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ notificationPrefs: user.notificationPrefs })
      .from(user)
      .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, ctx.auth.userId)))
      .limit(1);
    return { prefs: rows[0]?.notificationPrefs ?? {}, keys: NOTIFICATION_PREF_KEYS };
  }),

  setPref: tenantProcedure
    .input(z.object({ key: z.enum(NOTIFICATION_PREF_KEYS), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ notificationPrefs: user.notificationPrefs })
        .from(user)
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, ctx.auth.userId)))
        .limit(1);
      const prefs = { ...(rows[0]?.notificationPrefs ?? {}), [input.key]: input.enabled };
      await ctx.db
        .update(user)
        .set({ notificationPrefs: prefs, updatedAt: new Date() })
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, ctx.auth.userId)));
      return { ok: true as const };
    }),
});
