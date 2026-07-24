// Unit tests for the A3 guardrail primitives + the prose→directive synthesizer.
// These are the deterministic core that catches MiniMax-M3 when it writes a
// destination path in text instead of calling ui.navigate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRoute, sameRoute, hasOnlyNumericParams } from '../services/agent/routeMatcher.js';
import { synthesizeNavigateFromProse, synthesizeTextActionsFromProse } from '../services/agent/orchestrator.js';

test('matchRoute resolves a parametric path to routeKey + params', () => {
  const m = matchRoute('/fleet/1/tires');
  assert.ok(m);
  assert.strictEqual(m!.routeKey, 'fleetTires');
  assert.deepStrictEqual(m!.params, { truckId: '1' });
});

test('matchRoute resolves a static path with empty params', () => {
  const m = matchRoute('/dashboard');
  assert.ok(m);
  assert.strictEqual(m!.routeKey, 'dashboard');
  assert.deepStrictEqual(m!.params, {});
});

test('matchRoute strips query/hash before matching', () => {
  const m = matchRoute('/fleet/42/tires?focus=7#section');
  assert.ok(m);
  assert.deepStrictEqual(m!.params, { truckId: '42' });
});

test('matchRoute returns null for an unknown path', () => {
  assert.strictEqual(matchRoute('/this-route-does-not-exist'), null);
});

test('hasOnlyNumericParams is true for id-shaped params, false otherwise', () => {
  assert.ok(hasOnlyNumericParams(matchRoute('/fleet/1/tires')!));
  // A hallucinated/non-numeric param still matches the pattern but fails the
  // numeric guard — the guardrail must not act on '/fleet/abc/tires'.
  assert.ok(!hasOnlyNumericParams(matchRoute('/fleet/abc/tires')!));
});

test('sameRoute treats different params on the same routeKey as NOT equal', () => {
  // The current-route guard must not suppress navigating from truck 1 to truck 2.
  const a = matchRoute('/fleet/1/tires');
  const b = matchRoute('/fleet/2/tires');
  assert.ok(!sameRoute(a, b));
});

test('sameRoute is true only for identical routeKey + params', () => {
  assert.ok(sameRoute(matchRoute('/fleet/1/tires'), matchRoute('/fleet/1/tires')));
  assert.ok(!sameRoute(matchRoute('/fleet/1/tires'), matchRoute('/dashboard')));
});

test('synthesizeNavigateFromProse extracts a path and builds a navigate directive with the default highlight', () => {
  const d = synthesizeNavigateFromProse(
    'Tôi đang ở chế độ chỉ đọc. Bạn vui lòng thao tác tại /fleet/1/tires.',
    undefined,
  );
  assert.ok(d);
  assert.strictEqual(d!.kind, 'navigate');
  assert.strictEqual(d!.routeKey, 'fleetTires');
  assert.deepStrictEqual(d!.params, { truckId: '1' });
  assert.ok(d!.highlight);
  assert.strictEqual(d!.highlight!.targetId, 'ttp-add-trigger');
});

test('synthesizeNavigateFromProse skips a navigate to the page the user is already on', () => {
  assert.strictEqual(
    synthesizeNavigateFromProse('Bạn đang ở /fleet/1/tires rồi.', '/fleet/1/tires'),
    null,
  );
});

test('synthesizeNavigateFromProse navigates across different params on the same route', () => {
  const d = synthesizeNavigateFromProse('Xem xe khác tại /fleet/9/tires', '/fleet/1/tires');
  assert.ok(d);
  assert.deepStrictEqual(d!.params, { truckId: '9' });
});

test('synthesizeNavigateFromProse rejects a non-numeric parametric path', () => {
  assert.strictEqual(synthesizeNavigateFromProse('Xem /fleet/abc/tires', undefined), null);
});

test('synthesizeNavigateFromProse handles a static route with no default highlight', () => {
  const d = synthesizeNavigateFromProse('Mở /dashboard để xem KPI.', undefined);
  assert.ok(d);
  assert.strictEqual(d!.routeKey, 'dashboard');
  assert.strictEqual(d!.highlight, undefined);
});

test('synthesizeNavigateFromProse returns null when no path token is present', () => {
  assert.strictEqual(synthesizeNavigateFromProse('Xin lỗi, tôi không thể xử lý.', undefined), null);
});

test('synthesizeTextActionsFromProse creates a suggested action for a different tire page', () => {
  const actions = synthesizeTextActionsFromProse(
    'Bạn đang ở /fleet/4/tires — không đúng xe. Chuyển sang trang lốp của xe 15C-136.31 (/fleet/1/tires).',
    '/fleet/4/tires',
  );
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].label, 'Mở trang lốp');
  assert.strictEqual(actions[0].directive.kind, 'navigate');
  assert.strictEqual(actions[0].directive.routeKey, 'fleetTires');
  assert.deepStrictEqual(actions[0].directive.params, { truckId: '1' });
});

test('synthesizeTextActionsFromProse does not guess navigation from page names alone', () => {
  const actions = synthesizeTextActionsFromProse(
    'Nếu cần thêm lốp, bạn có thể nhấn nút "+" trên trang Quản lý lốp.',
    undefined,
  );
  assert.deepStrictEqual(actions, []);
});
