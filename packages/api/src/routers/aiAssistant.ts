import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { aiConversations, aiMessages } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { tenantProcedure } from '../procedures';
import { router } from '../trpc';

export const aiAssistantRouter = router({
  listConversations: tenantProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: aiConversations.id,
        title: aiConversations.title,
        updatedAt: aiConversations.updatedAt,
      })
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.tenantId, ctx.auth.tenantId),
          eq(aiConversations.userId, ctx.auth.userId),
        ),
      )
      .orderBy(desc(aiConversations.updatedAt))
      .limit(50);
  }),

  getMessages: tenantProcedure
    .input(z.object({ conversationId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const [conv] = await ctx.db
        .select({ id: aiConversations.id })
        .from(aiConversations)
        .where(
          and(
            eq(aiConversations.id, input.conversationId),
            eq(aiConversations.tenantId, ctx.auth.tenantId),
            eq(aiConversations.userId, ctx.auth.userId),
          ),
        )
        .limit(1);

      if (!conv) throw new TRPCError({ code: 'NOT_FOUND' });

      return ctx.db
        .select({
          id: aiMessages.id,
          role: aiMessages.role,
          content: aiMessages.content,
          createdAt: aiMessages.createdAt,
        })
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, input.conversationId))
        .orderBy(aiMessages.createdAt);
    }),

  createConversation: tenantProcedure
    .input(z.object({ title: z.string().min(1).max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      await ctx.db.insert(aiConversations).values({
        id,
        tenantId: ctx.auth.tenantId,
        userId: ctx.auth.userId,
        title: input.title ?? 'New conversation',
      });
      return { id };
    }),

  updateTitle: tenantProcedure
    .input(z.object({ conversationId: z.string().length(26), title: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(aiConversations)
        .set({ title: input.title, updatedAt: new Date() })
        .where(
          and(
            eq(aiConversations.id, input.conversationId),
            eq(aiConversations.tenantId, ctx.auth.tenantId),
            eq(aiConversations.userId, ctx.auth.userId),
          ),
        )
        .returning({ id: aiConversations.id });

      if (updated.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { updated: true };
    }),

  deleteConversation: tenantProcedure
    .input(z.object({ conversationId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(aiConversations)
        .where(
          and(
            eq(aiConversations.id, input.conversationId),
            eq(aiConversations.tenantId, ctx.auth.tenantId),
            eq(aiConversations.userId, ctx.auth.userId),
          ),
        )
        .returning({ id: aiConversations.id });

      if (deleted.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { deleted: true };
    }),
});
