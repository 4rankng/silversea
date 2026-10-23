// QA R26 spot-check — FB-093 on STAGING build d39ee741 (fix 3651d0d0,
// cards 191026100833 a/b). Read-only UI drive, ketoan (ACCOUNTANT) →
// https://vantai.tingting.vip/accounting/chot-debit
//
//   a) the "Báo khách (Ảo)" BKS badge must be a real BUTTON that opens the
//      inline BKS editor seeded with the plate on screen (nothing is saved);
//   b) the "Ghép cước thu khách" button must be present and, with 2 ungrouped
//      LCL lots selected, open the merge dialog (nothing is merged).
//
// Context the drive has to reproduce first (both are screen behaviour, not
// defects): the board opens on the ESSENTIAL column set, so the "Phân xe"
// column that carries the badge is off until the "Cột" picker turns it on;
// and the badge only renders when the billing plate differs from the actual
// one. Candidates are read read-only from the board wire before driving:
// GAP-TEST-01 / GAP-TEST-03 (2026-10-20, LONG MINH, lẻ chưa ghép, billing
// 15C-99999/15C-88888 ≠ actual 15C-11111/15C-22222).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { stagingPassword } from './creds.mjs';

const require = createRequire('/Volumes/LexarSSD/projects/silversea/package.json');
const puppeteer = require('puppeteer');

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = path.resolve(import.meta.dirname);
const NEEDLE = 'GAP-TEST';
const BADGE_LOT = 'GAP-TEST-01';
const MERGE_LOTS = ['GAP-TEST-01', 'GAP-TEST-03'];

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const flush = () => fs.writeFileSync(`${OUT}/fb093-ui-driver.log`, `${LOG.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await (await fetch(`${API}/health`)).json();
log('build_gate', { buildHash: health.buildHash, expect: 'd39ee741', base: BASE });
if (health.buildHash !== 'd39ee741') { log('STOP_buildHash_mismatch', { got: health.buildHash }); flush(); process.exit(2); }

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'ketoan', password: stagingPassword() }),
});
if (!loginRes.ok) { log('STOP_login', { status: loginRes.status }); flush(); process.exit(2); }
const { token, user } = await loginRes.json();
log('login', { username: user?.username, role: user?.role });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1760, height: 1150 });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);

const stamp = async (label) => {
  await page.evaluate((text) => {
    let el = document.getElementById('qa-url-stamp');
    if (!el) {
      el = document.createElement('div');
      el.id = 'qa-url-stamp';
      el.style.cssText = 'position:fixed;top:6px;left:6px;z-index:2147483647;background:#000;color:#4ade80;'
        + 'font:13px/1.45 ui-monospace,Menlo,monospace;padding:7px 11px;border:2px solid #4ade80;'
        + 'border-radius:4px;max-width:92vw;white-space:pre-wrap;word-break:break-all;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = text;
  }, `${label}\nURL: ${page.url()}\nbuild d39ee741 · QA R26 · ${new Date().toISOString()}`);
};

/** Real pointer click with a hit-test report (no blind clicks). */
const clickPoint = async (x, y) => page.evaluate((px, py) => {
  const el = document.elementFromPoint(px, py);
  return el ? { tag: el.tagName, cls: (el.className || '').toString().slice(0, 80), text: (el.textContent || '').trim().slice(0, 60) } : null;
}, x, y);

const findButton = (matchText) => page.evaluate((needle) => {
  const btns = [...document.querySelectorAll('button')];
  const hit = btns.find((b) => (b.textContent ?? '').trim() === needle) ?? null;
  if (!hit) return { present: false };
  hit.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = hit.getBoundingClientRect();
  return {
    present: true,
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    ariaDisabled: hit.getAttribute('aria-disabled'),
    disabledProp: Boolean(hit.disabled),
    tagName: hit.tagName,
  };
}, matchText);

// ── Open the board + scope the search ────────────────────────────────────────
await page.goto(`${BASE}/accounting/chot-debit`, { waitUntil: 'networkidle2', timeout: 90000 });
await sleep(4500);
try {
  await page.waitForSelector('[aria-label="Bảng kế hoạch điều động tổng hợp"] tbody tr', { timeout: 25000 });
} catch {
  log('board_selector_wait_failed', { url: page.url() });
}
await page.type('input[aria-label="Tìm lô hàng"]', NEEDLE, { delay: 30 });
await sleep(2500);

const beforePicker = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('[aria-label="Bảng kế hoạch điều động tổng hợp"] tbody tr')]
    .map((r) => (r.textContent ?? '').slice(0, 80)),
  badges: document.querySelectorAll('.debit-billing-badge').length,
  phanXeHeaders: [...document.querySelectorAll('th')].map((th) => (th.textContent ?? '').trim()).filter((t) => t === 'Phân xe'),
}));
log('board_before_column_picker', { ...beforePicker });

// ── Turn on the "Phân xe" column (board opens on the essential set) ──────────
const pickerTrigger = await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label^="Cột hiển thị"]') ?? null;
  if (!btn) return { found: false };
  const r = btn.getBoundingClientRect();
  return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2, ariaLabel: btn.getAttribute('aria-label') };
});
log('column_picker_trigger', { ...pickerTrigger });
let picker = { opened: false, toggled: false };
if (pickerTrigger.found) {
  await page.mouse.click(pickerTrigger.x, pickerTrigger.y);
  await sleep(1200);
  picker = await page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"][aria-label="Cột hiển thị"]');
    if (!panel) return { opened: false };
    const labels = [...panel.querySelectorAll('.column-picker__option-label')].map((s) => (s.textContent ?? '').trim());
    const target = [...panel.querySelectorAll('.column-picker__option-label')]
      .find((s) => (s.textContent ?? '').trim() === 'Phân xe') ?? null;
    if (!target) return { opened: true, labels, targetPresent: false };
    const box = target.closest('label') ?? target.parentElement;
    const r = box.getBoundingClientRect();
    return {
      opened: true,
      labels,
      targetPresent: true,
      alreadyOn: Boolean(box.querySelector('input')?.checked ?? box.getAttribute('aria-checked') === 'true'),
      x: r.left + Math.min(r.width / 2, 40),
      y: r.top + r.height / 2,
    };
  });
  log('column_picker_panel', { ...picker });
  if (picker.opened && picker.targetPresent && !picker.alreadyOn) {
    await page.mouse.click(picker.x, picker.y);
    picker.toggled = true;
    await sleep(1200);
  }
  await page.keyboard.press('Escape');
  await sleep(900);
}
try {
  await page.waitForSelector('.debit-billing-badge', { timeout: 8000 });
} catch {
  log('badge_wait_failed', { url: page.url() });
}

// ── Board state with the badge visible ───────────────────────────────────────
const board = await page.evaluate(() => {
  const table = document.querySelector('[aria-label="Bảng kế hoạch điều động tổng hợp"]');
  const rows = table ? [...table.querySelectorAll('tbody tr')] : [];
  const headers = table ? [...table.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').trim()) : [];
  const badges = [...document.querySelectorAll('.debit-billing-badge')].map((b) => ({
    tag: b.tagName,
    type: b.getAttribute('type'),
    ariaLabel: b.getAttribute('aria-label'),
    title: b.getAttribute('title'),
    ariaExpanded: b.getAttribute('aria-expanded'),
    text: (b.textContent ?? '').trim(),
    rowText: (b.closest('tr')?.textContent ?? '').slice(0, 120),
    rect: (() => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })(),
  }));
  const mergeBtn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Ghép cước thu khách') ?? null;
  return {
    pathname: location.pathname + location.search,
    searchValue: document.querySelector('input[aria-label="Tìm lô hàng"]')?.value ?? null,
    boardRows: rows.length,
    headers,
    rowLabels: rows.map((r) => (r.textContent ?? '').slice(0, 90)),
    badges,
    mergeButton: mergeBtn ? { present: true, ariaDisabled: mergeBtn.getAttribute('aria-disabled') } : { present: false },
    selectedStrip: [...document.querySelectorAll('.debit-note')].map((n) => (n.textContent ?? '').trim()).slice(0, 4),
  };
});
log('board_loaded', { ...board, picker, consoleErrors });

await stamp('FB-093 · /accounting/chot-debit · badge "Báo khách (Ảo)" + nút "Ghép cước thu khách"');
await page.screenshot({ path: `${OUT}/fb093-01-board-bks-and-merge-button.png` });
fs.writeFileSync(`${OUT}/fb093-01-board-dom.txt`,
  `URL: ${board.pathname}\nsearch: ${board.searchValue}\nboardRows: ${board.boardRows}\n`
  + `columnPicker: ${JSON.stringify(picker)}\nheaders: ${JSON.stringify(board.headers)}\n`
  + `badges: ${JSON.stringify(board.badges, null, 2)}\nmergeButton: ${JSON.stringify(board.mergeButton)}\n`
  + `rows:\n${board.rowLabels.join('\n')}\n`, 'utf8');

const results = [];

// ── (a) badge → BKS editor ────────────────────────────────────────────────────
const badge = board.badges.find((b) => b.rowText.includes(BADGE_LOT)) ?? board.badges[0] ?? null;
const badgeIsButton = badge != null && badge.tag === 'BUTTON' && badge.type === 'button';
log('badge_probe', { badgeCount: board.badges.length, badgeIsButton, badge });

if (badge) {
  const hit = await clickPoint(badge.rect.x, badge.rect.y);
  log('badge_click_hit_test', { hit });
  await page.mouse.click(badge.rect.x, badge.rect.y);
  await sleep(1800);
  const editor = await page.evaluate(() => {
    const panel = [...document.querySelectorAll('section[aria-label]')]
      .find((s) => (s.getAttribute('aria-label') ?? '').startsWith('Sửa BKS báo khách')) ?? null;
    if (!panel) return { open: false };
    const input = panel.querySelector('input');
    const buttons = [...panel.querySelectorAll('button')].map((b) => ({
      ariaLabel: b.getAttribute('aria-label'),
      text: (b.textContent ?? '').trim(),
      disabled: Boolean(b.disabled) || b.getAttribute('aria-disabled') === 'true',
    }));
    return {
      open: true,
      panelLabel: panel.getAttribute('aria-label'),
      inputValue: input ? input.value : null,
      buttons,
      panelText: (panel.innerText ?? '').slice(0, 400),
      badgeExpanded: document.querySelector('.debit-billing-badge')?.getAttribute('aria-expanded') ?? null,
    };
  });
  log('bks_editor_after_badge_click', { ...editor });

  await stamp('FB-093 · badge "Báo khách (Ảo)" là <button> → panel "Sửa BKS báo khách" (seeded, CHƯA Lưu)');
  await page.screenshot({ path: `${OUT}/fb093-02-bks-editor-panel.png` });
  fs.writeFileSync(`${OUT}/fb093-02-bks-editor-dom.txt`,
    `URL: ${page.url()}\neditor: ${JSON.stringify(editor, null, 2)}\n\n${await page.evaluate(() => document.body.innerText)}`, 'utf8');

  results.push({
    check: 'FB-093-a · badge "Báo khách (Ảo)" là <button>, click mở panel "Sửa BKS báo khách" seeded + nút Lưu/Hủy',
    pass: Boolean(badgeIsButton && editor.open && editor.inputValue && editor.inputValue.trim().length > 0
      && (editor.buttons ?? []).some((b) => (b.ariaLabel ?? '').startsWith('Lưu'))
      && (editor.buttons ?? []).some((b) => (b.ariaLabel ?? '').startsWith('Hủy'))),
    badgeIsButton,
    badgeText: badge.text,
    editor,
  });

  const cancel = await page.evaluate(() => {
    const panel = [...document.querySelectorAll('section[aria-label]')]
      .find((s) => (s.getAttribute('aria-label') ?? '').startsWith('Sửa BKS báo khách'));
    if (!panel) return null;
    const btn = [...panel.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Hủy'));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: btn.getAttribute('aria-label') };
  });
  if (cancel) {
    await page.mouse.click(cancel.x, cancel.y);
    await sleep(1200);
  }
  const editorClosed = await page.evaluate(() => !document.querySelector('section[aria-label^="Sửa BKS báo khách"]'));
  log('editor_closed_without_save', { cancelled: Boolean(cancel), editorClosed });
} else {
  results.push({
    check: 'FB-093-a · badge "Báo khách (Ảo)" là <button>, click mở panel "Sửa BKS báo khách" seeded + nút Lưu/Hủy',
    pass: false,
    error: 'no .debit-billing-badge on the filtered board after enabling Phân xe',
    badges: board.badges,
  });
}

// ── (b) Ghép cước thu khách → merge dialog ───────────────────────────────────
const mergeBefore = await findButton('Ghép cước thu khách');
log('merge_button_before_selection', { ...mergeBefore });

const selection = { attempted: 0, ok: 0, perLot: [] };
for (const lot of MERGE_LOTS) {
  const rect = await page.evaluate((needle) => {
    const table = document.querySelector('[aria-label="Bảng kế hoạch điều động tổng hợp"]');
    const rows = table ? [...table.querySelectorAll('tbody tr')] : [];
    const row = rows.find((r) => (r.textContent ?? '').includes(needle));
    if (!row) return null;
    const tds = [...row.querySelectorAll('td')];
    const plain = tds.find((td) => !td.querySelector('button,input,select,textarea,a,[role="button"]')
      && !/__(select|action)/.test(td.className)) ?? tds[0];
    if (!plain) return null;
    plain.scrollIntoView({ block: 'center', behavior: 'instant' });
    return { text: (row.textContent ?? '').slice(0, 90) };
  }, lot);
  selection.attempted += 1;
  if (!rect) { selection.perLot.push({ lot, found: false }); continue; }
  await sleep(600);
  const point = await page.evaluate((needle) => {
    const table = document.querySelector('[aria-label="Bảng kế hoạch điều động tổng hợp"]');
    const rows = table ? [...table.querySelectorAll('tbody tr')] : [];
    const row = rows.find((r) => (r.textContent ?? '').includes(needle));
    if (!row) return null;
    const tds = [...row.querySelectorAll('td')];
    const plain = tds.find((td) => !td.querySelector('button,input,select,textarea,a,[role="button"]')
      && !/__(select|action)/.test(td.className)) ?? tds[0];
    const r = plain.getBoundingClientRect();
    const x = r.left + Math.min(r.width / 2, 80);
    const y = r.top + r.height / 2;
    const el = document.elementFromPoint(x, y);
    return { x, y, inside: Boolean(el && plain.contains(el)), alreadySelected: row.getAttribute('data-selected') === 'true' };
  }, lot);
  if (point && point.inside && !point.alreadySelected) {
    await page.mouse.click(point.x, point.y);
    selection.ok += 1;
    selection.perLot.push({ lot, found: true, clicked: true });
    await sleep(900);
  } else {
    selection.perLot.push({ lot, found: true, clicked: false, ...point });
  }
}
const afterSelect = await page.evaluate(() => ({
  selectedStrip: [...document.querySelectorAll('.debit-note')].map((n) => (n.textContent ?? '').trim()).slice(0, 5),
  selectedRows: document.querySelectorAll('[aria-label="Bảng kế hoạch điều động tổng hợp"] tbody tr[data-selected]').length,
  mergeButton: (() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === 'Ghép cước thu khách');
    return b ? { present: true, ariaDisabled: b.getAttribute('aria-disabled') } : { present: false };
  })(),
}));
log('after_row_selection', { ...selection, ...afterSelect });

const mergeAfter = await findButton('Ghép cước thu khách');
let dialog = { open: false };
if (mergeAfter.present && mergeAfter.ariaDisabled == null && !mergeAfter.disabledProp) {
  const hit = await clickPoint(mergeAfter.x, mergeAfter.y);
  log('merge_click_hit_test', { hit });
  await page.mouse.click(mergeAfter.x, mergeAfter.y);
  await sleep(2200);
  dialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return { open: false };
    return {
      open: true,
      title: d.querySelector('h2, h3')?.textContent?.trim() ?? null,
      text: (d.innerText ?? '').slice(0, 700),
      lotLines: [...d.querySelectorAll('.merge-rev-group__lots li')].map((li) => (li.textContent ?? '').trim()),
      buttons: [...d.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()).slice(0, 12),
    };
  });
  log('merge_dialog', { ...dialog });
  await stamp('FB-093 · 2 lô lẻ chưa ghép đã chọn → "Ghép cước thu khách" mở dialog (CHƯA xác nhận ghép)');
  await page.screenshot({ path: `${OUT}/fb093-03-merge-dialog.png` });
  fs.writeFileSync(`${OUT}/fb093-03-merge-dialog-dom.txt`,
    `URL: ${page.url()}\ndialog: ${JSON.stringify(dialog, null, 2)}\n\n${await page.evaluate(() => document.body.innerText)}`, 'utf8');

  const cancelDialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    const btn = [...d.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Hủy') ?? null;
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: btn.getAttribute('aria-label') || btn.textContent.trim() };
  });
  if (cancelDialog) {
    await page.mouse.click(cancelDialog.x, cancelDialog.y);
    await sleep(1200);
  }
  const dialogGone = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
  log('merge_dialog_closed_without_merge', { cancelled: Boolean(cancelDialog), dialogGone });
}
results.push({
  check: 'FB-093-b · nút "Ghép cước thu khách" hiện và click mở được dialog ghép (2 lô lẻ chưa ghép)',
  pass: Boolean(mergeBefore.present && afterSelect.mergeButton.present
    && afterSelect.mergeButton.ariaDisabled == null && dialog.open),
  mergeBefore,
  afterSelect,
  dialog,
});

log('verdict', { results, allPass: results.every((r) => r.pass), consoleErrors });
flush();
await browser.close();
log('done', {});
flush();
