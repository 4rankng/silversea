// FB-038/072 chain — the UI half the dev rung could not drive: assigning the
// SAME plate to a second same-day plan row must surface the "Vẫn lưu?" confirm
// dialog, and confirming must save. API-assigns row A first; row B goes through
// the real grid editor. Restores both rows via clear=true at the end.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb038';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (r, ok, d) => { const v = ok ? 'PASS' : 'FAIL'; results.push(v); console.log(`[${v}] ${r} — ${d}`); };
const login = async (id) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) });
  if (!r.ok) throw new Error(`login ${id} ${r.status}`);
  return (await r.json()).token;
};
const tok = await login('dungnv');
const call = async (method, path, body) => {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` };
  if (method !== 'GET') headers['Idempotency-Key'] = `qa-fb038-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const r = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, ok: r.ok, json, text };
};
const TRUCK_ID = 1; const PLATE = '15E-016.26';
const RESTORE_TRUCK_ID = 43; const RESTORE_PLATE = '60C-12345'; // rows' pre-existing assignment (both rows)
const ROW_A = Number(process.env.ROW_A ?? 613);
const ROW_B = Number(process.env.ROW_B ?? 614);
const CODE_B = 'R21-KEP2X20';
try {
  const listRes = await call('GET', `/shipments/dispatch-detail-plan-rows?page=1&limit=50&dateFrom=2026-10-20&dateTo=2026-10-20`);
  const rowA0 = (listRes.json?.items ?? []).find((r) => r.fulfillmentId === ROW_A);
  const rowB0 = (listRes.json?.items ?? []).find((r) => r.fulfillmentId === ROW_B);
  if (!rowA0 || !rowB0) { console.log('ROWS MISSING', JSON.stringify(listRes.text).slice(0, 200)); process.exit(1); }
  const a = await call('PATCH', `/shipments/dispatch-detail-plan-rows/${ROW_A}/plate`, { truckId: TRUCK_ID, expectedVersion: rowA0.version });
  record('setup-rowA-api-assign', a.ok && a.json?.assignedPlate === PLATE, `PATCH ${ROW_A} → ${a.status} ${JSON.stringify(a.json)?.slice(0, 140)}`);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
  const page = await browser.newPage();
  const wire = [];
  page.on('response', async (res) => {
    const req = res.request();
    const m = req.method();
    if (m !== 'GET' && res.url().includes('/api/')) {
      let body = '';
      if (res.status() >= 400) { try { body = (await res.text()).slice(0, 300); } catch {} }
      wire.push({ m, u: res.url().replace(BASE, ''), s: res.status(), body });
    }
  });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tok);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);
  // scope the grid to the fixture row via its own quick search (the default
  // month view paginates past page 1)
  await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Tìm nhanh"]');
    if (!input) return false;
    input.focus();
    return true;
  });
  await page.keyboard.type('R21-KEP2X20', { delay: 40 });
  await sleep(2500);
  let rowFound = await page.evaluate((code) => {
    const row = [...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes(code));
    if (!row) return false;
    const btn = [...row.querySelectorAll('button')].find((b) => /phân xe lại/i.test(b.getAttribute('aria-label') || ''));
    if (!btn) return 'no-btn';
    btn.click();
    return true;
  }, CODE_B);
  if (rowFound === false || rowFound === 'no-btn') {
    const dump = await page.evaluate(() => ({
      url: location.href,
      trCount: document.querySelectorAll('tr').length,
      bodySlice: (document.body.textContent || '').slice(0, 300),
      codes: ['R21-KEP2X20'].map((c) => ({ c, present: (document.body.textContent || '').includes(c) })),
    }));
    console.log('ROW LOOKUP DUMP', JSON.stringify(dump));
    // retry: page may paginate/sort — click a matching row cell directly
    rowFound = await page.evaluate((code) => {
      const rows = [...document.querySelectorAll('tr')].filter((r) => (r.textContent || '').includes(code) && (r.textContent || '').includes('60C-12345'));
      const row = rows[0];
      if (!row) return false;
      const btn = [...row.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Sửa' || /sửa/i.test(b.getAttribute('aria-label') || ''));
      if (!btn) return 'no-btn';
      btn.click();
      return true;
    }, CODE_B);
  }
  await sleep(1500);
  record('open-rowB-editor', rowFound === true, `row ${CODE_B} editor opened=${rowFound}`);
  await page.screenshot({ path: `${SHOTS}/01-editor-open.png` });

  // TripReassignDialog — pick the same plate on the styled native select
  const picked = await page.evaluate((plate) => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return 'no-dialog';
    // DispatchPlanEditorCell modal: the plate trigger is the button showing
    // the current plate ("60C-12345 — driver").
    const trigger = [...dlg.querySelectorAll('button')].find((b) => /^[0-9]{2}[A-Z]-[0-9.]+ —/.test((b.textContent || '').trim()));
    if (trigger) { trigger.click(); return 'plate-button-clicked'; }
    const input = [...dlg.querySelectorAll('input[role="combobox"]')].find((i) => ['-- Chọn xe --','Chọn biển số xe','Chọn hoặc nhập biển số'].includes(i.placeholder || ''));
    if (!input) return 'no-trigger';
    input.focus();
    return 'trigger-focused';
  }, PLATE);
  await sleep(700);
  // click the option in the portalled listbox
  const optClicked = await page.evaluate((plate) => {
    const norm = (s2) => (s2 || '').replace(/\s+/g, '').toLowerCase();
    const o = [...document.querySelectorAll('[role="option"]')].find((el) => norm(el.textContent).includes(norm(plate)));
    if (!o) return false;
    o.scrollIntoView({ block: 'nearest' });
    o.click();
    return true;
  }, PLATE);
  // optClicked may be false — recorded as failure below
  await page.screenshot({ path: `${SHOTS}/02-plate-picked.png` });
  await sleep(700);
  await page.screenshot({ path: `${SHOTS}/02-plate-picked.png` });
  record('pick-same-plate', optClicked === true, `trigger=${picked} optionClicked=${optClicked} · ${SHOTS}/02-plate-picked.png`);

  // fill the required reason first ("Lý do điều chuyển *")
  const reasonFilled = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return false;
    const lbl = [...dlg.querySelectorAll('label')].find((l) => /lý do điều chuyển/i.test(l.textContent || ''));
    if (!lbl) return false;
    let el = lbl.parentElement; let guard = 0;
    while (el && guard++ < 5) {
      const input = el.querySelector('input, textarea');
      if (input) {
        const proto = input instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(input, 'QA test');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      el = el.parentElement;
    }
    return false;
  });
  await sleep(400);
  // commit: the cell editor modal saves via its Lưu/Cập nhật control
  const saveClicked = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const scope = dlg ?? document;
    const btn = [...scope.querySelectorAll('button')].find((b) => /^(lưu|lưu thay đổi|cập nhật|xác nhận phân xe lại)$/i.test((b.textContent || '').trim()) && !b.disabled);
    if (!btn) return 'no-save-btn';
    btn.click();
    return 'clicked';
  });
  await sleep(2500);
  await sleep(2000);
  const dlgState = await page.evaluate(() => {
    const dlgs = [...document.querySelectorAll('[role="dialog"]')];
    const confirm = dlgs.find((d) => /vẫn lưu/i.test(d.textContent || ''));
    if (!confirm) {
      const anyConfirm = [...document.querySelectorAll('div')].filter((d) => d.children.length && /vẫn lưu/i.test(d.textContent || '') && d.textContent.length < 400);
      return { confirmDialog: false, anyConfirmCount: anyConfirm.length, allDialogTexts: dlgs.map((d) => (d.textContent || '').slice(0, 150)), bodySlice: (document.body.textContent || '').slice(0, 0) };
    }
    return {
      confirmDialog: !!confirm,
      text: confirm ? (confirm.textContent || '').slice(0, 180) : null,
      buttons: confirm ? [...confirm.querySelectorAll('button')].map((b) => (b.textContent || '').trim()) : [],
    };
  });
  await page.screenshot({ path: `${SHOTS}/03-confirm-dialog.png` });
  const toast = await page.evaluate(() => (document.querySelector('.toast-container, [role="status"][class*="toast"], [aria-live]')?.textContent || '').slice(0, 160));
  console.log('WIRE after save:', JSON.stringify(wire));
  record('AC-warn-once-dialog-shows', dlgState.confirmDialog, `reason=${reasonFilled} save=${saveClicked} toast=${JSON.stringify(toast)} ` + JSON.stringify(dlgState).slice(0, 300) + ` · ${SHOTS}/03-confirm-dialog.png`);

  if (dlgState.confirmDialog) {
    const clicked = await page.evaluate(() => {
      const confirm = [...document.querySelectorAll('[role="dialog"]')].find((d) => /vẫn lưu/i.test(d.textContent || ''));
      const btn = [...(confirm?.querySelectorAll('button') ?? [])].find((b) => /xác nhận|vẫn lưu/i.test((b.textContent || '').trim()));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await sleep(3000);
    const b = await call('GET', `/shipments/dispatch-detail-plan-rows?page=1&limit=50&dateFrom=2026-10-20&dateTo=2026-10-20`);
    const rows = b.json?.items ?? [];
    const rowB = rows.find((r) => r.fulfillmentId === ROW_B);
    const plate = rowB ? (rowB.dispatch?.assignedPlate ?? rowB.assignedPlate ?? null) : 'row-not-found';
    await page.screenshot({ path: `${SHOTS}/04-after-confirm.png` });
    record('AC-confirm-saves-rowB', plate === PLATE, `after confirm: rowB plate=${plate} (expected ${PLATE}) · ${SHOTS}/04-after-confirm.png`);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await browser.close();

  // restore both rows to their pre-existing 60C-12345 assignment
  for (const id of [ROW_A, ROW_B]) {
    const rr = await call('GET', `/shipments/dispatch-detail-plan-rows?page=1&limit=50&dateFrom=2026-10-20&dateTo=2026-10-20`);
    const row = (rr.json?.items ?? []).find((r) => r.fulfillmentId === id);
    const c = row ? await call('PATCH', `/shipments/dispatch-detail-plan-rows/${id}/plate`, { truckId: RESTORE_TRUCK_ID, expectedVersion: row.version, rigOverlapCompletedConfirmed: true }) : { status: 'no-row' };
    console.log(`restore ${id}: ${c.status}`);
  }
  const v = await call('GET', `/shipments/dispatch-detail-plan-rows?page=1&limit=50&dateFrom=2026-10-20&dateTo=2026-10-20`);
  const left = (v.json?.items ?? []).filter((r) => [ROW_A, ROW_B].includes(r.fulfillmentId)).map((r) => `${r.fulfillmentId}:${r.dispatch?.assignedPlate ?? null}`);
  console.log('restored plates:', JSON.stringify(left));
} finally {
  // best-effort restore even on failure
  try {
    const t2 = tok;
    for (const id of [ROW_A, ROW_B]) {
      const lr = await fetch(`${API}/shipments/dispatch-detail-plan-rows?page=1&limit=50&dateFrom=2026-10-20&dateTo=2026-10-20`, { headers: { Authorization: `Bearer ${t2}` } });
      const row = ((await lr.json()).items ?? []).find((r) => r.fulfillmentId === id);
      if (row) await fetch(`${API}/shipments/dispatch-detail-plan-rows/${id}/plate`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t2}`, 'Idempotency-Key': `qa-fb038-restore-${id}-${Date.now()}` }, body: JSON.stringify({ truckId: RESTORE_TRUCK_ID, expectedVersion: row.version, rigOverlapCompletedConfirmed: true }) });
    }
  } catch {}
}
const fails = results.filter((v) => v === 'FAIL').length;
console.log(fails ? `=== ${fails} RUNG FAIL ===` : '=== ALL RUNGS PASS ===');
process.exit(fails ? 1 : 0);
