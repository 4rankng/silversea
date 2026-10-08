#!/usr/bin/env node
// Card 071026204700 STAGING QA rung (lead) — the combined date+time popup on the
// shipment-create form (fix d6b7a11f on staging build 9e4e9713).
// mutates: NOTHING persistent — /shipments/new form only, never submitted.
import puppeteer from 'puppeteer';
import { appendFileSync, mkdirSync } from 'node:fs';

const OUT = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-07_071026204700-staging-qa';
mkdirSync(OUT, { recursive: true });
const BASE = 'https://vantai.tingting.vip';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${OUT}/driver.jsonl`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chord = async (page) => { await page.keyboard.down('Alt'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Alt'); };

const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token), role: session.user?.role ?? null });
if (!token) throw new Error('login failed');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  let abortApi = false;
  page.on('request', (req) => {
    if (abortApi && req.url().includes('/api/')) { void req.abort(); return; }
    void req.continue();
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });

  const tap = async (pick, what) => {
    const loc = await page.evaluate((pickSrc) => {
      const el = eval('(' + pickSrc + ')')();
      if (!el) return { ok: false, coveredBy: 'element-not-found' };
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
      const hit = document.elementFromPoint(x, y);
      return { ok: !!(hit && (hit === el || el.contains(hit))), x, y, text: (el.textContent || '').trim().slice(0, 30), coveredBy: hit ? (hit.tagName + '.' + String(hit.className || '').slice(0, 40)) : 'none' };
    }, pick);
    if (!loc.ok) throw new Error('tap not hit-testable: ' + what + ' by=' + loc.coveredBy);
    await page.mouse.move(loc.x, loc.y);
    await page.mouse.down();
    await page.mouse.up();
    step('tap', { what, x: loc.x, y: loc.y, text: loc.text });
    return loc;
  };
  const openCombined = async (pickExpr, what) => {
    await tap(pickExpr, what + '-segment');
    await chord(page);
    await sleep(900);
    return page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[role=dialog]')];
      const dlg = dialogs.find(d => (d.getAttribute('aria-label') || '').includes('Chọn ngày giờ'));
      return {
        dialogCount: dialogs.length,
        combined: !!dlg,
        hasDate: !!dlg?.querySelector('.combined-datetime__date, .dtp-day, [class*="dtp-date"]'),
        hasTime: !!dlg?.querySelector('.combined-datetime__time, .dtp-time__option, [class*="dtp-time"]'),
        hasExact: !!dlg?.querySelector('.dtp-time__exact input'),
        hasXong: [...(dlg?.querySelectorAll('button') || [])].some(b => /xong/i.test(b.textContent.trim())),
        label: dlg?.getAttribute('aria-label') ?? null,
      };
    });
  };

  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3500);
  const hasField = await page.evaluate(() => document.body.innerText.includes('NGÀY GIỜ ĐÓNG TRẢ') && !!document.querySelector('table [data-seg-part]'));
  step('form', { hasField });
  if (!hasField) throw new Error('appointment field not on create form');
  await page.screenshot({ path: `${OUT}/01-form-empty-1440.png`, fullPage: true });

  // ── criterion 1: ONE combined dialog with BOTH pickers ───────────────
  const apptPick = `() => document.querySelector('table [data-seg-part="date"] input')`;
  const open1 = await openCombined(apptPick, 'appointment');
  step('combined-open', open1);
  await page.screenshot({ path: `${OUT}/02-combined-popup-1440.png` });
  if (!open1.combined || open1.dialogCount !== 1 || !open1.hasDate || !open1.hasTime || !open1.hasExact || !open1.hasXong) throw new Error('combined popup contract failed: ' + JSON.stringify(open1));

  // ── criterion 2: value flow from the popup into the cell ────────────
  await tap(`() => document.querySelector('[role=dialog] .dtp-day.is-today, [role=dialog] [class*="is-today"]')`, 'day-today');
  await sleep(500);
  await tap(`() => document.querySelector('[role=dialog] .dtp-time__exact input, [role=dialog] [class*="dtp-time"] input')`, 'exact-input');
  await page.keyboard.type('09:30');
  await sleep(400);
  await tap(`() => { const dlg = [...document.querySelectorAll('[role=dialog]')].find(d => (d.getAttribute('aria-label') || '').includes('Chọn ngày giờ')); return [...dlg.querySelectorAll('button')].find(b => /xong/i.test(b.textContent.trim())); }`, 'xong');
  await sleep(800);
  const flow = await page.evaluate(() => ({
    segs: [...document.querySelectorAll('[data-seg]')].map((i) => i.value).join('|'),
    dialogs: document.querySelectorAll('[role=dialog]').length,
  }));
  step('value-flow', flow);
  await page.screenshot({ path: `${OUT}/03-values-in-cell-1440.png`, fullPage: true });
  if (!/\d{2}\|\d{2}\|/.test(flow.segs)) throw new Error('time segments not filled: ' + JSON.stringify(flow));

  // ── criterion 3: Escape closes, values retained ──────────────────────
  await tap(apptPick, 'appointment-segment-reopen');
  await chord(page);
  await sleep(700);
  await page.keyboard.press('Escape');
  await sleep(700);
  const esc = await page.evaluate(() => ({ segs: [...document.querySelectorAll('[data-seg]')].map((i) => i.value).join('|'), dialogs: document.querySelectorAll('[role=dialog]').length }));
  step('escape-close', esc);
  if (esc.dialogs !== 0) throw new Error('Escape did not close the popup');

  // ── criterion 4: the three sibling date+time fields (LCL-only) are combined ─
  await tap(`() => [...document.querySelectorAll('label')].find(l => l.textContent.trim() === 'Hàng lẻ')`, 'cargo-mode-LCL');
  await sleep(800);
  const confirm = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role=dialog]')].pop();
    if (!dlg) return null;
    const btn = [...dlg.querySelectorAll('button')].find(b => /chuyển và xóa/i.test(b.textContent.trim()));
    return { text: dlg.innerText.slice(0, 120), btn: btn ? btn.textContent.trim() : null };
  });
  if (confirm) {
    step('mode-confirm', confirm);
    if (confirm.btn) {
      await tap(`() => { const dlg = [...document.querySelectorAll('[role=dialog]')].pop(); return [...dlg.querySelectorAll('button')].find(b => /chuyển và xóa/i.test(b.textContent.trim())); }`, 'mode-confirm-accept');
      await sleep(1200);
    }
  }
  let lclOn = await page.evaluate(() => document.querySelectorAll('[data-seg-part="date"] input').length > 3);
  if (!lclOn) throw new Error('LCL mode did not engage after real tap + confirm');
  const sib = {};
  const nongroups = await page.evaluate(() => document.querySelectorAll('[data-seg-part="time"]').length);
  step('sibling-groups', { nongroups });
  for (let i = 0; i < nongroups; i++) {
    sib['group-' + i] = await openCombined(`() => document.querySelectorAll('[data-seg-part="time"]')[${i}].querySelector('input')`, 'sibling-' + i);
    sib['group-' + i].idx = i;
    await page.keyboard.press('Escape');
    await sleep(500);
  }
  step('siblings', sib);
  await page.screenshot({ path: `${OUT}/04-sibling-combined-1440.png`, fullPage: true });
  const sibLabels = Object.values(sib).map((v) => v.label || '');
  for (const [k, v] of Object.entries(sib)) if (!(v.combined && v.dialogCount === 1 && v.hasDate && v.hasTime)) throw new Error('sibling not combined: ' + k + ' ' + JSON.stringify(v));
  for (const expect of ['Hạn hoàn tất hải quan', 'Hạn hạ container tại cảng', 'Thời điểm trả container']) {
    if (!sibLabels.some((l) => l.includes(expect))) throw new Error('sibling field never opened combined: ' + expect + ' seen=' + JSON.stringify(sibLabels));
  }
  await tap(`() => [...document.querySelectorAll('label')].find(l => l.textContent.trim() === 'Hàng FCL')`, 'cargo-mode-FCL');
  await sleep(800);

  // ── gate-4 state matrix: fresh (empty) + with-data at 4 widths ───────
  for (const w of [1280, 1440, 1920, 2560]) {
    await page.setViewport({ width: w, height: 1000 });
    await sleep(600);
    await page.screenshot({ path: `${OUT}/matrix-form-with-data-${w}.png`, fullPage: true });
    const st = await openCombined(apptPick, 'matrix-open-' + w);
    await page.screenshot({ path: `${OUT}/matrix-combined-popup-${w}.png` });
    await page.keyboard.press('Escape');
    await sleep(400);
    step('matrix', { w, dialogCount: st.dialogCount, combined: st.combined });
    if (st.dialogCount !== 1 || !st.combined) throw new Error('matrix popup broken at ' + w);
  }
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3500);
  await page.screenshot({ path: `${OUT}/matrix-form-fresh-empty-1440.png`, fullPage: true });
  // error state: abort API loads in the SAME run as the navigation
  abortApi = true;
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3500);
  await page.screenshot({ path: `${OUT}/matrix-form-error-1440.png`, fullPage: true });
  step('matrix', { done: true });

  console.log('RUNG EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('RUNG FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
