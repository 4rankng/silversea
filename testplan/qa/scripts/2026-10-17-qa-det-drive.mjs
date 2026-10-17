// QA wave 17/10 — /shipments-detail cluster: 000407 (FCL 2-line phân xe),
// FB-113 (documents field order), FB-109/110 (declaration persist + auto-copy),
// 000406 (completeness flip), FB-112/171026113520 supersede (no add button).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/det';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (r, ok, d) => { const v = ok ? 'PASS' : 'FAIL'; results.push(v); console.log(`[${v}] ${r} — ${String(d).slice(0, 460)}`); };
const login = async (id) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) });
  return (await r.json()).token;
};
const ctok = await login('thanhdc');
const PAGE_SEARCH = 'input[aria-label="Container, Bill/Booking, mã lô, tờ khai hoặc khách hàng"]';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1540, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ctok);
  await page.goto(`${BASE}/shipments-detail?transportDateFrom=2026-10-15&transportDateTo=2026-10-25`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(5000);
  // widen the date window to cover the fixtures (default window may exclude 19/10)
  const fillSeg = async (aria, val) => {
    await page.evaluate((a) => {
      const i = [...document.querySelectorAll('input')].find((x) => x.getAttribute('aria-label') === a);
      if (!i) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, '');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.focus();
      return true;
    }, aria);
    await page.keyboard.type(val, { delay: 30 });
    await sleep(150);
  };
  await fillSeg('Ngày — Từ ngày', '15');
  await fillSeg('Tháng — Từ ngày', '10');
  await fillSeg('Năm — Từ ngày', '2026');
  await fillSeg('Ngày — Đến ngày', '25');
  await fillSeg('Tháng — Đến ngày', '10');
  await fillSeg('Năm — Đến ngày', '2026');
  await sleep(2500);
  const pageSearch = async (q) => {
    await page.evaluate((sel, qq) => {
      const i = document.querySelector(sel);
      if (!i) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, qq);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
    }, PAGE_SEARCH, q);
    await page.waitForFunction((qq) => (document.body.textContent || '').includes(qq), { timeout: 12000 }, q).catch(() => {});
    await sleep(1200);
  };

  // ── 000407: FCL billing ≠ actual → 2 lines; blank billing → single ──
  await pageSearch('KBQA-DET-1');
  const two = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tr')].find((r) => /KBQA-DET-1/.test(r.textContent || ''));
    if (!tr) return null;
    const tds = [...tr.querySelectorAll('td')];
    const px = tds.find((td) => /phan-xe|phân xe/i.test(td.getAttribute('data-cell-label') || '') || /BKS Thực/.test(td.textContent || ''));
    return { cell: px ? (px.textContent || '').trim() : null, all: tds.map((td) => (td.textContent || '').trim().slice(0, 60)) };
  });
  await page.screenshot({ path: `${SHOTS}/01-det1-two-lines.png` });
  record('c000407-fcl-billing-differs-two-lines', !!two && /BKS Thực/.test(two.cell || '') && /Báo khách/.test(two.cell || '') && /29H-777\.77/.test(two.cell || ''), JSON.stringify(two) + ` · ${SHOTS}/01-det1-two-lines.png`);
  await pageSearch('KBQA-DET-2');
  const one = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tr')].find((r) => /KBQA-DET-2/.test(r.textContent || ''));
    const px = tr && [...tr.querySelectorAll('td')].find((td) => /BKS Thực|Phân xe/i.test((td.getAttribute('data-cell-label') || '') + (td.textContent || '')));
    return px ? (px.textContent || '').trim() : null;
  });
  record('c000407-fcl-blank-single-line', !!one && !/Báo khách/.test(one), JSON.stringify(one));

  // ── FB-113 + FB-109/110: documents editor on KBQA-DET-3 ──
  await pageSearch('KBQA-DET-3');
  const rowBtns = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tr')].find((r) => /KBQA-DET-3/.test(r.textContent || ''));
    if (!tr) return null;
    return [...tr.querySelectorAll('button')].map((b) => ({ t: (b.textContent || '').trim().slice(0, 40), aria: (b.getAttribute('aria-label') || '').slice(0, 70) }));
  });
  console.log('DET-3 row buttons:', JSON.stringify(rowBtns));
  // the documents editor is an INLINE expansion of a React-Aria press button
  const pt = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tr')].find((r) => /KBQA-DET-3/.test(r.textContent || ''));
    const b = [...(tr?.querySelectorAll('button') ?? [])].find((x) => /chứng từ và hãng tàu/i.test(x.textContent || '') || /chứng từ và hãng tàu/i.test(x.getAttribute('aria-label') || ''));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return { x: cx, y: cy, disabled: b.getAttribute('aria-disabled') === 'true' || b.hasAttribute('disabled'), hit: hit ? `${hit.tagName}:${String(hit.className).slice(0, 40)}` : 'none', sameNode: hit === b || b.contains(hit) };
  });
  console.log('trigger probe:', JSON.stringify(pt));
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    const pt2 = await page.evaluate(() => {
      const trs = [...document.querySelectorAll('tr')].filter((r) => /KBQA-DET-3/.test(r.textContent || ''));
      const tr = trs[0];
      if (!tr) return { no: 'row', rowCount: trs.length, bodyHas: (document.body.textContent || '').includes('KBQA-DET-3'), searchVal: document.querySelector('input[aria-label="Container, Bill/Booking, mã lô, tờ khai hoặc khách hàng"]')?.value };
      const b = [...(tr.querySelectorAll('button') ?? [])].find((x) => /chứng từ và hãng tàu/i.test(x.textContent || '') || /chứng từ và hãng tàu/i.test(x.getAttribute('aria-label') || ''));
      if (!b) return { no: 'btn', rowText: (tr.textContent || '').slice(0, 100) };
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, hitSelf: (() => { const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!el && (el === b || b.contains(el) || el.contains(b)); })() };
    });
    console.log(`attempt ${attempt}:`, JSON.stringify(pt2));
    if (pt2 && pt2.hitSelf) {
      await page.mouse.move(pt2.x, pt2.y);
      await page.mouse.down();
      await sleep(90);
      await page.mouse.up();
      opened = true;
    }
    await page.waitForFunction(() => document.querySelectorAll('.shipment-container-ledger__cell-editor--expanded').length > 0, { timeout: 5000 }).catch(() => {});
    opened = opened && await page.evaluate(() => document.querySelectorAll('.shipment-container-ledger__cell-editor--expanded').length > 0);
    if (!opened) { opened = false; await sleep(800); }
  }
  await sleep(1200);
  const postState = await page.evaluate(() => ({
    expanded: document.querySelectorAll('.shipment-container-ledger__cell-editor--expanded').length,
    editors: [...document.querySelectorAll('[id$="-editor"]')].map((e) => (e.textContent || '').slice(0, 60)),
    triggers: [...document.querySelectorAll('.shipment-container-ledger__cell-trigger--expanded')].length,
  }));
  console.log('post-click:', JSON.stringify(postState));
  const doc = await page.evaluate(() => {
    const ed = document.querySelector('.shipment-container-ledger__cell-editor--expanded');
    if (!ed) return null;
    const labels = [...ed.querySelectorAll('label')].map((l) => (l.textContent || '').trim()).filter(Boolean);
    return { labels, text: (ed.textContent || '').slice(0, 140) };
  });
  await page.screenshot({ path: `${SHOTS}/02-doc-editor-open.png` });
  const wantOrder = ['Số Bill', 'Số tờ khai', 'Nhập / Xuất', 'Hãng tàu'];
  let orderOk = false;
  if (doc) {
    const idx = wantOrder.map((w) => doc.labels.findIndex((l) => l.startsWith(w)));
    orderOk = idx.every((i) => i >= 0) && idx.every((v, k) => k === 0 || v > idx[k - 1]);
  }
  record('fb113-document-field-order', !!doc && orderOk, `labels=${JSON.stringify(doc?.labels)} · ${SHOTS}/02-doc-editor-open.png`);

  // enter declaration on the first container + save (FB-110 persist)
  const decl = 'TK-KBQA-DET3-001';
  const filled = await page.evaluate((v) => {
    const ed = document.querySelector('.shipment-container-ledger__cell-editor--expanded');
    if (!ed) return false;
    const lbl = [...ed.querySelectorAll('label')].find((l) => /số tờ khai/i.test(l.textContent || ''));
    if (!lbl) return false;
    let el = lbl.parentElement; let g = 0;
    while (el && g++ < 6) {
      const input = el.querySelector('input');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }, decl);
  await sleep(400);
  const saved = await page.evaluate(() => {
    const ed = document.querySelector('.shipment-container-ledger__cell-editor--expanded');
    if (!ed) return 'no-editor';
    const btn = [...ed.querySelectorAll('button')].find((b) => /^lưu$/i.test((b.textContent || '').trim()) && !b.disabled);
    if (!btn) return 'no-btn';
    btn.click();
    return 'clicked';
  });
  await sleep(3500);
  const persist = filled === true ? await page.evaluate(async () => {
    const res = await fetch('/api/shipments?limit=60&page=1', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const dd = await res.json();
    const lot = (dd.items ?? []).find((s) => s.blNumber === 'KBQA-DET-3');
    if (!lot) return null;
    const detail = await (await fetch(`/api/shipments/${lot.id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })).json();
    return (detail.containers ?? []).map((c) => ({ n: c.containerNumber, decl: c.declarationNumber }));
  }) : null;
  record('fb110-declaration-persists', filled === true && saved === 'clicked' && (persist ?? []).some((c) => c.decl === decl), `filled=${filled} save=${saved} containers=${JSON.stringify(persist)}`);
  record('fb109-auto-copy-to-empty-containers', (persist ?? []).filter((c) => c.decl === decl).length >= 2, `containers with decl: ${(persist ?? []).filter((c) => c.decl === decl).length}/${(persist ?? []).length}`);

  // ── 000406: completeness flips after per-container declaration ──
  await sleep(1500);
  await pageSearch('KBQA-DET-3');
  const status = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tr')].find((r) => /KBQA-DET-3/.test(r.textContent || '') && /KBQU/.test(r.textContent || ''));
    if (!tr) return null;
    const t = tr.textContent || '';
    return t.includes('Đầy đủ') ? 'Đầy đủ' : t.includes('Chưa cập nhật') ? 'Chưa cập nhật' : t.slice(0, 80);
  });
  await page.screenshot({ path: `${SHOTS}/03-det3-complete.png` });
  record('c000406-cont-declaration-clears-missing', status === 'Đầy đủ', `status=${JSON.stringify(status)} · ${SHOTS}/03-det3-complete.png`);

  // ── supersede check: no Thêm container button on this page ──
  const addBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /thêm container/i.test(x.textContent || '') || /thêm container/i.test(x.getAttribute('aria-label') || ''));
    return b ? (b.textContent || '').trim() : null;
  });
  record('supersede-no-add-button-on-detail', addBtn === null, `addButton=${JSON.stringify(addBtn)} (owner merged 171026182554 — add lives only in /shipments drawer)`);
} finally { await browser.close(); }
const fails = results.filter((v) => v === 'FAIL').length;
console.log(fails ? `=== ${fails} RUNG FAIL ===` : '=== ALL RUNGS PASS ===');
process.exit(fails ? 1 : 0);
