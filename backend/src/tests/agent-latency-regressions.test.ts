import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    assert.match(orchestrator, /performance\.now\(\) - batchStart/);
    assert.doesNotMatch(orchestrator, /latencyToolsMs\s*\+=\s*toolSpan\.durationMs/);
  });

  test('cancelled socket turns are persisted for abort telemetry', () => {
    const socket = source('agentSocket.ts');
    const orchestrator = source('services/agent/orchestrator.ts');
    const metricsRoute = source('routes/admin-chatbot-metrics.ts');
    assert.match(socket, /await previousCompletion/);
    assert.match(socket, /ac\.signal\.aborted && !turnRecorded/);
    assert.match(socket, /await recordAbortedTurn\(/);
    assert.match(orchestrator, /toolCallCount: null/);
    assert.match(orchestrator, /tokensIn: null/);
    assert.doesNotMatch(metricsRoute, /avg\(coalesce\([^\n]+tokensIn/);
  });

  test('streaming-disabled fallback cannot create an empty text stream', () => {
    const orchestrator = source('services/agent/orchestrator.ts');
    assert.match(orchestrator, /emit && config\.agentStreamingEnabled \? randomUUID\(\) : undefined/);
  });
});
