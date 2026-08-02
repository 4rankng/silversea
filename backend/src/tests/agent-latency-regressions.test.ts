import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path: string): string => readFileSync(join(root, path), 'utf8');

describe('chatbot latency regression guards', () => {
  test('expense mutations invalidate cached financial reports', () => {
    const expenseRoute = source('routes/expense.ts');
    const calls = expenseRoute.match(/await invalidateReportCaches\(\)/g) ?? [];
    assert.equal(calls.length, 3, 'create, update, and delete must each invalidate reports');
  });

  test('parallel tool latency is measured as batch wall-clock, not summed spans', () => {
    const orchestrator = source('services/agent/orchestrator.ts');
    assert.match(orchestrator, /Promise\.all\(readonlyPendings\.map/);
    assert.match(orchestrator, /READ-ONLY tools → concurrent/);
    assert.doesNotMatch(orchestrator, /latencyToolsMs\s*\+=\s*toolSpan\.durationMs/);
  });

  test('cancelled socket turns are persisted for abort telemetry', () => {
    const socket = source('agentSocket.ts');
    const orchestrator = source('services/agent/orchestrator.ts');
    assert.match(socket, /await previousCompletion/);
    assert.match(socket, /ac\.signal\.aborted && !turnRecorded/);
    assert.match(socket, /await recordAbortedTurn\(/);
    assert.match(orchestrator, /promptTokens:\s*0/);
    assert.match(orchestrator, /completionTokens:\s*0/);
    assert.equal(
      existsSync(join(root, 'routes/admin-chatbot-metrics.ts')),
      false,
      'legacy agent_turn_metrics route should stay removed after the 0003 drop',
    );
    assert.match(source('../drizzle/0003_drop_agent_turn_metrics.sql'), /DROP TABLE "agent_turn_metrics" CASCADE;/);
  });

  test('streaming-disabled fallback cannot create an empty text stream', () => {
    const orchestrator = source('services/agent/orchestrator.ts');
    assert.match(orchestrator, /emit && config\.agentStreamingEnabled \? randomUUID\(\) : undefined/);
  });
});
