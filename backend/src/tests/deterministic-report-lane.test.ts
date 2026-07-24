import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { routeIntent } from '../services/agent/intent-router.js';

describe('deterministic single-report routing', () => {
  test('current profit total avoids ReAct', () => {
    const decision = routeIntent('lợi nhuận tháng này bao nhiêu?');
    assert.equal(decision.lane, 'report');
    assert.deepEqual(decision.reportRequest, { report: 'profit', month: undefined, year: undefined });
  });

  test('explicit historical period is parsed deterministically', () => {
    const decision = routeIntent('tổng doanh thu tháng 6/2026 bao nhiêu?');
    assert.equal(decision.lane, 'report');
    assert.deepEqual(decision.reportRequest, { report: 'profit', month: 6, year: 2026 });
  });

  test('calendar month written with nam is parsed deterministically', () => {
    const decision = routeIntent('tổng doanh thu tháng 6 năm 2025 bao nhiêu?');
    assert.equal(decision.lane, 'report');
    assert.deepEqual(decision.reportRequest, { report: 'profit', month: 6, year: 2025 });
  });

  test('aggregate receivables and payables avoid ReAct', () => {
    assert.equal(routeIntent('tổng công nợ phải thu hiện tại bao nhiêu').reportRequest?.report, 'receivables');
    assert.equal(routeIntent('tổng công nợ phải trả hiện tại bao nhiêu').reportRequest?.report, 'payables');
  });

  test('causal and vehicle-scoped profit questions stay analytical', () => {
    assert.equal(routeIntent('tại sao lợi nhuận tháng này giảm?').lane, 'react');
    assert.equal(routeIntent('lợi nhuận xe 15C-136.31 tháng 6 là bao nhiêu?').lane, 'react');
  });

  test('unsupported quarter and year-only periods fail open to ReAct', () => {
    assert.equal(routeIntent('tổng doanh thu năm 2025 bao nhiêu').lane, 'react');
    assert.equal(routeIntent('lợi nhuận quý 2 năm 2025 bao nhiêu').lane, 'react');
  });

  test('historical receivables and payables fail open until as-of reporting exists', () => {
    assert.equal(routeIntent('tổng công nợ phải thu tháng 6/2026 bao nhiêu').lane, 'react');
    assert.equal(routeIntent('tổng công nợ phải trả tháng 6 năm 2025 bao nhiêu').lane, 'react');
  });
});
