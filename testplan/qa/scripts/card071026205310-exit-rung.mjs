// Card 071026205310 local UI rung — the appointment autosave must NOT close
// the drawer while a port draft is pending. Journey: open drawer → set
// Cảng nâng (dirty) → appointment popover autosave → wait past the old 3s
// give-up → assert drawer OPEN + draft retained → manual save.
import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const CARD = 'card071026205310';
const BASE = 'http://localhost:7175';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${QA}/2026-10-07_${CARD}_ui-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token), role: session.user?.role ?? null });
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/shipments?searchSuffix=QA-329-PROBE-20944`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let rows = 0;
  for (let i = 0; i < 15 && !rows; i++) { await sleep(3000); rows = await page.evaluate(() => document.querySelectorAll('tr.cus-dashboard-row, tbody tr').length); }
  step('list', { rows });
  if (!rows) throw new Error('filtered list empty');
  await page.evaluate(() => document.querySelector('button.cus-dashboard-detail')?.click());
  let ledger = false;
  for (let i = 0; i < 12 && !ledger; i++) { await sleep(2000); ledger = await page.evaluate(() => Boolean(document.querySelector('.cus-container-ledger'))); }
  step('drawer', { ledger });
  if (!ledger) throw new Error('container ledger did not render');
  await page.screenshot({ path: `${QA}/2026-10-07_${CARD}_ui-drawer.png` });

  // ── Phase 2: focus the Cảng nâng combobox of container CSQU3333330 ────
  const opened = await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')]
      .find((l) => (l.textContent ?? '').includes('Cảng nâng của container CSQU3333330'));
    if (!label) return { ok: false, why: 'label not found' };
    const id = label.getAttribute('for');
    const btn = id ? document.getElementById(id) : null;
    if (!btn) return { ok: false, why: 'trigger not found', id };
    btn.click();
    return { ok: true, id };
  });
  step('port-open', opened);
  if (!opened.ok) throw new Error('could not open Cảng nâng select: ' + JSON.stringify(opened));
  await sleep(1200);
  const located = await page.evaluate(() => {
    const trigger = document.getElementById('cus-drawer-detail-lift-site-22749');
    const current = trigger?.textContent?.trim() ?? '';
    const flat = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const cur = flat(current);
    // A different value than the current one — re-picking the same value is a
    // React same-value no-op and never dirties the draft.
    const opt = [...document.querySelectorAll('[role="option"]')]
      .find((o) => !/^[+＋]/.test(o.textContent.trim()) && flat(o.textContent.trim()) !== cur);
    if (!opt) return { ok: false, current, options: [...document.querySelectorAll('[role="option"]')].slice(0, 8).map((o) => o.textContent.trim()) };
    opt.scrollIntoView({ block: 'nearest' });
    const r = opt.getBoundingClientRect();
    return { ok: true, text: opt.textContent.trim(), current, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (!located.ok) { step('port-pick', located); throw new Error('option not found: ' + JSON.stringify(located)); }
  await page.mouse.move(located.x, located.y);
  await page.mouse.down();
  await page.mouse.up();
  const picked = { ok: true, text: located.text, x: located.x, y: located.y };
  await sleep(800);
  const dirtyState = await page.evaluate(() => {
    const saveBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Lưu');
    const trigger = document.getElementById('cus-drawer-detail-lift-site-22749');
    return {
      portTriggerText: trigger?.textContent?.trim() ?? null,
      saveDisabled: saveBtn?.disabled ?? null,
      saveText: saveBtn?.textContent?.trim() ?? null,
    };
  });
  step('port-pick', { ...picked, ...dirtyState });
  if (dirtyState.saveDisabled) throw new Error('port pick did not dirty the drawer (same value or uneditable): ' + JSON.stringify(dirtyState));
  if (!picked.ok) throw new Error('option not found: ' + JSON.stringify(picked));

  // ── Phase 3: the appointment popover (autosave trigger) ──────────────
  const apptBtn = await page.evaluate(() => {
    const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('CSQU3333330'));
    const btn = row ? [...row.querySelectorAll('button')].find((b) => {
      const t = b.textContent.trim();
      return /\d{1,2}:\d{2}/.test(t) && !/^copy/i.test(t) && !/^xóa/i.test(t);
    }) : null;
    if (btn) { btn.click(); return btn.textContent.trim(); }
    return null;
  });
  await sleep(1500);
  step('appt-open', { apptBtn });
  if (!apptBtn) throw new Error('appointment trigger not found');
  // Discovery: what mounted after the click? Census popover-ish containers.
  const census = await page.evaluate(() => {
    const drawer = document.querySelector('.cus-shipment-drawer, [class*="drawer"]');
    const pick = (sel) => [...document.querySelectorAll(sel)]
      .filter((el) => !drawer || !drawer.contains(el))
      .map((el) => ({ cls: el.className?.slice?.(0, 80) ?? '', text: el.textContent?.slice(0, 120) ?? '' }));
    return {
      dialogs: pick('[role="dialog"]'),
      popovers: pick('[class*="popover" i]').slice(0, 4),
      pickers: pick('[class*="picker" i]').slice(0, 4),
      customPops: pick('[class*="c Appointment" i], [class*="appointment-pop" i], [class*="light-pop" i]').slice(0, 4),
    };
  });
  step('appt-census', census);
  const apptDrive = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const dlg = [...document.querySelectorAll('.cus-appointment-popover')].pop();
    if (!dlg) return { ok: false, why: 'appointment popover not found' };
    const save = [...dlg.querySelectorAll('button')].find((b) => /^(xác nhận|lưu)$/i.test(b.textContent.trim()));
    if (!save) return { ok: false, why: 'save button not found in popover', btns: [...dlg.querySelectorAll('button')].map((b) => b.textContent.trim()) };
    save.click();
    await sleep(2500);
    return { ok: true };
  });
  step('appt-save', apptDrive);
  if (!apptDrive.ok) throw new Error('appointment save failed: ' + JSON.stringify(apptDrive));

  // ── Phase 4: past the old 3s give-up — the drawer must STILL be open ──
  const samples = [];
  for (let i = 0; i < 9; i++) {
    await sleep(500);
    samples.push(await page.evaluate(() => ({
      t: Date.now(),
      drawerOpen: Boolean(document.querySelector('.cus-container-ledger')),
      toast: (document.querySelector('[class*="toast"], [role="status"]')?.textContent ?? '').slice(0, 80),
    })));
  }
  const after = samples[samples.length - 1];
  const retained = await page.evaluate(() => {
    const trigger = document.getElementById('cus-drawer-detail-lift-site-22749');
    const saveBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Lưu');
    return { portTriggerText: trigger?.textContent?.trim() ?? null, saveDisabled: saveBtn?.disabled ?? null };
  });
  step('after-autosave', { openAllSamples: samples.every((x) => x.drawerOpen), ...retained, toasts: samples.map((x) => x.toast).filter((v, i, a) => a.indexOf(v) === i) });
  await page.screenshot({ path: `${QA}/2026-10-07_${CARD}_ui-after-autosave.png` });
  if (!after.drawerOpen) throw new Error('drawer closed despite pending port draft');
  if (retained.saveDisabled || retained.portTriggerText !== 'Bãi Chân Thật - THT') throw new Error('port draft lost: ' + JSON.stringify(retained));

  // ── Phase 5: manual save persists the port ────────────────────────────
  const saved = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Lưu');
    if (!save) return { ok: false, btns: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /lưu/i.test(t)) };
    save.click();
    await sleep(3000);
    return { ok: true };
  });
  step('manual-save', saved);
  console.log('RUNG EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('RUNG FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
