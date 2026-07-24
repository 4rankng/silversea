// Agent routes — the command-and-insight assistant surface.
//
// The live chat transport is socket.io (`agentSocket.ts`, `/agent` namespace) —
// it streams AgentEvent frames (tool activity, directives, then `done` with the
// final response) over a socket instead of an SSE HTTP request. These REST
// routes only carry conversation history:
//   GET  /conversations     — the user's recent conversations (sidebar history).
//   GET  /conversations/:id — full message history for one conversation.
//
// Auth/mount: `app.use('/api/agent', authMiddleware, casbinAuthz('agent'), …)`
// — the bot impersonates the caller; Casbin gates office roles. A 503 is
// returned for every route while BOT_ENABLE is off.
import { Router, type Request, type Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';
import { getAppSettings } from '../services/app-settings.service';
import { getUser } from '../middleware/auth';
import { agentResponseSchema, type AgentConversation } from '@tingting/shared';

export const agentRoutes = Router();

/** 503 when the feature flag is off — launcher is hidden client-side too. */
async function disabled(res: Response): Promise<boolean> {
  if (!(await getAppSettings()).botEnabled) {
    res.status(503).json({ enabled: false, message: 'Trợ lý chưa được bật' });
    return true;
  }
  return false;
}

agentRoutes.get('/conversations', async (req: Request, res: Response) => {
  if (await disabled(res)) return;
  try {
    const userId = getUser(req).userId;
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
      .limit(30);
    res.json(rows.map((r) => ({ ...r, id: String(r.id), messages: [] })));
  } catch (e) {
    console.error('[agent] list conversations failed', e);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

agentRoutes.get('/conversations/:id', async (req: Request, res: Response) => {
  if (await disabled(res)) return;
  try {
    const userId = getUser(req).userId;
    const id = Number(req.params.id);
    const [conv] = await db
      .select()
      .from(schema.agentConversations)
      .where(eq(schema.agentConversations.id, id))
      .limit(1);
    if (!conv || conv.userId !== userId) {
      res.status(404).json({ error: 'Không tìm thấy' });
      return;
    }
    const messages = await db
      .select()
      .from(schema.agentMessages)
      .where(eq(schema.agentMessages.conversationId, id))
      .orderBy(schema.agentMessages.id);
    const result: AgentConversation = {
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
    res.json(result);
  } catch (e) {
    console.error('[agent] get conversation failed', e);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});
