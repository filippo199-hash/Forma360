import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { tenants } from './tenants';

export const aiConversations = pgTable('ai_conversations', {
  id: varchar('id', { length: 26 }).primaryKey(),
  tenantId: varchar('tenant_id', { length: 26 })
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('New conversation'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const aiMessages = pgTable('ai_messages', {
  id: varchar('id', { length: 26 }).primaryKey(),
  conversationId: varchar('conversation_id', { length: 26 })
    .notNull()
    .references(() => aiConversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * WhatsApp opt-out registry. WhatsApp's Business Messaging Policy requires us
 * to honour opt-out requests; when a sender texts STOP/UNSUBSCRIBE we record
 * their number here and the webhook then stays silent for that number until
 * they text START to resume.
 *
 * Keyed by the bare E.164 phone (digits only, no leading `+`, exactly as Meta
 * delivers it in the webhook `from` field). Intentionally NOT tenant-scoped: a
 * person's choice to stop receiving WhatsApp messages is a property of their
 * number, independent of which tenant their account belongs to — and an
 * unlinked number (no Forma360 account yet) can opt out too.
 */
export const whatsappOptOuts = pgTable('whatsapp_opt_outs', {
  phone: varchar('phone', { length: 32 }).primaryKey(),
  optedOutAt: timestamp('opted_out_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WhatsappOptOut = typeof whatsappOptOuts.$inferSelect;
