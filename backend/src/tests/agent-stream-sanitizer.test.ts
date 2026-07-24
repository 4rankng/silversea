import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createSafeTextDeltaFilter } from '../services/agent/stream-sanitizer.js';

function filter(chunks: string[]): string {
  const output: string[] = [];
  const safe = createSafeTextDeltaFilter((text) => output.push(text));
  for (const chunk of chunks) safe.push(chunk);
  safe.finish();
  return output.join('');
}

describe('streamed model-content sanitizer', () => {
  test('never emits a think block split across SSE chunks', () => {
    assert.equal(filter(['<th', 'ink>secret', '</thi', 'nk>Trả lời']), 'Trả lời');
  });

  test('removes internal tool markup without losing surrounding prose', () => {
    assert.equal(filter(['Trước ', '<minimax:tool_', 'call>x</minimax:tool_call>', ' sau']), 'Trước  sau');
  });

  test('streams ordinary prose and comparison symbols unchanged', () => {
    assert.equal(filter(['Lợi nhuận ', '< 0 nên lỗ.']), 'Lợi nhuận < 0 nên lỗ.');
  });

  test('drops truncated internal reasoning at end of stream', () => {
    assert.equal(filter(['Mở đầu ', '<think>không hoàn tất']), 'Mở đầu ');
  });

  test('drops self-closing internal tags without swallowing following prose', () => {
    assert.equal(filter(['<think/>', 'Câu trả lời']), 'Câu trả lời');
    assert.equal(filter(['<tool_call />', 'Tiếp tục']), 'Tiếp tục');
    assert.equal(filter(['<minimax:tool_', 'call/>', 'Xong']), 'Xong');
  });
});
