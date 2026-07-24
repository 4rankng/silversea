import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '@tingting/shared';
import { getToolsForRole } from '../services/agent/tool.registry.js';
import { iterationBudgetFor, readonlyToolCacheKey, selectToolsForMessage } from '../services/agent/tool-selector.js';

describe('intent-scoped tool schemas', () => {
  const all = getToolsForRole(Role.ADMIN);

  test('greeting advertises no tools and gets one model iteration', () => {
    const selected = selectToolsForMessage(all, 'hi');
    assert.equal(selected.length, 0);
    assert.equal(iterationBudgetFor('hi', selected.length), 1);
  });

  test('financial analysis keeps report/data but removes unrelated advances tools', () => {
    const selected = selectToolsForMessage(all, 'tại sao lợi nhuận tháng này giảm?');
    const names = new Set(selected.map((tool) => tool.name));
    assert.ok(names.has('report.run'));
    assert.ok(names.has('data.search'));
    assert.equal(names.has('advances.requests'), false);
    assert.ok(selected.length < all.length);
    assert.equal(iterationBudgetFor('tại sao lợi nhuận tháng này giảm?', selected.length), 4);
  });

  test('combined analysis and navigation retains directive tools', () => {
    const selected = selectToolsForMessage(all, 'tại sao lợi nhuận giảm và mở báo cáo cho tôi');
    const names = new Set(selected.map((tool) => tool.name));
    assert.ok(names.has('report.run'));
    assert.ok(names.has('ui.search_pages'));
    assert.ok(names.has('ui.navigate'));
    assert.ok(names.has('ui.focus'));
  });

  test('specific financial analysis keeps the full four-iteration budget', () => {
    assert.equal(iterationBudgetFor('so với tháng 6 năm 2025 thì sao?', 10), 4);
  });

  test('unknown intent keeps the complete role-filtered surface', () => {
    assert.equal(selectToolsForMessage(all, 'giúp tôi kiểm tra vấn đề này').length, all.length);
  });
});

describe('read-only tool memo key', () => {
  test('object key order does not create duplicate executions', () => {
    assert.equal(
      readonlyToolCacheKey('report.run', { month: 7, reportKey: 'profit_report' }),
      readonlyToolCacheKey('report.run', { reportKey: 'profit_report', month: 7 }),
    );
  });
});
