/**
 * FAQ fast lane — unit tests for the pure decision functions (Stage 1 exact
 * match + Stage 4 score/margin gate). The full cascade (tryFaqFastLane) depends
 * on the DB + OpenRouter embedding API + pgvector, so it's covered by manual +
 * integration verification; these tests lock the gate logic deterministically.
 *
 * Covers the acceptance criteria that don't need infra:
 *  - exact match returns score 1.0
 *  - sub-threshold similarity → abstain (null)
 *  - ambiguous top-two (thin margin) → abstain (null)
 *  - a confident winner clears the gate
 *  - diacritic-insensitive matching (Vietnamese tones)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  pickSemanticWinner,
  isExactMatch,
  SCORE_FLOOR,
  MARGIN,
} from '../services/agent/faq-fast-lane.js';

describe('faq fast lane — exact match (Stage 1)', () => {
  test('matches the canonical question, diacritic-insensitive', () => {
    const q = 'Thiếu hóa đơn dầu bị phạt bao nhiêu?';
    assert.ok(isExactMatch('thieu hoa don dau bi phat bao nhieu', q, []));
    assert.ok(isExactMatch('THIẾU HÓA ĐƠN DẦU BỊ PHẠT BAO NHIÊU', q, []));
  });

  test('matches a registered variant', () => {
    const q = 'Thiếu hóa đơn dầu bị phạt bao nhiêu?';
    const variants = ['phạt thiếu hóa đơn dầu', 'thieu hoa don dau bi phat'];
    assert.ok(isExactMatch('phạt thiếu hóa đơn dầu', q, variants));
  });

  test('does not match a different question', () => {
    assert.ok(!isExactMatch('lợi nhuận tháng này', 'Thiếu hóa đơn dầu bị phạt bao nhiêu?', []));
  });

  test('empty query never matches', () => {
    assert.ok(!isExactMatch('', 'bất kỳ câu hỏi nào', []));
  });
});

describe('faq fast lane — semantic gate (Stage 4)', () => {
  const row = (
    id: number,
    similarity: number,
    question = `Q${id}`,
    answer = `A${id}`,
  ) => ({ id, question, answer, similarity });

  test('confident single winner clears the gate', () => {
    const winner = pickSemanticWinner([row(1, 0.92)]);
    assert.ok(winner);
    assert.strictEqual(winner!.entryId, 1);
    assert.strictEqual(winner!.stage, 'semantic');
    assert.ok(winner!.score >= SCORE_FLOOR);
  });

  test('sub-threshold top similarity → abstain (null)', () => {
    // 0.30 < SCORE_FLOOR (0.40) — not confident enough.
    assert.strictEqual(pickSemanticWinner([row(1, 0.30)]), null);
  });

  test('thin margin between top two → abstain (null)', () => {
    // top=0.90 clears SCORE_FLOOR, but gap 0.03 < MARGIN (0.12) → ambiguous.
    assert.strictEqual(pickSemanticWinner([row(1, 0.9), row(2, 0.87)]), null);
  });

  test('clear margin between top two → winner', () => {
    // top=0.90, second=0.70 → gap 0.20 >= MARGIN → accept top.
    const winner = pickSemanticWinner([row(1, 0.9), row(2, 0.7)]);
    assert.ok(winner);
    assert.strictEqual(winner!.entryId, 1);
  });

  test('boundary: exactly SCORE_FLOOR with no runner-up → accept', () => {
    const winner = pickSemanticWinner([row(1, SCORE_FLOOR)]);
    assert.ok(winner, 'a single candidate at exactly the floor should pass');
  });

  test('boundary: just below SCORE_FLOOR → abstain', () => {
    assert.strictEqual(pickSemanticWinner([row(1, SCORE_FLOOR - 0.001)]), null);
  });

  test('empty candidate set → null', () => {
    assert.strictEqual(pickSemanticWinner([]), null);
  });

  test('many candidates, clear winner → top returned', () => {
    const rows = [row(3, 0.95), row(1, 0.8), row(2, 0.79), row(4, 0.6)];
    const winner = pickSemanticWinner(rows);
    assert.ok(winner);
    assert.strictEqual(winner!.entryId, 3);
  });
});

describe('faq fast lane — thresholds are sane', () => {
  test('SCORE_FLOOR and MARGIN are the documented defaults', () => {
    // Lock the tuned constants so an accidental drift is caught. Change these
    // intentionally + update the docs in faq-fast-lane.ts when tuning.
    // Tuned for openai/text-embedding-3-small on Vietnamese questions — verified
    // against staging: legit paraphrases score ~0.40-0.50.
    assert.strictEqual(SCORE_FLOOR, 0.40);
    assert.strictEqual(MARGIN, 0.12);
  });
});
