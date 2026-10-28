/**
 * SIL-552 UI drive — Thông tin hàng sheet (CUS lot drawer): the SỐ CONTAINER
 * cell's locked geometry + the sheet's fixed column geometry.
 *
 * Logs in as the local CUS demo account (testplan/testaccounts.txt; admin
 * fallback), injects the JWT BEFORE any page load (puppeteer-spa-auth law),
 * opens the first lot drawer on /shipments and captures:
 *   - the SỐ CONTAINER cell close-up + the whole sheet at 1280,
 *   - the geometry of every group line (label lane, control lane, heights),
 *   - the BASELINE band: the label's text box vs the control's text box on
 *     the same row (the reported "lệch baseline với SỐ TỜ KHAI"),
 *   - the no-shredding check (a control narrower than 60px = a placeholder
 *     broken into vertical characters),
 *   - the sheet's column geometry (colgroup widths, 1456px floor, h-scroll
 *     inside the card, page does NOT scroll),
 *   - a real click-to-edit on the TRỌNG LƯỢNG line: trigger → editor (a
 *     number input + the kg unit) → Enter → container-line POST → toast →
 *     the persisted value read back from the API (side-effect proof), then
 *     RESTORED to the original value.
 *
 * Usage: node qa/2026-10-28_sil552-tthang/drive.mjs <baseUrl> <tag>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:7188';
const TAG = process.argv[3] ?? 'after';
const API = 'http://localhost:3002/api';
const OUT = 'qa/2026-10-28_sil552-tthang';
const WIDTH = Number(process.env.WIDTH ?? 1280);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function tryLogin(username) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password: 'Abc123' }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.token ?? null;
}

let token = await tryLogin('cus');
let account = 'cus';
if (!token) { token = await tryLogin('admin'); account = 'admin'; }
if (!token) throw new Error('login failed for cus and admin');
console.log(`logged in as ${account}`);

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const report = { base: BASE, tag: TAG, account, width: WIDTH, geometry: null, edit: null };
const containerResponses = [];

/** Opens the first lot drawer that actually HAS containers — the list order
 *  changes with the date filter, and a lot without containers renders the
 *  empty state instead of the sheet. */
async function openLotWithContainers(page) {
  const buttons = await page.$$('button[aria-label*="Mở chi tiết lô hàng"]');
  for (let i = 0; i < Math.min(buttons.length, 12); i += 1) {
    await buttons[i].click();
    try {
      await page.waitForSelector('.cus-lot-table', { timeout: 4000 });
      await new Promise((r) => setTimeout(r, 1200));
      return true;
    } catch {
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return false;
}

try {
  const page = await browser.newPage();
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/cus-workspace/') && url.includes('/containers/')) {
      containerResponses.push({ status: res.status(), url: url.replace(BASE, ''), method: res.request().method() });
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: WIDTH, height: 900, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('button[aria-label*="Mở chi tiết lô hàng"]', { timeout: 30000 });
  if (!(await openLotWithContainers(page))) throw new Error('no lot with containers opened');

  report.geometry = await page.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100;
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: round(r.width), h: round(r.height), x: round(r.x), y: round(r.y), bottom: round(r.bottom) };
    };
    // The TEXT box of an element (its baseline band), measured through a Range.
    const textBox = (el) => {
      if (!el) return null;
      const node = [...el.childNodes].find((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
      if (!node) return null;
      const range = document.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      return { top: round(r.top), bottom: round(r.bottom), h: round(r.height) };
    };
    const group = document.querySelector('.cus-lot-contgroup');
    const groupCell = group ? group.closest('td') : null;
    const lines = group
      ? [...group.querySelectorAll('.cus-lot-line')].map((line) => {
          const label = line.querySelector('.cus-lot-line__label');
          const labelText = textBox(label);
          // The control: the trigger button, the select trigger, or the editor input.
          const control = line.querySelector('button.cus-lot-line--trigger, [data-uui-control], .cus-lot-line__input');
          const controlText =
            control?.querySelector('.cus-lot-line__value') ??
            control?.querySelector('[data-uui-select-value] p') ??
            control;
          const controlTextBox = textBox(controlText);
          const cs = label ? getComputedStyle(label) : null;
          return {
            line: box(line),
            label: box(label),
            labelText: labelText,
            labelWhiteSpace: cs ? cs.whiteSpace : null,
            labelFlexShrink: cs ? cs.flexShrink : null,
            control: box(control),
            controlText: controlTextBox,
            // A placeholder shredded into vertical characters shows a control
            // far narrower than it is tall.
            shredded: control ? control.getBoundingClientRect().width < 60 : null,
            // The baseline band: the label's text bottom vs the control's.
            baselineDelta: labelText && controlTextBox ? round(Math.abs(labelText.bottom - controlTextBox.bottom)) : null,
          };
        })
      : [];
    const cols = [...document.querySelectorAll('.cus-lot-table colgroup col')].map((c) => round(c.getBoundingClientRect().width));
    const scroll = document.querySelector('.cus-lot-table-scroll');
    const declInput = document.querySelector('.cus-lot-decl__input');
    const tableEl = document.querySelector('.cus-lot-table');
    const tableCs = tableEl ? getComputedStyle(tableEl) : null;
    const cellCs = groupCell ? getComputedStyle(groupCell) : null;
    const typeValue = document.querySelector('.cus-lot-line--type [data-uui-select-value] p');
    return {
      headers: [...document.querySelectorAll('.cus-lot-table thead th')].map((th) => th.textContent.trim()),
      cols,
      tableMinWidth: tableCs ? tableCs.minWidth : null,
      tableLayout: tableCs ? tableCs.tableLayout : null,
      groupCell: box(groupCell),
      groupCellVerticalAlign: cellCs ? cellCs.verticalAlign : null,
      groupCellPadding: cellCs ? `${cellCs.paddingTop} ${cellCs.paddingRight} ${cellCs.paddingBottom} ${cellCs.paddingLeft}` : null,
      lines,
      typeValueText: typeValue ? typeValue.textContent.trim() : null,
      typeValueClipped: typeValue ? typeValue.scrollWidth > typeValue.clientWidth : null,
      declInput: box(declInput),
      declPlaceholder: declInput ? declInput.placeholder : null,
      scroll: scroll ? { scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth, overflowsX: scroll.scrollWidth > scroll.clientWidth } : null,
      pageScroll: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    };
  });

  // Screenshot the cargo card, then the SỐ CONTAINER cell alone.
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.cus-lot-card')].find((el) => el.textContent.includes('Thông tin hàng'));
    card?.scrollIntoView({ block: 'start' });
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: `${OUT}/sil552_${TAG}_${WIDTH}_table.png`, fullPage: false });

  const cellBox = await page.evaluate(() => {
    const cell = document.querySelector('.cus-lot-contgroup')?.closest('td');
    if (!cell) return null;
    const r = cell.getBoundingClientRect();
    const x = Math.max(0, r.x - 12);
    const y = Math.max(0, r.y - 12);
    return { x, y, width: Math.min(window.innerWidth - x, r.width + 24), height: r.height + 24 };
  });
  if (cellBox) await page.screenshot({ path: `${OUT}/sil552_${TAG}_${WIDTH}_cell.png`, clip: cellBox });

  // ── Click-to-edit drive on the TRỌNG LƯỢNG line ──
  const drawerId = await page.evaluate(() => {
    const el = document.querySelector('[id^="cus-detail-drawer-"]');
    return el ? Number(el.id.replace('cus-detail-drawer-', '')) : null;
  });
  if (drawerId == null) throw new Error('drawer not open');
  const original = await page.evaluate(async (shipmentId) => {
    const res = await fetch(`/api/shipments/cus-workspace/${shipmentId}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const detail = await res.json();
    const line = (detail.containers ?? [])[0];
    return line
      ? { shipmentId: detail.summary.id, containerId: line.id, ordinal: line.ordinal, weight: line.raw.cargoWeightKg, version: detail.summary.version, fieldAccessMode: line.fieldAccess?.cargoWeightKg?.mode ?? null }
      : null;
  }, drawerId);
  if (!original) throw new Error(`lot ${drawerId} has no container line`);

  const triggerLabel = `Chỉnh sửa trọng lượng — dòng ${original.ordinal}`;
  await page.waitForFunction((label) => {
    return [...document.querySelectorAll('.cus-lot-contgroup button')].some((b) => b.getAttribute('aria-label') === label);
  }, { timeout: 15000 }, triggerLabel);

  await page.evaluate((label) => {
    const trigger = [...document.querySelectorAll('.cus-lot-contgroup button')].find((b) => b.getAttribute('aria-label') === label);
    trigger.click();
  }, triggerLabel);
  await page.waitForSelector('.cus-lot-editor input', { timeout: 5000 });

  const editor = await page.evaluate(() => {
    const editorEl = document.querySelector('.cus-lot-editor');
    const input = editorEl?.querySelector('input');
    const unit = editorEl?.querySelector('.cus-lot-editor__unit');
    const save = editorEl?.querySelector('.cus-lot-editor__save');
    const arrow = editorEl?.querySelector('.cus-lot-editor__arrow');
    const r = input?.getBoundingClientRect();
    const panel = editorEl?.getBoundingClientRect();
    return {
      panelRole: editorEl?.getAttribute('role') ?? null,
      panelLabel: editorEl?.getAttribute('aria-label') ?? null,
      panelInsideTable: editorEl ? Boolean(editorEl.closest('.cus-lot-table')) : null,
      panelParentIsBody: editorEl?.parentElement === document.body,
      panelWidth: panel ? Math.round(panel.width * 100) / 100 : null,
      hasArrow: Boolean(arrow),
      inputType: input?.type ?? null,
      inputMin: input?.getAttribute('min') ?? null,
      inputWidth: r ? Math.round(r.width * 100) / 100 : null,
      unit: unit?.textContent ?? null,
      saveLabel: save?.textContent ?? null,
    };
  });
  await page.screenshot({ path: `${OUT}/sil552_${TAG}_${WIDTH}_edit-open.png`, fullPage: false });

  if (original.fieldAccessMode !== 'DIRECT') {
    report.edit = { skipped: true, reason: `fieldAccess.cargoWeightKg=${original.fieldAccessMode} for ${account}`, editor };
    console.log(`EDIT SKIPPED: fieldAccess=${original.fieldAccessMode}`);
  } else {
    const nextWeight = '13579';
    // The floating input keeps the FIELD name; the trigger carries the action.
    const fieldLabel = `Trọng lượng — dòng ${original.ordinal}`;
    await page.evaluate((label) => {
      const input = document.querySelector(`.cus-lot-editor input[aria-label="${label}"]`);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '13579');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, fieldLabel);
    await page.keyboard.press('Enter');

    await page.waitForFunction(() => {
      return [...document.querySelectorAll('body *')].some((el) => el.children.length === 0 && /Đã lưu trọng lượng/.test(el.textContent ?? ''));
    }, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: `${OUT}/sil552_${TAG}_${WIDTH}_edit-saved.png`, fullPage: false });

    const postSave = await page.evaluate(async (shipmentId) => {
      const res = await fetch(`/api/shipments/cus-workspace/${shipmentId}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const detail = await res.json();
      return { weight: detail.containers?.[0]?.raw?.cargoWeightKg ?? null, notice: document.body.textContent.includes('Đã lưu trọng lượng') };
    }, drawerId);
    report.edit = {
      original: original.weight,
      sent: nextWeight,
      editor,
      apiResponses: containerResponses,
      persistedAfterSave: postSave.weight,
      toastSeen: postSave.notice,
      persistedMatch: postSave.weight === '13579.00',
    };
    console.log(`EDIT: ${original.weight} -> ${postSave.weight} (toast=${postSave.notice}) responses=${JSON.stringify(containerResponses)}`);

    // Restore the original value so local data stays as found.
    const restoreKey = `restore-${Date.now()}`;
    const currentVersion = (await (await fetch(`${API}/shipments/cus-workspace/${original.shipmentId}`, { headers: { Authorization: `Bearer ${token}` } })).json()).summary.version;
    const restore = await fetch(`${API}/shipments/cus-workspace/${original.shipmentId}/containers/${original.containerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': restoreKey },
      body: JSON.stringify({ expectedShipmentVersion: currentVersion, cargoWeightKg: original.weight }),
    });
    const restored = (await (await fetch(`${API}/shipments/cus-workspace/${original.shipmentId}`, { headers: { Authorization: `Bearer ${token}` } })).json()).containers?.[0]?.raw?.cargoWeightKg ?? null;
    report.restore = { status: restore.status, value: original.weight, readBack: restored };
    console.log(`RESTORE: ${restore.status} → ${restored}`);
  }

  writeFileSync(`${OUT}/sil552_${TAG}_report.json`, JSON.stringify(report, null, 2));
  console.log('REPORT WRITTEN');
  console.log(JSON.stringify({ geometry: report.geometry, edit: report.edit, restore: report.restore }, null, 2));
} finally {
  await browser.close();
}
