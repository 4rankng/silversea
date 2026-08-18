// Agent conversation history — read models for the REST surface. The live
// chat transport is socket.io (agentSocket.ts); these queries back the
// sidebar history list and per-conversation message reload.
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import * as schema from '../../db/schema';
import { agentResponseSchema, type AgentConversation } from '@tingting/shared';

/** The user's recent conversations (sidebar history, newest first). */
export async function listRecentConversations(userId: number, limit = 30) {
  const rows = await db
    .select({
      id: schema.agentConversations.id,
      title: schema.agentConversations.title,
      createdAt: schema.agentConversations.createdAt,
      updatedAt: schema.agentConversations.updatedAt,
    })
    .from(schema.agentConversations)
    .where(eq(schema.agentConversations.userId, userId))
    .orderBy(desc(schema.agentConversations.updatedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, id: String(r.id), messages: [] }));
}

/** Full message history for one conversation, owned by `userId`. */
export async function getConversationHistory(
  conversationId: number,
  userId: number,
): Promise<AgentConversation | null> {
  const [conv] = await db
    .select()
    .from(schema.agentConversations)
    .where(eq(schema.agentConversations.id, conversationId))
    .limit(1);
  if (!conv || conv.userId !== userId) return null;
  const messages = await db
    .select()
    .from(schema.agentMessages)
    .where(eq(schema.agentMessages.conversationId, conversationId))
    .orderBy(schema.agentMessages.id);
  return {
    id: String(conv.id),
    title: conv.title ?? undefined,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    messages: messages.map((m) => {
      // Re-validate persisted jsonb: schema drift / corrupt / degraded rows
      // must not crash InsightCard on history reload. Drop non-conforming
      // responses (MessageBubble falls back to `content`).
      const parsed = m.response != null ? agentResponseSchema.safeParse(m.response) : null;
      return {
        id: String(m.id),
        role: m.role as 'user' | 'assistant',
        content: m.content ?? undefined,
        response: parsed?.success ? parsed.data : undefined,
        createdAt: m.createdAt.toISOString(),
      };
    }),
  };
}
