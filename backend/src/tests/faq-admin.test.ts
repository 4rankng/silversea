/**
 * Admin FAQ CRUD — focused integration test for `routes/faq-admin.ts`.
 *
 * Scope & rationale:
 *   The E2E test DB is currently out of sync (pre-existing schema drift on
 *   `trucks` breaks every DB-backed E2E test, unrelated to this feature). So
 *   instead of hitting a real Postgres + OpenRouter, this file locks the
 *   unit-testable contract pieces that the route's correctness depends on. The
 *   route handler itself is a thin drizzle + side-effect wrapper around these
 *   contracts; its remaining logic (tone-strip on save, fail-soft embed,
 *   exclude the embedding column) is simple and verified by code inspection
 *   (see the QA report's AC walkthrough).
 *
 *   Driving the handler via Node 25's experimental `mock.module` was attempted
 *   but abandoned: ESM mocking of named imports + drizzle's deeply chained
 *   query builders produced brittle tests for low marginal coverage. The
 *   codebase convention (see ocr-persist.test.ts, faq-fast-lane.test.ts) is to
 *   test pure logic with node:test and rely on manual/integration verification
 *   for DB-bound paths — we follow that here.
 *
 * Two layers covered:
 *   1. Zod contract (faqEntryCreateSchema / faqEntryUpdateSchema) — the shared
 *      gate every POST/PUT body must pass, including Vietnamese error messages.
 *   2. normalizeText tone-stripping — the helper the route reuses for
 *      required/forbidden terms; locking it here protects the matcher's
 *      byte-for-byte contract (see faq-admin.ts file header + the shared
 *      schema docblock). If this round-trip ever drifts, admin-entered terms
 *      would silently fail to match.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';

import {
  faqEntryCreateSchema,
  faqEntryUpdateSchema,
} from '@tingting/shared';
import { normalizeText } from '../services/agent/text';

// ============================================================================
// 1. Zod schema contract — shared gate for every POST/PUT body
// ============================================================================
describe('faqEntryCreateSchema', () => {
  test('accepts a fully-populated body', () => {
    const out = faqEntryCreateSchema.parse({
      question: 'Q?',
      answer: 'A.',
      questionVariants: ['v1'],
      requiredTerms: ['phat'],
      forbiddenTerms: [],
      isActive: false,
      sortOrder: 5,
    });
    assert.strictEqual(out.question, 'Q?');
    assert.strictEqual(out.answer, 'A.');
    assert.deepStrictEqual(out.questionVariants, ['v1']);
    assert.strictEqual(out.isActive, false);
    assert.strictEqual(out.sortOrder, 5);
  });

  test('applies documented defaults for optional fields', () => {
    const out = faqEntryCreateSchema.parse({ question: 'Q?', answer: 'A.' });
    assert.deepStrictEqual(out.questionVariants, []);
    assert.deepStrictEqual(out.requiredTerms, []);
    assert.deepStrictEqual(out.forbiddenTerms, []);
    assert.strictEqual(out.isActive, true);
    assert.strictEqual(out.sortOrder, 0);
  });

  test('rejects an empty question', () => {
    assert.throws(
      () => faqEntryCreateSchema.parse({ question: '', answer: 'A.' }),
      /Câu hỏi không được để trống/,
    );
  });

  test('rejects an empty answer', () => {
    assert.throws(
      () => faqEntryCreateSchema.parse({ question: 'Q?', answer: '' }),
      /Câu trả lời không được để trống/,
    );
  });

  test('rejects a missing question', () => {
    assert.throws(() => faqEntryCreateSchema.parse({ answer: 'A.' }));
  });

  test('rejects non-integer sortOrder', () => {
    assert.throws(() =>
      faqEntryCreateSchema.parse({ question: 'Q?', answer: 'A.', sortOrder: 1.5 }),
    );
  });
});

describe('faqEntryUpdateSchema', () => {
  test('is a proper partial of create — accepts a one-field patch', () => {
    // Every field optional; this is the contract PUT /:id relies on.
    const out = faqEntryUpdateSchema.parse({ sortOrder: 9 });
    assert.strictEqual(out.sortOrder, 9);
    assert.strictEqual(out.question, undefined);
    assert.strictEqual(out.answer, undefined);
  });

  test('accepts the empty object (no-op patch)', () => {
    const out = faqEntryUpdateSchema.parse({});
    assert.strictEqual(out.question, undefined);
  });

  test('still validates question when present (min(1))', () => {
    assert.throws(
      () => faqEntryUpdateSchema.parse({ question: '' }),
      /Câu hỏi không được để trống/,
    );
  });
});

// ============================================================================
// 2. normalizeText — Vietnamese tone-stripping contract reused by the route
//    (required_terms/forbidden_terms MUST be stored tone-stripped; see
//    faq-admin.ts file header + shared/schemas/faq.ts docblock.)
// ============================================================================
describe('normalizeText — tone-stripping contract (required/forbidden terms)', () => {
  // The exact cases called out in the shared schema docblock.
  test('"phạt" → "phat" (required term canonical form)', () => {
    assert.strictEqual(normalizeText('phạt'), 'phat');
  });

  test('"đường" → "duong" (đ → d, diacritic dropped)', () => {
    assert.strictEqual(normalizeText('đường'), 'duong');
  });

  test('"Tiền Đi Đường" → "tien di duong" (mixed case + diacritics)', () => {
    assert.strictEqual(normalizeText('Tiền Đi Đường'), 'tien di duong');
  });

  test('is lowercase (matcher compares lowercased tokens)', () => {
    assert.strictEqual(normalizeText('PHẠT'), 'phat');
  });

  test('handles the seeded FAQ question diacritics losslessly for matching', () => {
    // If this stops round-tripping to the expected plain form, the fast-lane
    // exact matcher (isExactMatch) and the rule-stage required-term check will
    // silently break against admin-entered terms.
    assert.strictEqual(
      normalizeText('Thiếu hóa đơn dầu bị phạt bao nhiêu?'),
      'thieu hoa don dau bi phat bao nhieu?',
    );
  });
});
