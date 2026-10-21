// dis-03 (card 211026131857) R30 repro — kẹp 2 cont 20' báo trùng đầu kéo.
// Flow exactly as QA: /dispatch-detail → row of the SECOND 20' container of a
// lot whose first container already rides plate 60C-12345 → Sửa popup → pick
// the same truck → Lưu thay đổi → observe warn/confirm/save + grid state.
// Usage: node testplan/qa/scripts/2026-10-21-dis-r30-dis03-kep-repro.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'http://localhost:3002/api';
const BASE = process.env.QA_BASE || 'http://localhost:7175';
const OUT = path.resolve('qa/2026-10-21-dis-r30');
fs.mkdirSync(OUT, { recursive: true });
const SHIPMENT = Number(process.env.DIS03_SHIPMENT || 312291); // SHP-2610-19228 — leg2 unassigned
const CONT2 = process.env.DIS03_CONT || 'REGU0001725';

const LOG = [];
const NET = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const net = (line) => NET.push(`${new Date().toISOString()} ${line}`);
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => { results.push({ id, pass, detail }); log('RESULT', { id, pass, detail }); if (!pass) exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (identifier, password = 'Abc123') => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log('health', { status: health?.status, build: health?.buildHash });

const token = await login('dieuvan');
const dbState = async () => fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&q=${CONT2}`, { headers: { Authorization: `Bearer ${token}` } })
  .then((r) => r.json())
  .then((b) => (b.items ?? []).map((i) => ({ ful: i.fulfillmentId, cont: i.container?.containerNumber, cls: i.classification, plate: i.dispatch?.assignedPlate, status: i.taskStatus, trip: i.dispatch?.tripId, version: i.version })));

log('before_state', await dbState());

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('response', async (res) => {
    const url = res.url();
    if (/\/api\/shipments\/dispatch-detail-plan-rows\/\d+\/plan/.test(url)) {
      let b = ''; try { b = (await res.text()).slice(0, 500); } catch { /* noop */ }
      net(`${res.request().method()} ${url} -> ${res.status} ${b.slice(0, 300)}`);
      log('plan_save', { status: res.status, body: b.slice(0, 400) });
    }
    if (/\/api\/auth\/|dispatch-fleet\?/.test(url)) net(`${res.request().method()} ${url.replace(API, '')} -> ${res.status}`);
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  // ── open /dispatch-detail, widen date scope (QA fixture appointments are
  //    2027 — outside the default current-month window), then search ──
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('table.detailed-plan-grid', { timeout: 45000 });
  await sleep(1000);
  const setRange = async () => {
    const from = await page.$('[aria-label="Khoảng ngày vận chuyển"] .date-range-fields__from input');
    if (from) { await from.click(); await page.keyboard.type('01012026', { delay: 50 }); await sleep(400); }
    const to = await page.$('[aria-label="Khoảng ngày vận chuyển"] .date-range-fields__to input');
    if (to) { await to.click(); await page.keyboard.type('31122027', { delay: 50 }); await sleep(1200); }
  };
  await setRange();
  const search = await page.$('input[aria-label="Tìm nhanh"]');
  if (search) {
    await search.click({ clickCount: 3 });
    await page.keyboard.type(CONT2, { delay: 40 });
    await sleep(1500);
  } else {
    log('no_search_input_found');
  }
  await page.screenshot({ path: path.join(OUT, 'dis03-01-grid-before.png'), fullPage: false });

  // ── open the editor popup for the row ──
  const editBtn = await page.evaluate((cont) => {
    const rows = Array.from(document.querySelectorAll('.detailed-plan-grid tbody tr'));
    const row = rows.find((r) => (r.textContent || '').includes(cont));
    if (!row) return null;
    const btn = Array.from(row.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').startsWith('Sửa ô điều phối'));
    return btn ? { label: btn.getAttribute('aria-label') } : null;
  }, CONT2);
  log('edit_button', editBtn);
  if (!editBtn) throw new Error('row/edit button not found');
  await page.evaluate((cont) => {
    const rows = Array.from(document.querySelectorAll('.detailed-plan-grid tbody tr'));
    const row = rows.find((r) => (r.textContent || '').includes(cont));
    const btn = Array.from(row.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').startsWith('Sửa ô điều phối'));
    btn.click();
  }, CONT2);
  await page.waitForSelector('.dispatch-assignment-dialog', { timeout: 15000 });
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, 'dis03-02-editor-open.png'), fullPage: false });

  // ── pick the truck 60C-12345 in the vehicle select ──
  const PLATE = '60C-12345';
  let picked = null;
  for (let attempt = 0; attempt < 3 && picked == null; attempt++) {
    const opened = await page.evaluate(() => {
      const vehicleBlock = document.querySelector('.dispatch-assignment-dialog__vehicle');
      const trigger = vehicleBlock?.querySelector('button.searchable-select__trigger');
      if (trigger instanceof HTMLElement) { trigger.click(); return true; }
      return false;
    });
    await sleep(900);
    if (!opened) { log('vehicle_trigger_miss', { attempt }); continue; }
    // focus the popover's combobox search input and type the plate
    const typed = await page.evaluate(() => {
      const input = document.querySelector('.searchable-select__popover input[role="combobox"]');
      if (input instanceof HTMLInputElement) { input.focus(); return true; }
      return false;
    });
    if (!typed) { log('popover_input_miss', { attempt }); continue; }
    await page.keyboard.type(PLATE, { delay: 50 });
    await sleep(1100);
    picked = await page.evaluate((plate) => {
      const pop = document.querySelector('.searchable-select__popover');
      const opts = Array.from((pop?.querySelectorAll('[role="listbox"] button, [role="option"]')) ?? [])
        .filter((el) => el.offsetParent !== null);
      const opt = opts.find((el) => (el.textContent || '').includes(plate));
      if (opt instanceof HTMLElement) { opt.click(); return (opt.textContent || '').trim().slice(0, 90); }
      return null;
    }, PLATE);
    await sleep(500);
    if (picked == null) { await page.keyboard.press('Escape'); await sleep(400); }
  }
  log('truck_picked', { picked });
  await page.screenshot({ path: path.join(OUT, 'dis03-03-truck-picked.png'), fullPage: false });

  // ── Lưu thay đổi ──
  const saveClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const save = btns.find((b) => (b.textContent || '').includes('Lưu thay đổi') && b.offsetParent !== null);
    if (save instanceof HTMLElement) { save.click(); return true; }
    return false;
  });
  log('save_clicked', { saveClicked });
  if (!saveClicked) throw new Error('save button not found');
  await sleep(2000);
  await page.screenshot({ path: path.join(OUT, 'dis03-04-after-save-click.png'), fullPage: false });

  // ── observe: warn confirm dialog? inline error? closed? ──
  const afterSave = await page.evaluate(() => ({
    confirmVisible: !!document.querySelector('.confirm-box'),
    confirmMessage: document.querySelector('.confirm-message')?.textContent?.trim() ?? null,
    editorError: document.querySelector('.dispatch-assignment-dialog__error')?.textContent?.trim() ?? null,
    editorOpen: !!document.querySelector('.dispatch-assignment-dialog'),
  }));
  log('after_save', afterSave);

  if (afterSave.confirmVisible) {
    record('dis03: same-lot warn shows confirm dialog (warn-once contract)', true, afterSave.confirmMessage);
    await page.screenshot({ path: path.join(OUT, 'dis03-05-warn-confirm.png'), fullPage: false });
    await page.evaluate(() => {
      const btn = document.querySelector('.confirm-actions .btn--primary');
      if (btn instanceof HTMLElement) btn.click();
    });
    await sleep(2500);
    const afterConfirm = await page.evaluate(() => ({
      confirmVisible: !!document.querySelector('.confirm-box'),
      editorError: document.querySelector('.dispatch-assignment-dialog__error')?.textContent?.trim() ?? null,
      editorOpen: !!document.querySelector('.dispatch-assignment-dialog'),
    }));
    log('after_confirm', afterConfirm);
    await page.screenshot({ path: path.join(OUT, 'dis03-06-after-confirm.png'), fullPage: false });
    if (!afterConfirm.editorOpen && !afterConfirm.editorError) {
      record('dis03: confirmed retry saves — editor closes clean', true, 'popup closed');
    } else {
      record('dis03: confirmed retry saves — editor closes clean', false, JSON.stringify(afterConfirm));
    }
  } else if (afterSave.editorError) {
    record('dis03: same-lot warn shows confirm dialog (warn-once contract)', false, `inline dead-end error: ${afterSave.editorError}`);
  } else if (!afterSave.editorOpen) {
    record('dis03: same-lot warn shows confirm dialog (warn-once contract)', false, 'saved with NO warn at all (silent)');
  } else {
    record('dis03: same-lot warn shows confirm dialog (warn-once contract)', false, 'editor still open, no confirm, no error');
  }

  // ── grid state after (refresh + re-search) ──
  await sleep(1500);
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('table.detailed-plan-grid', { timeout: 45000 });
  await sleep(1000);
  await setRange();
  const s2 = await page.$('input[aria-label="Tìm nhanh"]');
  if (s2) { await s2.click({ clickCount: 3 }); await page.keyboard.type(CONT2, { delay: 40 }); await sleep(1500); }
  const gridPlate = await page.evaluate((cont) => {
    const rows = Array.from(document.querySelectorAll('.detailed-plan-grid tbody tr'));
    const row = rows.find((r) => (r.textContent || '').includes(cont));
    return row ? (row.textContent || '').includes('60C-12345') : null;
  }, CONT2);
  log('grid_after', { gridPlate });
  await page.screenshot({ path: path.join(OUT, 'dis03-07-grid-after.png'), fullPage: false });
  record('dis03: grid shows plate on second container row', gridPlate === true, `gridPlate=${gridPlate}`);

  const after = await dbState();
  log('after_state', after);
  record('dis03: DB second leg carries plate', after.some((r) => r.cont === CONT2 && r.plate === '60C-12345'), JSON.stringify(after));
} catch (err) {
  log('driver_error', { message: String(err) });
  record('dis03: driver completed', false, String(err));
  exitCode = 1;
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(OUT, 'dis03-ui-driver.log'), JSON.stringify({ results, log: LOG }, null, 2));
fs.writeFileSync(path.join(OUT, 'dis03-net.log'), NET.join('\n'));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
process.exit(exitCode);
