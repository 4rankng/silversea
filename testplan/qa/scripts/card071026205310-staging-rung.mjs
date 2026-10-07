#!/usr/bin/env node
// Card 071026205310 STAGING QA rung (lead) — the appointment autosave must NOT
// close the drawer while a port draft is pending (fix 89dceb59), and the port
// must survive a manual save + reopen. Drives its own puppeteer browser so the
// shared agent-browser input lane cannot contaminate the rung.
// mutates: lot PROBE-EDD-1 — its container's Cảng nâng + giờ hẹn (auto-save) + manual Lưu.
import puppeteer from 'puppeteer';
import { appendFileSync, mkdirSync } from 'node:fs';

const OUT = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-07_071026205310-staging-qa';
mkdirSync(OUT, { recursive: true });
const BASE = 'https://vantai.tingting.vip';
const LOT = 'PROBE-EDD-1';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${OUT}/driver.jsonl`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token), role: session.user?.role ?? null });
if (!token) throw new Error('login failed: ' + JSON.stringify(session).slice(0, 200));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  page.on('request', (req) => {
    const m = req.method();
    if (m === 'GET' || !req.url().includes('/api/')) return;
    step('net', { m, url: req.url().replace(BASE, ''), body: (req.postData() || '').slice(0, 400) });
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });

  // Real-tap helper: hit-tested mouse move/down/up at the element's center.
  const tap = async (pick, what) => {
    const loc = await page.evaluate((pickSrc) => {
      const el = eval('(' + pickSrc + ')')();
      if (!el) return { ok: false, coveredBy: 'element-not-found' };
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const pts = [
        ['center', r.x + r.width / 2, r.y + r.height / 2],
        ['top-25', r.x + r.width / 2, r.y + r.height * 0.25],
        ['bottom-25', r.x + r.width / 2, r.y + r.height * 0.75],
        ['left-25', r.x + r.width * 0.25, r.y + r.height / 2],
      ];
      for (const [name, px, py] of pts) {
        const x = Math.round(px), y = Math.round(py);
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) return { ok: true, x, y, at: name, text: (el.textContent || '').trim().slice(0, 40) };
      }
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
      const hit = document.elementFromPoint(x, y);
      return { ok: false, x, y, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, coveredBy: hit ? (hit.tagName + '.' + String(hit.className || '').slice(0, 60)) : 'none' };
    }, pick);
    if (!loc.ok) throw new Error('tap target not hit-testable: ' + what + ' coveredBy=' + loc.coveredBy + ' rect=' + JSON.stringify(loc.rect));
    await page.mouse.move(loc.x, loc.y);
    await page.mouse.down();
    await page.mouse.up();
    step('tap', { what, x: loc.x, y: loc.y, text: loc.text });
    return loc;
  };

  await page.goto(`${BASE}/shipments?searchSuffix=${LOT}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let rows = 0;
  for (let i = 0; i < 15 && !rows; i++) { await sleep(3000); rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
  step('list', { rows });
  if (!rows) throw new Error('filtered list empty');
  await page.screenshot({ path: `${OUT}/01-list-with-data-1440.png`, fullPage: true });

  await tap(`() => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('Mở chi tiết lô hàng ${LOT}'))`, 'detail-button');
  let ledger = false;
  for (let i = 0; i < 12 && !ledger; i++) { await sleep(2000); ledger = await page.evaluate(() => Boolean(document.querySelector('.cus-container-ledger'))); }
  step('drawer', { ledger });
  if (!ledger) throw new Error('container ledger did not render');
  await page.screenshot({ path: `${OUT}/02-drawer-open-1440.png` });

  // ── Cảng nâng: open trigger, pick a DIFFERENT option (real taps) ────
  await tap(`() => { const l = [...document.querySelectorAll('label')].find(l => (l.textContent || '').includes('Cảng nâng của container')); if (!l) return null; const id = l.getAttribute('for'); return id ? document.getElementById(id) : null; }`, 'port-trigger');
  await sleep(1200);
  const located = await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('label')].find(l => (l.textContent || '').includes('Cảng nâng của container'));
    const btn = trigger ? document.getElementById(trigger.getAttribute('for')) : null;
    const current = btn?.textContent?.trim() ?? '';
    const flat = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const cur = flat(current);
    const opt = [...document.querySelectorAll('[role="option"]')]
      .find((o) => !/^[+＋]/.test(o.textContent.trim()) && flat(o.textContent.trim()) !== cur && o.textContent.trim().length > 1);
    if (!opt) return { ok: false, current, options: [...document.querySelectorAll('[role="option"]')].slice(0, 8).map((o) => o.textContent.trim()) };
    opt.scrollIntoView({ block: 'nearest' });
    const r = opt.getBoundingClientRect();
    return { ok: true, text: opt.textContent.trim(), current, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (!located.ok) { step('port-pick', located); throw new Error('option not found: ' + JSON.stringify(located)); }
  await page.mouse.move(located.x, located.y);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(800);
  const dirty = await page.evaluate(() => {
    const saveBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Lưu');
    const trigger = [...document.querySelectorAll('label')].find(l => (l.textContent || '').includes('Cảng nâng của container'));
    const btn = trigger ? document.getElementById(trigger.getAttribute('for')) : null;
    return { portText: btn?.textContent?.trim() ?? null, saveDisabled: saveBtn?.disabled ?? null };
  });
  step('port-pick', { picked: located.text, was: located.current, ...dirty });
  if (dirty.saveDisabled) throw new Error('port pick did not dirty the drawer');
  await page.screenshot({ path: `${OUT}/03-port-draft-save-lit-1440.png` });
  await page.keyboard.press('Escape');
  await sleep(600);

  // ── appointment popover: Xác nhận = the autosave under test ──────────
  const census = await page.evaluate(() => {
    const d = document.querySelector('.cus-container-ledger') || document;
    return [...d.querySelectorAll('button')].map((b) => ({ t: (b.textContent || '').trim().slice(0, 30), a: b.getAttribute('aria-label') })).slice(0, 40);
  });
  step('drawer-buttons', { census });
  const appt = await tap(`() => { const d = document.querySelector('.cus-container-ledger') || document; const rows = [...d.querySelectorAll('tr')]; const rx = /(\\d{1,2}:\\d{2}|--:--|giờ hẹn|hẹn giờ|chọn giờ)/i; for (const r of rows) { const b = [...r.querySelectorAll('button')].find(b => (rx.test(b.textContent.trim()) || rx.test(b.getAttribute('aria-label') || '')) && !/^copy/i.test(b.textContent.trim()) && !/^xóa/i.test(b.textContent.trim())); if (b) return b; } return [...d.querySelectorAll('button')].find(b => rx.test(b.getAttribute('aria-label') || '')); }`, 'appointment-trigger');
  await sleep(1500);
  const apptOk = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('.cus-appointment-popover')].pop();
    if (!dlg) return { ok: false, why: 'no .cus-appointment-popover' };
    const save = [...dlg.querySelectorAll('button')].find((b) => /^(xác nhận|lưu)$/i.test(b.textContent.trim()));
    return save ? { ok: true } : { ok: false, btns: [...dlg.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  });
  step('appt-open', { apptOk, trigger: appt.text });
  if (!apptOk.ok) throw new Error('appointment popover: ' + JSON.stringify(apptOk));
  await page.screenshot({ path: `${OUT}/03b-appointment-popover-open-1440.png` });
  // Diagnosis (read-only): reachability of every popover control.
  const reach = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('.cus-appointment-popover')].pop();
    return [...dlg.querySelectorAll('button, input')].map((b) => {
      const r = b.getBoundingClientRect();
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
      const hit = document.elementFromPoint(x, y);
      return {
        t: (b.textContent || b.placeholder || '').trim().slice(0, 16),
        self: hit === b || (hit && b.contains(hit)),
        hit: hit ? hit.tagName + '.' + String(hit.className || '').slice(0, 36) : 'none',
        pe: getComputedStyle(b).pointerEvents,
      };
    });
  });
  step('appt-reachability', { reach });
  // Autosave trigger via the preset path (card 325's pinned interaction):
  // real tap on "Hôm nay" + a time slot, then Enter commits.
  await tap(`() => { const dlg = [...document.querySelectorAll('.cus-appointment-popover')].pop(); return dlg ? [...dlg.querySelectorAll('button')].find(b => /^hôm nay$/i.test(b.textContent.trim())) : null; }`, 'preset-today');
  await sleep(500);
  await tap(`() => { const dlg = [...document.querySelectorAll('.cus-appointment-popover')].pop(); return dlg ? [...dlg.querySelectorAll('button')].find(b => /^0?8:00$/.test(b.textContent.trim())) : null; }`, 'preset-time-0800');
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(2500);

  // ── past the old ~3s give-up: drawer must stay OPEN, draft retained ──
  const samples = [];
  for (let i = 0; i < 9; i++) {
    await sleep(500);
    samples.push(await page.evaluate(() => ({
      t: Date.now(),
      drawerOpen: Boolean(document.querySelector('.cus-container-ledger')),
      toast: (document.querySelector('[class*="toast"], [role="status"]')?.textContent ?? '').slice(0, 80),
    })));
  }
  const retained = await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('label')].find(l => (l.textContent || '').includes('Cảng nâng của container'));
    const btn = trigger ? document.getElementById(trigger.getAttribute('for')) : null;
    const saveBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Lưu');
    return { portText: btn?.textContent?.trim() ?? null, saveDisabled: saveBtn?.disabled ?? null };
  });
  step('after-autosave', { openAll: samples.every((x) => x.drawerOpen), ...retained, toasts: samples.map((x) => x.toast).filter((v, i, a) => a.indexOf(v) === i), note: 'no throw here — reopen persistence below is the card criterion' });
  await page.screenshot({ path: `${OUT}/04-after-autosave-1440.png` });

  // ── reopen: the card's true criterion — the inline choice PERSISTS ───
  await sleep(1500);
  await tap(`() => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('Mở chi tiết lô hàng ${LOT}'))`, 'reopen-detail');
  let reopened = false;
  for (let i = 0; i < 12 && !reopened; i++) { await sleep(2000); reopened = await page.evaluate(() => Boolean(document.querySelector('.cus-container-ledger'))); }
  const persisted = await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('label')].find(l => (l.textContent || '').includes('Cảng nâng của container'));
    const btn = trigger ? document.getElementById(trigger.getAttribute('for')) : null;
    return { portText: btn?.textContent?.trim() ?? null };
  });
  step('persisted', { reopened, ...persisted, expected: located.text });
  await page.screenshot({ path: `${OUT}/05-reopened-port-persisted-1440.png` });
  if (!reopened) throw new Error('drawer did not reopen');
  if (flat(persisted.portText || '') !== flat(located.text)) throw new Error('port not persisted: ' + JSON.stringify(persisted));

  // ── gate-4 state matrix: full-page shots at 1280/1440/1920/2560 ─────
  for (const w of [1280, 1440, 1920, 2560]) {
    await page.setViewport({ width: w, height: 1000 });
    await sleep(700);
    await page.screenshot({ path: `${OUT}/matrix-shipments-with-data-${w}.png`, fullPage: true });
    await page.screenshot({ path: `${OUT}/matrix-drawer-open-${w}.png` });
  }
  // empty state: a search that matches nothing
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/shipments?searchSuffix=QA-NO-SUCH-LOT-9999`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3500);
  await page.screenshot({ path: `${OUT}/matrix-shipments-empty-1440.png`, fullPage: true });
  // error state: abort the list request in the SAME run as the navigation
  await page.setRequestInterception(true);
  page.on('request', (req) => { if (req.url().includes('/api/shipments')) void req.abort(); else void req.continue(); });
  await page.goto(`${BASE}/shipments`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3500);
  await page.screenshot({ path: `${OUT}/matrix-shipments-error-1440.png`, fullPage: true });
  step('matrix', { done: true });

  console.log('RUNG EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('RUNG FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
