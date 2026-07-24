import { test, describe } from 'node:test';
import assert from 'node:assert';
import { generateSettlementCode } from '../services/advance.service';

describe('advance settlement code generation', () => {
  test('serializes max(code)+1 generation with a transaction advisory lock', async () => {
    const calls: string[] = [];
    const fakeTx = {
      execute: async () => {
        calls.push('execute');
      },
      select: () => {
        calls.push('select');
        return {
          from: () => ({
            where: async () => [{ maxCode: 'PT-2606-0007' }],
          }),
        };
      },
    };

    const code = await generateSettlementCode(fakeTx as never, new Date('2026-06-19T12:00:00+07:00'));

    assert.strictEqual(code, 'PT-2606-0008');
    assert.deepStrictEqual(calls, ['execute', 'select']);
  });
});
