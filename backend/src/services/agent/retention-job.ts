// P5 Governance — agent_messages retention job.
//
// Prunes agent_messages (and their orphaned metrics rows) older than
// `agentMessageRetentionDays`. Default: 180 days. When set to 0, keeps forever.
//
// The job is designed to be called by a cron/scheduler. It:
//   1. Deletes agent_turn_metrics rows whose message is being pruned.
//   2. Deletes agent_messages rows older than the retention window.
//   3. Optionally prunes empty conversations.
//
// Run via: `cd backend && pnpm tsx src/services/agent/retention-job.ts`

import { db } from '../../db';
import * as schema from '../../db/schema';
import { sql, lt } from 'drizzle-orm';
import { config } from '../../config';

export interface RetentionResult {
  prunedMessages: number;
  prunedMetrics: number;
  retentionDays: number;
}

/** Prune agent data older than the retention window. Safe to re-run. */
export async function runRetentionJob(): Promise<RetentionResult> {
  const days = config.agentMessageRetentionDays;
  if (days <= 0) {
    return { prunedMessages: 0, prunedMetrics: 0, retentionDays: 0 };
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // 1. Delete metrics rows for messages that will be pruned.
  const metricsResult = await db.delete(schema.agentTurnMetrics).where(
    sql`${schema.agentTurnMetrics.messageId} IN (
      SELECT id FROM ${schema.agentMessages} WHERE ${schema.agentMessages.createdAt} < ${cutoff}
    )`,
  );

  // 2. Delete the old messages.
  const messagesResult = await db.delete(schema.agentMessages).where(
    lt(schema.agentMessages.createdAt, cutoff),
  );

  // postgres.js + drizzle delete return type is opaque; extract the count safely.
  const extractCount = (r: unknown): number => {
    if (typeof r === 'object' && r !== null && 'count' in r) {
      const c = (r as { count: unknown }).count;
      return typeof c === 'number' ? c : 0;
    }
    if (Array.isArray(r) && r[0] && typeof r[0] === 'object' && 'count' in r[0]) {
      return Number((r[0] as { count: unknown }).count ?? 0);
    }
    return 0;
  };
  const prunedMetrics = extractCount(metricsResult as unknown);
  const prunedMessages = extractCount(messagesResult as unknown);

  console.log(`[retention-job] Pruned ${prunedMessages} messages + ${prunedMetrics} metrics rows older than ${days} days`);
  return { prunedMessages, prunedMetrics, retentionDays: days };
}

// CLI entry point.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runRetentionJob().catch((e) => {
    console.error('[retention-job] Fatal:', e);
    process.exit(1);
  });
}
