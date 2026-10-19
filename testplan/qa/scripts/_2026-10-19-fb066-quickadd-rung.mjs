// FB-066 rung-3 — the LCL "Gán xe nhóm" dialog's "BKS thực" picker now carries
// the "+ Thêm nhanh" quick-add affordance (registers a new plate under the
// chosen nhà xe without leaving the flow). Drives the master plan, ticks two
// LCL lots, opens the assign dialog, picks a truck class + nhà xe, and captures
// the quick-add button beside "BKS thực".
//
// Usage: QA_BASE=http://localhost:7178 API=http://localhost:3003/api \
//        node testplan/qa/scripts/2026-10-19-fb066-quickadd-rung.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.API || 'http://localhost:3003/api';
const BASE = process.env.QA_BASE || 'http://localhost:7178';
const OUT = process.env.QA_OUT
  ? path.resolve(process.env.QA_OUT)
  : path.resolve(import.meta.dirname, '../../../qa/2026-10-19_fb066_quickadd');
fs.mkdirSync(OUT, { recursive: true });

const step = (s, o = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), step: s, ...o }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
const record = (id, pass, detail) => { if (!pass) exitCode = 1; step('RESULT', { id, pass, detail }); };

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login dieuvan -> ${login.status}`);
const { token } = await login.json();
step('login', { user: 'dieuvan', gotToken: Boolean(token) });

// Click a USearchableField by its visible label: open the combobox, wait for the
// option list, click the option whose text matches `pick`.
const pickInField = async (page, label, pick) => {
  const opened = await page.evaluate((label, pick) => {
    const lab = [...document.querySelectorAll('label, .uui-label, span')].find((l) => (l.textContent || '').trim().startsWith(label));
    if (!lab) return { ok: false, reason: 'no label' };
    const field = lab.closest('[class*="field"], .uui-field, div');
    const input = (field?.querySelector('input')) || null;
    const target = input || field?.querySelector('[role="combobox"], button');
    if (!target) return { ok: false, reason: 'no input' };
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    target.click();
    target.focus();
    return { ok: true };
  }, label, pick);
  if (!opened.ok) return opened;
  await sleep(500);
  const clicked = await page.evaluate((pick) => {
    const opts = [...document.querySelectorAll('[role="option"]')];
    const hit = opts.find((o) => (o.textContent || '').includes(pick)) || opts.find((o) => !(o.getAttribute('aria-disabled') === 'true'));
    if (!hit) return { ok: false, options: opts.map((o) => (o.textContent || '').trim()).slice(0, 10) };
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { ok: true, picked: (hit.textContent || '').trim() };
  }, pick);
  await sleep(400);
  return clicked;
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  await page.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(2500);

  // Scope to Hàng lẻ (LCL) so the CHỌN LÔ checkboxes render (FCL rows have none).
  const filtered = await page.evaluate(() => {
    const trigger = document.getElementById('master-plan-cargo-mode')
      || [...document.querySelectorAll('button')].find((b) => /Loại hàng/.test(b.textContent || ''));
    if (!trigger) return { ok: false, reason: 'no filter trigger' };
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    trigger.click();
    return { ok: true };
  });
  await sleep(500);
  const pickedFilter = await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"], [role="menuitem"], li')]
      .find((o) => /Hàng lẻ \(LCL\)|Hàng lẻ/.test(o.textContent || ''));
    if (!opt) return false;
    opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  });
  step('filter-lcl', { filtered, pickedFilter });
  await sleep(1500);

  // Tick two LCL lots (button[role=checkbox] from LclSelectCheckbox).
  const ticked = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('button[role="checkbox"][aria-label^="Chọn lô"]')]
      .filter((b) => b.getAttribute('aria-disabled') !== 'true');
    boxes.slice(0, 2).forEach((b) => b.click());
    return { total: boxes.length, picked: Math.min(2, boxes.length) };
  });
  step('tick-lots', ticked);
  await sleep(500);

  // Open the assign dialog.
  const assignOpen = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Gán xe nhóm/i.test(b.textContent || '') && b.getAttribute('aria-disabled') !== 'true');
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(900);
  record('FB066-dialog-open', assignOpen, `ticked=${JSON.stringify(ticked)}`);
  await page.screenshot({ path: path.join(OUT, 'fb066-01-dialog-open.png') });

  if (assignOpen) {
    // Pick a truck class (a tonnage option) then a nhà xe — this enables the
    // BKS thực quick-add button (needs ownFleet or an external carrier).
    const cls = await pickInField(page, 'Loại xe', 'T');
    step('pick-loai-xe', cls);
    const nhaXe = await pickInField(page, 'Nhà xe', '');
    step('pick-nha-xe', nhaXe);
    await sleep(500);

    const quickAdd = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return { found: false, reason: 'no dialog' };
      const btns = [...dlg.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean);
      const found = btns.some((t) => /thêm nhanh/i.test(t));
      return { found, buttons: btns };
    });
    record('FB066-quick-add-present', quickAdd.found, JSON.stringify(quickAdd));
    // Screenshot the BKS thực field region with the quick-add button.
    const bksField = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const head = dlg?.querySelector('.assign-truck-group__vehicle-head, [class*="vehicle-head"]');
      if (head) { head.scrollIntoView({ block: 'center' }); return true; }
      return false;
    });
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, 'fb066-02-quickadd-button.png') });

    // Open the quick-add dialog itself as final proof it's wired.
    const openedDialog = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = [...(dlg?.querySelectorAll('button') || [])].find((b) => /thêm nhanh/i.test(b.textContent || ''));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await sleep(700);
    await page.screenshot({ path: path.join(OUT, 'fb066-03-quickadd-dialog.png') });
    step('quickadd-dialog-opened', { opened: openedDialog, scrolledToBks: bksField });
  }
} catch (err) {
  step('DRIVER-ERROR', { message: String(err) });
  exitCode = 1;
} finally {
  await browser.close();
}
console.log('exit', exitCode);
process.exit(exitCode);
