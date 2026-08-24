// Agent turn persistence: the shared persistTurn writer (conversation +
// message rows, IDOR-guarded) and the lane-specific record* wrappers used by
// agentSocket for non-orchestrated turns (FAQ / nav / summary / lookup /
// aborted). Extracted from orchestrator.ts verbatim (pure code movement);
// runAgent imports persistTurn from here one-way.
import { db } from '../../db';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';
import type { AgentResponse, AgentDirective } from '@tingting/shared';
import type { AgentContext } from './tool.types';
import logger from '../../lib/logger.js';

// ── Persistence ────────────────────────────────────────────────────────────
// Returns BOTH the conversationId AND the newly inserted assistant messageId.
export async function persistTurn(opts: {
  ctx: AgentContext;
  userMessage: string;
  response: AgentResponse;
  toolTrace: unknown[];
  conversationId?: string;
  promptTokens: number;
  completionTokens: number;
}): Promise<{ conversationId: string | undefined; messageId: number | undefined }> {
  let conversationId = opts.conversationId;

  // IDOR guard: if continuing, the conversation MUST belong to the caller.
  // A missing, non-numeric, or other-user id falls back to a fresh
  // conversation (keeps chat working) instead of writing into someone
  // else's thread.
  if (conversationId) {
    const numericId = Number(conversationId);
    const [existing] = Number.isFinite(numericId)
      ? await db
          .select({ userId: schema.agentConversations.userId })
          .from(schema.agentConversations)
          .where(eq(schema.agentConversations.id, numericId))
          .limit(1)
      : [];
    if (!existing || existing.userId !== opts.ctx.userId) {
      conversationId = undefined;
    }
  }

  if (!conversationId) {
    const [row] = await db
      .insert(schema.agentConversations)
      .values({
        userId: opts.ctx.userId,
        role: opts.ctx.role,
        title: opts.userMessage.slice(0, 120),
      })
      .returning({ id: schema.agentConversations.id });
    conversationId = String(row.id);
  }

  await db.insert(schema.agentMessages).values({
    conversationId: Number(conversationId),
    role: 'user',
    content: opts.userMessage,
  });

  const directives = opts.response.type === 'directive' ? [opts.response.directive] : [];
  // .returning on the ASSISTANT insert only — that's the row whose id is the
  // metrics PK. (The user-message insert above has no metrics row.)
  const [assistantRow] = await db
    .insert(schema.agentMessages)
    .values({
      conversationId: Number(conversationId),
      role: 'assistant',
      response: opts.response,
      toolTrace: opts.toolTrace,
      directives,
      tokensIn: opts.promptTokens,
      tokensOut: opts.completionTokens,
    })
    .returning({ id: schema.agentMessages.id });

  await db
    .update(schema.agentConversations)
    .set({ updatedAt: new Date() })
    .where(eq(schema.agentConversations.id, Number(conversationId)));

  return { conversationId, messageId: assistantRow?.id };
}

/**
 * Persist a FAQ fast-lane turn so FAQ hits appear in the conversation history.
 * Reuses persistTurn for the conversation/message rows. Resilient: a failure
 * logs and never breaks chat (the answer was already emitted to the client).
 *
 * Returns the conversationId (so agentSocket can fold it into the done event)
 * and the messageId. Both undefined on failure.
 */
export async function recordFaqTurn(opts: {
  ctx: AgentContext;
  userMessage: string;
  answer: string;
  conversationId?: string;
  lookupMs: number;
}): Promise<{ conversationId: string | undefined; messageId: number | undefined }> {
  try {
    const response: AgentResponse = { type: 'text', content: opts.answer };
    const { conversationId, messageId } = await persistTurn({
      ctx: opts.ctx,
      userMessage: opts.userMessage,
      response,
      toolTrace: [],
      conversationId: opts.conversationId,
      promptTokens: 0,
      completionTokens: 0,
    });
    return { conversationId, messageId };
  } catch (err) {
    // Never crash chat over telemetry. The answer was already sent to the client.
    logger.warn({ err }, 'recordFaqTurn persist failed');
    return { conversationId: undefined, messageId: undefined };
  }
}

/**
 * Persist a Lane 0 navigation turn (deterministic, 0 LLM calls). Mirrors
 * recordFaqTurn and stores the directive response. The ack wait (if any) is
 * NOT included in lookupMs — the caller measures only the router + emit time,
 * since the ack is user-paced.
 */
export async function recordNavTurn(opts: {
  ctx: AgentContext;
  userMessage: string;
  directive: AgentDirective;
  conversationId?: string;
  lookupMs: number;
  ackOk?: boolean;
}): Promise<{ conversationId: string | undefined; messageId: number | undefined }> {
  try {
    const response: AgentResponse = { type: 'directive', directive: opts.directive };
    const { conversationId, messageId } = await persistTurn({
      ctx: opts.ctx,
      userMessage: opts.userMessage,
      response,
      toolTrace: [],
      conversationId: opts.conversationId,
      promptTokens: 0,
      completionTokens: 0,
    });
    return { conversationId, messageId };
  } catch (err) {
    logger.warn({ err }, 'recordNavTurn persist failed');
    return { conversationId: undefined, messageId: undefined };
  }
}

/**
 * Persist a Lane 3 summary turn (daily-work assistant, 0 LLM calls). Mirrors
 * recordNavTurn and stores the insight_card response from getDashboardStats().
 */
export async function recordSummaryTurn(opts: {
  ctx: AgentContext;
  userMessage: string;
  response: AgentResponse;
  conversationId?: string;
  lookupMs: number;
  toolTrace?: unknown[];
}): Promise<{ conversationId: string | undefined; messageId: number | undefined }> {
  try {
    const { conversationId, messageId } = await persistTurn({
      ctx: opts.ctx,
      userMessage: opts.userMessage,
      response: opts.response,
      toolTrace: opts.toolTrace ?? [],
      conversationId: opts.conversationId,
      promptTokens: 0,
      completionTokens: 0,
    });
    return { conversationId, messageId };
  } catch (err) {
    logger.warn({ err }, 'recordSummaryTurn persist failed');
    return { conversationId: undefined, messageId: undefined };
  }
}

/**
 * Persist a Lane 2 lookup turn (single-tool search, 0 LLM in v1).
 */
export async function recordLookupTurn(opts: {
  ctx: AgentContext;
  userMessage: string;
  response: AgentResponse;
  conversationId?: string;
  lookupMs: number;
}): Promise<{ conversationId: string | undefined; messageId: number | undefined }> {
  try {
    const { conversationId, messageId } = await persistTurn({
      ctx: opts.ctx,
      userMessage: opts.userMessage,
      response: opts.response,
      toolTrace: [{ toolName: 'data.search', ok: true, label: 'Lane 2 lookup' }],
      conversationId: opts.conversationId,
      promptTokens: 0,
      completionTokens: 0,
    });
    return { conversationId, messageId };
  } catch (err) {
    logger.warn({ err }, 'recordLookupTurn persist failed');
    return { conversationId: undefined, messageId: undefined };
  }
}

/** Persist a cancelled turn so abort-rate telemetry is not silently lost. */
export async function recordAbortedTurn(opts: {
  ctx: AgentContext;
  userMessage: string;
  conversationId?: string;
  elapsedMs: number;
}): Promise<{ conversationId: string | undefined; messageId: number | undefined }> {
  try {
    const response: AgentResponse = { type: 'text', content: 'Yêu cầu đã được huỷ trước khi hoàn tất.' };
    const { conversationId, messageId } = await persistTurn({
      ctx: opts.ctx,
      userMessage: opts.userMessage,
      response,
      toolTrace: [],
      conversationId: opts.conversationId,
      promptTokens: 0,
      completionTokens: 0,
    });
    return { conversationId, messageId };
  } catch (err) {
    logger.warn({ err }, 'recordAbortedTurn persist failed');
    return { conversationId: undefined, messageId: undefined };
  }
}
