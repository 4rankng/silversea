// Unit tests for the tour net (synthesizeStartTourFromResponse) — the
// deterministic safety net that validates an emitted {type:'start_tour'} and
// catches a freeform tutorial that matches a catalog tour. Mirrors the A3
// routeMatcher test style. Run via `npx tsx --test src/tests/*.test.ts`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeStartTourFromResponse } from '../services/agent/orchestrator.js';
import { Role, getTour, type AgentResponse } from '@tingting/shared';

function text(c: string): AgentResponse {
  return { type: 'text', content: c };
}

describe('synthesizeStartTourFromResponse', () => {
  test('keeps a valid start_tour for an allowed role', () => {
    const r = synthesizeStartTourFromResponse({ type: 'start_tour', tourId: 'create-trip' }, Role.MANAGER);
    assert.strictEqual(r.type, 'start_tour');
    assert.strictEqual(r.type === 'start_tour' && r.tourId, 'create-trip');
  });

  test('downgrades an unknown tourId to an honest text line', () => {
    const r = synthesizeStartTourFromResponse({ type: 'start_tour', tourId: 'does-not-exist' }, Role.MANAGER);
    assert.strictEqual(r.type, 'text');
  });

  test('downgrades a start_tour the role cannot see (create-trip is MANAGER/ADMIN)', () => {
    const r = synthesizeStartTourFromResponse({ type: 'start_tour', tourId: 'create-trip' }, Role.ACCOUNTANT);
    assert.strictEqual(r.type, 'text');
  });

  test('catches a freeform tutorial whose title matches a catalog tour', () => {
    const r = synthesizeStartTourFromResponse(
      { type: 'tutorial', title: 'Tạo chuyến vận chuyển', summary: 'x', steps: [{ title: 'a', body: 'b' }] },
      Role.MANAGER,
    );
    assert.strictEqual(r.type, 'start_tour');
    assert.strictEqual(r.type === 'start_tour' && r.tourId, 'create-trip');
  });

  test('leaves a narrow how-to tutorial alone (no strong title match)', () => {
    const r = synthesizeStartTourFromResponse(
      { type: 'tutorial', title: 'Đơn giá dầu điền ở đâu', summary: 'x', steps: [{ title: 'a', body: 'b' }] },
      Role.MANAGER,
    );
    assert.strictEqual(r.type, 'tutorial');
  });

  test('passes text/insight responses through unchanged', () => {
    assert.strictEqual(synthesizeStartTourFromResponse(text('hi'), Role.MANAGER).type, 'text');
  });

  // ── Phase 7: continue_tour / cancel_tour (typed chatbot tour directives) ──

  test('keeps a valid continue_tour for an allowed role and stamps tourVersion', () => {
    const r = synthesizeStartTourFromResponse(
      { type: 'continue_tour', tourId: 'create-trip' },
      Role.MANAGER,
    );
    assert.strictEqual(r.type, 'continue_tour');
    assert.ok(r.type === 'continue_tour' && r.tourId === 'create-trip');
    assert.ok(
      r.type === 'continue_tour' && r.tourVersion === getTour('create-trip')?.version,
      'catalog version stamped',
    );
  });

  test('downgrades an unknown continue_tour tourId to a text denial', () => {
    const r = synthesizeStartTourFromResponse(
      { type: 'continue_tour', tourId: 'does-not-exist' },
      Role.MANAGER,
    );
    assert.strictEqual(r.type, 'text');
  });

  test('downgrades a continue_tour the role cannot run to a text denial', () => {
    // create-trip is MANAGER/ADMIN only.
    const r = synthesizeStartTourFromResponse(
      { type: 'continue_tour', tourId: 'create-trip' },
      Role.ACCOUNTANT,
    );
    assert.strictEqual(r.type, 'text');
  });

  test('keeps a valid cancel_tour for an allowed role', () => {
    const r = synthesizeStartTourFromResponse(
      { type: 'cancel_tour', tourId: 'lock-trip' },
      Role.MANAGER,
    );
    assert.strictEqual(r.type, 'cancel_tour');
  });

  test('downgrades a cancel_tour for a role-denied tour', () => {
    const r = synthesizeStartTourFromResponse(
      { type: 'cancel_tour', tourId: 'create-trip' },
      Role.ACCOUNTANT,
    );
    assert.strictEqual(r.type, 'text');
  });
});
