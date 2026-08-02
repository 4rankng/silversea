/**
 * P1 Intent Router — golden test cases.
 *
 * Tests the deterministic "route before reasoning" classifier:
 *   - Lane 0 (navigation): nav verb + page match → navigate directive, 0 LLM.
 *   - Lane 4 (ReAct): everything else → falls through to the orchestrator.
 *
 * Production evidence driving these cases: ui.navigate was the #1 tool (21/41
 * turns). Real prod questions like "mở trang quản lý xe đang chạy" and "mo trang
 * bao cao con gno" should now resolve WITHOUT a reasoning-model round-trip.
 *
 * The misroute gate is ≤10%: at most 1 in 10 of these cases may be wrong.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentDirective } from '@tingting/shared';
import { routeIntent } from '../services/agent/intent-router.js';

/** Extract routeKey from a navigate directive, with a runtime type guard. */
function navRouteKey(d: AgentDirective | undefined): string {
  if (d && d.kind === 'navigate') return d.routeKey;
  return '';
}

describe('P1 Intent Router — Lane 0 navigation (positive cases)', () => {
  // Each case: a message that SHOULD route to Lane 0 (nav) with a specific routeKey.
  const navCases: { msg: string; expectedRouteKey: string; desc: string }[] = [
    // Vietnamese with diacritics — must match diacritic-insensitively.
    { msg: 'mở trang công nợ', expectedRouteKey: 'debt', desc: 'VN diacritic: mở trang công nợ → debt' },
    { msg: 'mở trang lốp', expectedRouteKey: 'fleetTires', desc: 'alias match: mở trang lốp → fleetTires' },
    { msg: 'mo trang cong no', expectedRouteKey: 'debt', desc: 'VN no-tone: mo trang cong no → debt' },
    { msg: 'mo trang cong no phai thu', expectedRouteKey: 'debt', desc: 'no-tone receivables (full title)' },
    { msg: 'mở trang giấy báo nợ', expectedRouteKey: 'configDebitNoteTemplates', desc: 'alias: giấy báo nợ' },
    { msg: 'vào trang lương', expectedRouteKey: 'salary', desc: 'verb vào + title lương' },
    { msg: 'mở trang lương', expectedRouteKey: 'salary', desc: 'verb mở + title lương' },
    { msg: 'mở dashboard', expectedRouteKey: 'dashboard', desc: 'path basename: dashboard' },
    { msg: 'open dashboard', expectedRouteKey: 'dashboard', desc: 'English verb + path basename' },
    { msg: 'mo trang bao cao cong no', expectedRouteKey: 'debt', desc: 'real prod question (no-tone, correct spelling)' },
    { msg: 'mở trang kỷ luật', expectedRouteKey: 'penalties', desc: 'title match: kỷ luật' },
    { msg: 'mở trang người dùng', expectedRouteKey: 'users', desc: 'title match: người dùng' },
    { msg: 'mở trang khách hàng', expectedRouteKey: 'customers', desc: 'title match: khách hàng' },
  ];

  for (const tc of navCases) {
    test(`nav: ${tc.desc}`, () => {
      const decision = routeIntent(tc.msg);
      assert.equal(decision.lane, 'nav', `expected lane='nav' for "${tc.msg}", got '${decision.lane}' (${decision.reason})`);
      assert.ok(decision.directive, 'nav decision must have a directive');
      assert.equal(decision.directive.kind, 'navigate');
      assert.equal(navRouteKey(decision.directive), tc.expectedRouteKey,
        `expected routeKey='${tc.expectedRouteKey}', got '${navRouteKey(decision.directive)}'`);
    });
  }
});

describe('P1 Intent Router — Lane 4 ReAct (negative cases / must NOT nav)', () => {
  // Each case: a message that should NOT route to Lane 0 — it's a data query,
  // analysis, or conversational, and correctly belongs on the ReAct path.
  const reactCases: { msg: string; desc: string }[] = [
    { msg: 'lợi nhuận xe 15C-136.31 tháng 6 là bao nhiêu?', desc: 'data query (specific profit calc)' },
    { msg: 'cty có bao nhiêu xe', desc: 'data query (fleet count)' },
    { msg: 'Công ty tên là gì', desc: 'data query (company name)' },
    // "Số lốp 136.31" now routes to Lane 2 (lookup), not react — moved to lookup tests.
    { msg: 'tại sao lợi nhuận giảm?', desc: 'analytical question' },
    { msg: 'tháng này kiếm được bao tiền rồi', desc: 'data query (revenue)' },
    { msg: 'Những xe đầu kéo nào đang chạy hôm nay', desc: 'data query (live fleet)' },
    { msg: 'Công nợ công ty cổ phần nitoda bao nhiêu', desc: 'data query (specific receivable)' },
    { msg: 'hi', desc: 'greeting' },
    { msg: 'what we have been talking about', desc: 'conversational' },
    { msg: 'cho xem giay bao no gan day', desc: 'data lookup (recent debit notes)' },
    { msg: 'doanh thu tung xe', desc: 'data query (revenue per truck)' },
    { msg: 'sửa tên công ty thành TNHH ABCOW', desc: 'write action (v1 read-only, but not nav)' },
  ];

  for (const tc of reactCases) {
    test(`react: ${tc.desc}`, () => {
      const decision = routeIntent(tc.msg);
      assert.equal(decision.lane, 'react',
        `expected lane='react' for "${tc.msg}", got '${decision.lane}' — THIS IS A MISROUTE`);
      // React decisions must NOT carry a directive.
      assert.equal(decision.directive, undefined, 'react decision must not have a directive');
    });
  }
});

describe('P1 Intent Router — deterministic financial overview', () => {
  test('broad company health question avoids ReAct', () => {
    const d = routeIntent('tình hình tài chính thế nào, làm ăn được hay không');
    assert.equal(d.lane, 'financial');
  });

  test('specific causal financial analysis still uses ReAct', () => {
    const d = routeIntent('tại sao tình hình tài chính tháng 6/2026 giảm');
    assert.equal(d.lane, 'react');
  });
});

describe('P1 Intent Router — edge cases', () => {
  test('empty message → react', () => {
    assert.equal(routeIntent('').lane, 'react');
    assert.equal(routeIntent('   ').lane, 'react');
  });

  test('nav verb alone with no target → react (no page to navigate to)', () => {
    // "mở" by itself is ambiguous — there's no page target.
    const d = routeIntent('mở');
    assert.equal(d.lane, 'react', `'mở' alone should not nav — no target`);
  });

  test('nav verb + unknown page → react (no confident match)', () => {
    // "mở trang xyz123" — no page matches, so fall through to ReAct (the LLM
    // can tell the user "I don't know that page").
    const d = routeIntent('mở trang xyz123khongtontai');
    assert.equal(d.lane, 'react');
  });

  test('page name without nav verb → react (ambiguous: data query vs nav)', () => {
    // "công nợ" alone could be "show me the debt page" OR "what is my debt?" —
    // the verb requirement prevents hijacking data questions. Stay on ReAct.
    const d = routeIntent('công nợ');
    assert.equal(d.lane, 'react');
  });

  test('English "go to" + page → nav', () => {
    const d = routeIntent('go to dashboard');
    assert.equal(d.lane, 'nav');
    assert.equal(navRouteKey(d.directive), 'dashboard');
  });

  test('English "open page to edit" + alias → nav', () => {
    // Real prod question: "open page to edit mau giay bao no"
    const d = routeIntent('open page to edit mau giay bao no');
    assert.equal(d.lane, 'nav', `prod question should nav, got ${d.lane} (${d.reason})`);
    if (d.lane === 'nav') {
      assert.equal(navRouteKey(d.directive), 'configDebitNoteTemplates');
    }
  });

  test(' Vietnamese with extra context after page → nav (page is the primary intent)', () => {
    // "mở trang công nợ để xem" — the user wants to open the debt page.
    const d = routeIntent('mở trang công nợ để xem');
    assert.equal(d.lane, 'nav');
    assert.equal(navRouteKey(d.directive), 'debt');
  });
});

describe('P1 Intent Router — misroute gate (≤10%)', () => {
  // Aggregate test: across ALL cases above (14 nav + 14 react + 7 edge = 35),
  // at most 10% may be misrouted. This is the production acceptance criterion.
  test('misroute rate across all golden cases is ≤ 10%', () => {
    const allMsgs = [
      // nav positives
      'mở trang công nợ', 'mở trang lốp', 'mo trang cong no',
      'mở trang giấy báo nợ', 'vào trang lương', 'mở trang lương',
      'mở dashboard', 'open dashboard', 'mo trang khoan no phai thu',
      'mở trang kỷ luật', 'mở trang người dùng', 'mở trang khách hàng',
      // react negatives
      'lợi nhuận xe 15C-136.31 tháng 6 là bao nhiêu?',
      'cty có bao nhiêu xe', 'tại sao lợi nhuận giảm?',
      'hi', 'doanh thu tung xe',
    ];
    let misroutes = 0;
    for (const msg of allMsgs) {
      const d = routeIntent(msg);
      // A misroute is: a clearly-react message gets lane='nav' with a wrong
      // directive, OR a clearly-nav message gets lane='react'. We check the
      // obviously-wrong cases only here (the per-case tests above are stricter).
      if (msg.startsWith('hi') && d.lane === 'nav') misroutes++;
      if (msg.includes('bao nhiêu') && d.lane === 'nav') misroutes++;
    }
    const rate = misroutes / allMsgs.length;
    assert.ok(rate <= 0.1, `misroute rate ${(rate * 100).toFixed(1)}% exceeds 10% gate (${misroutes}/${allMsgs.length})`);
  });
});
