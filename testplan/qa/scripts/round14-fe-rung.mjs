// Round-14 consolidated FE rung (rung 3) — the six frontend fixes driven
// through their real controls on LOCAL dev:
//   FB-006 (case …R14-01): picker cell collapses to name + magnifier at BOTH
//     desktop and the ≤1037px stacked container band (carve-out reversal).
//   FB-008 (…R14-02): bulk "Ngày giờ đóng trả" control fills every row without
//     a schedule and leaves set rows alone.
//   FB-009 (…R14-03): copy affordance survives partial-draft destinations and
//     the copy replaces the draft visibly.
//   FB-050 (…R14-05): the top-trucks chart draws real X-axis ticks.
//   FB-057 (…R14-07): topbar search 360px at rest, expands on focus.
//   FB-051 (…R14-06): penalty create + cancel both fire success toasts
//     (net-zero-ish: one test penalty, immediately canceled).
//
// Evidence: qa/2026-10-11_round14-fe_ui-driver.log + qa/…_ui-*.png
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const EV = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const DRIVER_LOG = `${EV}/2026-10-11_round14-fe_ui-driver.log`;
mkdirSync(EV, { recursive: true });
writeFileSync(DRIVER_LOG, '');
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(DRIVER_LOG, line + '\\n');
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} failed: ${res.status}`);
  return (await res.json()).token;
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const results = {};
const run = async (name, fn) => {
  try {
    results[name] = await fn();
    step('claim-done', { claim: name, ok: true });
  } catch (err) {
    results[name] = { error: String(err) };
    step('claim-done', { claim: name, ok: false, error: String(err) });
  }
};

// Shared create-form setup: customer picked, N container rows added.
const setupCreateForm = async (page, token, rows) => {
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
  await page.waitForFunction(() => document.body.innerText.includes('Khách hàng'), { timeout: 90000 });
  const custInput = await page.evaluateHandle(() => {
    const lbl = [...document.querySelectorAll('label')].find((l) => (l.textContent || '').includes('Khách hàng'));
    return (lbl?.closest('div') ?? document).querySelector('input, [role="combobox"]');
  });
  await custInput.asElement().click();
  await page.keyboard.type('Long Minh');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="option"]')].some((o) => (o.textContent || '').toLowerCase().includes('long minh')), { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || '').toLowerCase().includes('long minh'))?.click());
  await sleep(1200);
  for (let i = 0; i < rows; i += 1) {
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Thêm container')?.click());
    await sleep(500);
  }
};

// ─── FB-006: picker collapse at both container bands ────────────────────────
await run('fb006-picker-collapse', async () => {
  const token = await login('thanhdc');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await setupCreateForm(page, token, 1);
  await page.waitForSelector('input[placeholder="Chọn nhà máy"]', { timeout: 60000 });
  await (await page.$('input[placeholder="Chọn nhà máy"]')).click();
  await sleep(800);
  const optionLabel = await page.evaluate(() => document.querySelector('[role="option"]')?.textContent?.trim().slice(0, 40) ?? null);
  await page.evaluate(() => document.querySelector('[role="option"]')?.click());
  await sleep(900);
  const probeFn = () => {
    const cell = document.querySelector('td[data-field-id$="-factory"]') || document.querySelector('.csc-container-cell');
    const display = cell?.querySelector('[class*="__display"]');
    const editorChild = cell?.querySelector('[class*="__editor"]')?.firstElementChild;
    const op = (el) => (el ? getComputedStyle(el).opacity : 'absent');
    return {
      pickerClass: Boolean(cell?.classList.contains('csc-container-cell--picker')),
      displayText: display?.textContent?.trim().slice(0, 30) ?? null,
      displayOpacity: op(display),
      editorChildOpacity: op(editorChild),
      tableWidth: cell ? Math.round((cell.closest('table') ?? cell).getBoundingClientRect().width) : null,
    };
  };
  const at1440 = await page.evaluate(probeFn);
  await page.screenshot({ path: `${EV}/2026-10-11_round14-fe_ui-fb006-1440.png` });
  await page.setViewport({ width: 1024, height: 900 });
  await sleep(800);
  const at1024 = await page.evaluate(probeFn);
  await page.screenshot({ path: `${EV}/2026-10-11_round14-fe_ui-fb006-1024.png` });
  step('fb006', { optionLabel, at1440, at1024 });
  assert.equal(at1440.editorChildOpacity, '0', 'desktop: editor collapsed after pick');
  assert.equal(at1024.editorChildOpacity, '0', 'stacked band: editor collapsed after pick (carve-out reversal, case R14-01)');
  assert.equal(at1440.displayText, optionLabel, 'picked name displayed');
  await page.close();
  return { at1440, at1024 };
});

// ─── FB-008 + FB-009: bulk date control, then the copy affordance ───────────
await run('fb009-fb008-copy-and-bulk', async () => {
  const token = await login('thanhdc');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await setupCreateForm(page, token, 3);
  await sleep(600);
  // Row 1: complete appointment typed through the visible segments.
  const segValues = { hh: '09', mm: '00', dd: '20', mm2: '10', yyyy: '2026' };
  for (const [seg, val] of Object.entries(segValues)) {
    const el = await page.$(`tr.csc-container-row input[data-seg="${seg}"]`);
    if (el) { await el.click({ clickCount: 3 }); await el.type(val); }
  }
  await page.keyboard.press('Tab');
  await sleep(600);

  // FB-008 first (rows 2–3 still empty): the bulk control fills them and
  // leaves the set row alone. The control unmounts when nothing is left to
  // fill, so its claim runs while destinations exist.
  const bulkDate = await page.$('input[id$="-bulk-appointment-date"]');
  const bulkTime = await page.$('input[id$="-bulk-appointment-time"]');
  assert.ok(bulkDate && bulkTime, 'bulk date control rendered while rows lack a schedule (case R14-02)');
  // Segments are maxLength'd per part — fill them one by one like a user.
  const fillBulkSeg = async (seg, val) => {
    const h = await page.evaluateHandle((s) => (
      [...document.querySelectorAll(`input[data-seg="${s}"]`)].find((i) => !i.closest('tr.csc-container-row')) ?? null
    ), seg);
    if (h.asElement()) { await h.asElement().click({ clickCount: 3 }); await h.asElement().type(val); }
  };
  await fillBulkSeg('dd', '25');
  await fillBulkSeg('mm2', '12');
  await fillBulkSeg('yyyy', '2026');
  await fillBulkSeg('hh', '14');
  await fillBulkSeg('mm', '30');
  await page.keyboard.press('Tab');
  await sleep(500);
  const applyClicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /^Áp dụng cho \d+ container/.test((b.innerText || '').trim()));
    if (!btn) return null;
    const label = btn.innerText.trim();
    btn.click();
    return label;
  });
  await sleep(900);
  await page.screenshot({ path: `${EV}/2026-10-11_round14-fe_ui-fb008-1-after-apply.png` });
  const readRows = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr.csc-container-row')];
    const seg = (row, key) => row.querySelector(`input[data-seg="${key}"]`)?.value ?? '';
    return rows.map((r) => ({ dd: seg(r, 'dd'), mm2: seg(r, 'mm2'), yyyy: seg(r, 'yyyy'), hh: seg(r, 'hh'), mm: seg(r, 'mm') }));
  });
  const afterBulk = await readRows();
  step('fb008', { applyClicked, afterBulk });
  assert.ok(applyClicked, 'bulk apply control offered (case R14-02)');
  assert.equal(afterBulk[1]?.dd, '25', 'bulk date filled row 2');
  assert.equal(afterBulk[2]?.dd, '25', 'bulk date filled row 3');
  assert.equal(afterBulk[0]?.dd, '20', 'the set row keeps its own schedule (case R14-02)');

  // FB-009: a fresh row with a PARTIAL draft must keep the copy affordance
  // alive (the round-14 "mất hẳn" state) and receive the copied schedule.
  const addRow = async () => {
    const before = await page.$$eval('tr.csc-container-row', (els) => els.length);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Thêm container')?.click());
      await sleep(700);
      const after = await page.$$eval('tr.csc-container-row', (els) => els.length);
      if (after > before) return { before, after };
    }
    return { before, after: await page.$$eval('tr.csc-container-row', (els) => els.length) };
  };
  const addResult = await addRow();
  step('fb009-add-row', addResult);
  assert.ok(addResult.after > addResult.before, 'a fresh empty row was added');
  const rows = await page.$$('tr.csc-container-row');
  const lastRow = rows[rows.length - 1];
  const lastRowDate = await lastRow.$('input[data-seg="dd"]');
  if (lastRowDate) { await lastRowDate.click({ clickCount: 3 }); await lastRowDate.type('15'); }
  await sleep(500);
  const lastRowSegs = await page.$$eval('tr.csc-container-row', (els) => {
    const row = els[els.length - 1];
    const seg = (key) => row.querySelector(`input[data-seg="${key}"]`)?.value ?? '';
    return { dd: seg('dd'), mm2: seg('mm2'), yyyy: seg('yyyy'), hh: seg('hh'), mm: seg('mm') };
  });
  step('fb009-last-row', lastRowSegs);
  const state = await page.evaluate(() => ({
    copyButtons: document.querySelectorAll('.csc-container-row__copy').length,
    sectionCopy: [...document.querySelectorAll('button')].some((b) => (b.innerText || '').includes('Copy giờ hẹn')),
    bulkField: Boolean(document.querySelector('input[id$="-bulk-appointment-date"]')),
  }));
  await page.screenshot({ path: `${EV}/2026-10-11_round14-fe_ui-fb009-1-affordances.png` });
  step('fb009-affordances', state);
  assert.ok(state.copyButtons >= 1 || state.sectionCopy, 'copy affordance alive with a partial-draft destination (case R14-03)');

  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('Copy giờ hẹn'))?.click());
  await sleep(800);
  const afterCopy = await readRows();
  step('fb009-after-copy', afterCopy);
  await page.screenshot({ path: `${EV}/2026-10-11_round14-fe_ui-fb009-2-after-copy.png` });
  assert.equal(afterCopy[afterCopy.length - 1]?.dd, '20', 'the partial-draft row received the copied schedule (case R14-03)');
  await page.close();
  return { state, afterCopy, applyClicked, afterBulk };
});

// ─── FB-050: X-axis ticks on the top-trucks chart ───────────────────────────
await run('fb050-chart-axis', async () => {
  const token = await login('admin');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/finance`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
  await sleep(3000);
  const chart = await page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label^="Top xe theo lợi nhuận"]');
    return {
      svgFound: Boolean(svg),
      axis: Boolean(svg?.querySelector('[data-chart-xaxis]')),
      ticks: [...(svg?.querySelectorAll('[data-chart-xtick] text') ?? [])].map((t) => (t.textContent || '').trim()),
    };
  });
  await page.screenshot({ path: `${EV}/2026-10-11_round14-fe_ui-fb050-1-chart.png`, fullPage: true });
  step('fb050', chart);
  assert.ok(chart.svgFound, 'chart rendered');
  assert.ok(chart.axis, 'money axis rendered (case R14-05)');
  assert.ok(chart.ticks.length >= 2, `axis ticks present (got ${chart.ticks.join(' | ')})`);
  await page.close();
  return chart;
});

// ─── FB-057: topbar search expands on focus ─────────────────────────────────
await run('fb057-search-expand', async () => {
  const token = await login('admin');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
  await sleep(2000);
  const probe = () => page.evaluate(() => {
    const wrap = document.querySelector('.topbar__search');
    const cs = wrap ? getComputedStyle(wrap) : null;
    return { maxWidth: cs?.maxWidth ?? null, rectWidth: wrap ? Math.round(wrap.getBoundingClientRect().width) : null };
  });
  const atRest = await probe();
  await page.evaluate(() => document.querySelector('.topbar__search input')?.focus());
  await sleep(500);
  const focused = await probe();
  await page.screenshot({ path: `${EV}/2026-10-11_round14-fe_ui-fb057-1-search-focus.png` });
  step('fb057', { atRest, focused });
  assert.equal(atRest.maxWidth, '360px', 'rest cap is 360px');
  assert.ok(focused.rectWidth > (atRest.rectWidth ?? 0) + 40, `focus expands the field (rest ${atRest.rectWidth} → focus ${focused.rectWidth})`);
  await page.close();
  return { atRest, focused };
});

// ─── FB-051: penalty create + cancel success toasts (net-zero-ish) ──────────
await run('fb051-penalty-toasts', async () => {
  const token = await login('admin');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/penalties`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
  await sleep(2500);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Lập biên bản')?.click());
  await sleep(1200);
  const form = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return (dlg?.innerText || '').replace(/\s+/g, ' ').slice(0, 240);
  });
  step('fb051-form', { form });
  // Driver: the drawer's UuiSelectField combobox → first real option.
  const opened = await page.evaluate(() => {
    const wrap = document.querySelector('[role="dialog"] .ds-uui-select');
    if (!wrap) return false;
    wrap.querySelector('button, input')?.click();
    return true;
  });
  await sleep(800);
  const driverPicked = await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || '').trim() && !/^--/.test((o.textContent || '').trim()));
    if (!opt) return null;
    const label = (opt.textContent || '').trim();
    opt.click();
    return label;
  });
  step('fb051-driver', { opened, driverPicked });
  assert.ok(driverPicked, 'the drawer driver combobox offers a driver');
  await sleep(400);
  const amountInput = await page.evaluateHandle(() => document.querySelector('[role="dialog"] input[type="number"]'));
  if (amountInput.asElement()) {
    await amountInput.asElement().click({ clickCount: 3 });
    await amountInput.asElement().type('50000');
  }
  const dateInput = await page.evaluateHandle(() => document.querySelector('[role="dialog"] input[placeholder="DD/MM/YYYY"]'));
  if (dateInput.asElement()) {
    await dateInput.asElement().click({ clickCount: 3 });
    await dateInput.asElement().type('10/10/2026');
    await page.keyboard.press('Escape');
  }
  await page.screenshot({ path: `${EV}/2026-10-11_round14-fe_ui-fb051-1-form.png` });
  const saved = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const btn = [...(dlg?.querySelectorAll('button') ?? [])].find((b) => (b.innerText || '').trim() === 'Xác nhận');
    if (!btn || btn.disabled) return null;
    const label = btn.innerText.trim();
    btn.click();
    return label;
  });
  step('fb051-save', { saved });
  assert.ok(saved, 'the create drawer exposes its Xác nhận control');
  await sleep(1800);
  const createToast = await page.evaluate(() => [...document.querySelectorAll('.toast__message')].map((t) => (t.textContent || '').trim()));
  await page.screenshot({ path: `${EV}/2026-10-11_round14-fe_ui-fb051-2-create-toast.png` });
  step('fb051-create-toast', { createToast });
  assert.ok(createToast.some((t) => t.includes('Đã lập biên bản kỷ luật')), `create toast fired (got: ${JSON.stringify(createToast)})`);

  // Net-zero-ish: cancel the just-created penalty → the cancel mutation's toast.
  await sleep(800);
  const canceled = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Hủy kỷ luật"]');
    if (!btn) return null;
    btn.click();
    return 'Hủy kỷ luật';
  });
  await sleep(900);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[role="dialog"] button')];
    btns.find((b) => (b.innerText || '').trim() === 'Xác nhận hủy')?.click();
  });
  await sleep(1800);
  const cancelToast = await page.evaluate(() => [...document.querySelectorAll('.toast__message')].map((t) => (t.textContent || '').trim()));
  await page.screenshot({ path: `${EV}/2026-10-11_round14-fe_ui-fb051-3-cancel-toast.png` });
  step('fb051-cancel-toast', { canceled, cancelToast });
  assert.ok(cancelToast.some((t) => t.includes('Đã hủy biên bản kỷ luật')), `cancel toast fired (got: ${JSON.stringify(cancelToast)})`);
  await page.close();
  return { createToast, cancelToast };
});

writeFileSync(`${EV}/2026-10-11_round14-fe_results.json`, JSON.stringify(results, null, 2));
step('round14-fe-complete', { ok: Object.entries(results).filter(([, v]) => !v.error).length, total: Object.keys(results).length });
await browser.close();
const failed = Object.entries(results).filter(([, v]) => v.error);
assert.equal(failed.length, 0, `all claims must pass: ${failed.map(([k]) => k).join(', ')}`);
