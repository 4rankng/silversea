// Card 20261010_3 — staging rung 3: copy-appointment affordances surface
// from ONE empty container, at all three sites (create row icon, create
// section button, CUS ledger row icon) and copy fills the empty rows.
// Part A (admin): /shipments/new FCL, 2 rows → fill row 1 → icons appear →
//   section button copies into row 2 → 3-row lot still shows affordances.
// Part B (thanhdc): /shipments lot 175 (DNKM13336, fixture: cont 145 has
//   09:30 16/10/2026, cont 146 empty) → ledger icon → click → 146 filled.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launch, shot } from './lead-qa-lib.mjs';

const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const EV = 'testplan/qa/evidence/2026-10-10_card202610103';
const FREEZE = 'a20ab94b';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const note = (s) => { log.push(s); console.log(s); };

async function tok(user) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: user, password: 'Abc123' }),
  });
  return (await r.json()).token;
}
async function rolePage(browser, user) {
  const token = await tok(user);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t, origin) => {
    if (location.origin === origin) localStorage.setItem('token', t);
  }, token, BASE);
  page.on('pageerror', (e) => note(`  [pageerror:${user}] ${e.message}`));
  return { ctx, page, token };
}
async function tapHandle(page, h, label) {
  const el = h.asElement();
  if (!el) throw new Error(`no element: ${label}`);
  await el.click();
  await sleep(600);
}
async function textButton(page, text) {
  return page.evaluateHandle((t) => Array.from(document.querySelectorAll('button'))
    .find((n) => (n.innerText || '').trim().includes(t) && n.offsetParent !== null) || null, text);
}
async function fillAppointmentRow1(page) {
  // Combined picker recipe (card 071026204700): click the row-1 date
  // segment, pick today, type exact time, confirm with Xong.
  const seg = await page.$('tr.csc-container-row [data-seg-part="date"] input');
  await tapHandle(page, seg, 'row1 date segment');
  const day = await page.evaluateHandle(() => document.querySelector('[role=dialog] .dtp-day.is-today, [role=dialog] [class*="is-today"]'));
  await tapHandle(page, day, 'today');
  const exact = await page.evaluateHandle(() => document.querySelector('[role=dialog] .dtp-time__exact input, [role=dialog] [class*="dtp-time"] input'));
  await tapHandle(page, exact, 'exact time input');
  await page.keyboard.type('09:30');
  await sleep(300);
  const xong = await page.evaluateHandle(() => {
    const dlg = Array.from(document.querySelectorAll('[role=dialog]'))
      .find((d) => (d.getAttribute('aria-label') || '').includes('Chọn ngày giờ'));
    return dlg ? Array.from(dlg.querySelectorAll('button')).find((b) => /xong/i.test(b.textContent.trim())) : null;
  });
  await tapHandle(page, xong, 'Xong');
  await sleep(800);
}
const affordances = (page) => page.evaluate(() => ({
  rowIcons: document.querySelectorAll('button.csc-container-row__copy').length,
  rowIconTitles: Array.from(document.querySelectorAll('button.csc-container-row__copy')).map((b) => b.title),
  sectionButton: Array.from(document.querySelectorAll('button'))
    .some((b) => (b.innerText || '').includes('Copy giờ hẹn xuống cont trống') && b.offsetParent !== null),
  rows: document.querySelectorAll('tr.csc-container-row').length,
  segs: Array.from(document.querySelectorAll('tr.csc-container-row'))
    .map((r) => Array.from(r.querySelectorAll('[data-seg]')).map((i) => i.value).join('|')),
}));

async function main() {
  await fs.mkdir(EV, { recursive: true });
  const health = await (await fetch(`${API}/health`)).json();
  note(`HEALTH status=${health.status} buildHash=${health.buildHash}`);
  await fs.writeFile(path.join(EV, 'health.json'), JSON.stringify(health, null, 2));
  assert.equal(health.buildHash, FREEZE, `staging must serve ${FREEZE}`);
  const { browser } = await launch({ width: 1440, height: 900, base: BASE });

  // ── Part A: create form (admin) ─────────────────────────────────────
  const adm = await rolePage(browser, 'admin');
  await adm.page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3500);
  assert.ok(await adm.page.evaluate(() => !!document.querySelector('table [data-seg-part]')), 'appointment field must render');
  await shot(adm.page, path.join(EV, 'card3-a-01-empty-1440.png'));

  // 2 rows
  const add = await textButton(adm.page, 'Thêm container');
  await tapHandle(adm.page, add, 'Thêm container');
  await sleep(600);
  let state = await affordances(adm.page);
  note(`A baseline rows=${state.rows} rowIcons=${state.rowIcons} sectionButton=${state.sectionButton}`);
  assert.equal(state.rows, 2, 'two container rows');
  assert.equal(state.rowIcons, 0, 'no icon before any appointment');
  assert.equal(state.sectionButton, false, 'no section button before any appointment');

  // fill row 1 → affordances appear with only ONE empty destination
  await fillAppointmentRow1(adm.page);
  state = await affordances(adm.page);
  note(`A after-fill rows=${state.rows} rowIcons=${state.rowIcons} sectionButton=${state.sectionButton} segs=${JSON.stringify(state.segs)}`);
  assert.equal(state.rowIcons, 1, 'row-1 icon appears (1 empty destination)');
  assert.ok(state.rowIconTitles[0].startsWith('Copy ngày giờ'), 'row icon title');
  assert.equal(state.sectionButton, true, 'section button appears (1 empty destination)');
  await shot(adm.page, path.join(EV, 'card3-a-02-icons-appear-1440.png'));

  // 3-row lot (1 filled + 2 empty) BEFORE any copy: the new row inherits
  // the empty row 2's schedule (createContainerFromPrevious), so the lot
  // stays 1-filled + 2-empty → affordances remain.
  const add2 = await textButton(adm.page, 'Thêm container');
  await tapHandle(adm.page, add2, 'Thêm container (3rd)');
  await sleep(600);
  state = await affordances(adm.page);
  note(`A 3-cont rows=${state.rows} rowIcons=${state.rowIcons} sectionButton=${state.sectionButton} segs=${JSON.stringify(state.segs)}`);
  assert.equal(state.rows, 3, 'three rows');
  assert.equal(state.rowIcons, 1, 'row-1 icon with 2 empty destinations');
  assert.equal(state.sectionButton, true, 'section button with 2 empty destinations');
  await shot(adm.page, path.join(EV, 'card3-a-03-3cont-still-shown-1440.png'));

  // click section button → every empty row receives the appointment
  const section = await textButton(adm.page, 'Copy giờ hẹn xuống cont trống');
  await tapHandle(adm.page, section, 'section copy button');
  await sleep(900);
  state = await affordances(adm.page);
  note(`A after-copy segs=${JSON.stringify(state.segs)} rowIcons=${state.rowIcons} sectionButton=${state.sectionButton}`);
  assert.ok(/\d{2}\|\d{2}\|/.test(state.segs[1] || ''), 'row 2 appointment filled');
  assert.ok(/\d{2}\|\d{2}\|/.test(state.segs[2] || ''), 'row 3 appointment filled');
  assert.equal(state.segs[1], state.segs[0], 'row 2 matches row 1');
  assert.equal(state.segs[2], state.segs[0], 'row 3 matches row 1');
  // all rows scheduled → affordances withdraw
  assert.equal(state.rowIcons, 0, 'no destination left → icon withdraws');
  assert.equal(state.sectionButton, false, 'no destination left → section button withdraws');
  await shot(adm.page, path.join(EV, 'card3-a-04-after-copy-1440.png'));
  await adm.ctx.close();

  // ── Part B: CUS ledger (thanhdc), lot 175 DNKM13336 ─────────────────
  const cus = await rolePage(browser, 'thanhdc');
  await cus.page.goto(`${BASE}/shipments?searchSuffix=DNKM13336`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);
  const listed = await cus.page.evaluate(() => (document.body.innerText || '').includes('DNKM13336'));
  assert.ok(listed, 'lot DNKM13336 listed for CUS');
  // Card 20260923_1 ruling: the row's detail action is the text-only
  // 'Chi tiết' link button — the row body itself is not the opener.
  const detailBtn = await cus.page.evaluateHandle(() => document.querySelector('button[id^="cus-dashboard-detail-"]'));
  await tapHandle(cus.page, detailBtn, 'Chi tiết button');
  await sleep(4000);
  const b1 = await cus.page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[title^="Copy giờ hẹn"]'));
    return {
      copyButtons: btns.length,
      titles: btns.map((b) => b.title),
      has145: (document.body.innerText || '').includes('MSDU1245780'),
      has146: (document.body.innerText || '').includes('TGBU3190086'),
      apptText: (document.body.innerText.match(/09:30[\s\S]{0,40}16\/10\/2026/g) || []).length,
    };
  });
  note(`B drawer copyButtons=${b1.copyButtons} titles=${JSON.stringify(b1.titles)} has145=${b1.has145} has146=${b1.has146} apptOccurrences=${b1.apptText}`);
  await shot(cus.page, path.join(EV, 'card3-b-01-ledger-icon-1440.png'));
  assert.ok(b1.has145 && b1.has146, 'both containers visible in ledger');
  assert.equal(b1.copyButtons, 1, 'exactly one copy icon (the scheduled container)');
  assert.ok(b1.titles[0].includes('09:30'), 'icon title carries source time');

  // click → empty container receives the appointment (UI + API write)
  const copyIcon = await cus.page.evaluateHandle(() => document.querySelector('button[title^="Copy giờ hẹn"]'));
  await tapHandle(cus.page, copyIcon, 'ledger copy icon');
  let filled = false;
  for (let i = 0; i < 10 && !filled; i += 1) {
    await sleep(800);
    filled = await cus.page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const row146 = rows.find((r) => (r.innerText || '').includes('TGBU3190086'));
      return row146 ? /09:30/.test(row146.innerText) && /16\/10\/2026/.test(row146.innerText) : false;
    });
  }
  note(`B after-click TGBU3190086 filled=${filled}`);
  assert.ok(filled, 'empty container row shows the copied appointment');
  await shot(cus.page, path.join(EV, 'card3-b-02-after-copy-1440.png'));

  // The ledger is draft-based: the copy wrote row 146's draft; the footer
  // 'Lưu' (button.cus-container-confirm) persists it. The copy's success
  // toast can overlay the footer for a few seconds — wait it out, then
  // click (retrying once), then wait for the dirty state to clear. DB
  // persistence is verified outside the driver.
  const writes = [];
  cus.page.on('response', (res) => {
    if (res.request().method() !== 'GET' && res.url().includes('/api/')) {
      writes.push(`${res.request().method()} ${res.url().replace(BASE, '')} -> ${res.status()}`);
    }
  });
  let toastsUp = true;
  for (let i = 0; i < 15 && toastsUp; i += 1) {
    await sleep(700);
    toastsUp = await cus.page.evaluate(() => Array.from(document.querySelectorAll('[class*=toast] [role=status], .toast, [class*=toast][role=status]'))
      .some((n) => n.offsetParent !== null));
  }
  note(`B toasts cleared: ${!toastsUp}`);
  const clickSave = async (n2) => {
    const save = await cus.page.evaluateHandle(() => document.querySelector('button.cus-container-confirm'));
    await tapHandle(cus.page, save, `drawer Lưu (${n2})`);
  };
  await clickSave(1);
  let clean = false;
  for (let i = 0; i < 8 && !clean; i += 1) {
    await sleep(800);
    clean = await cus.page.evaluate(() => {
      const btn = document.querySelector('button.cus-container-confirm');
      return btn ? btn.disabled : true;
    });
  }
  if (!clean) { await clickSave(2); for (let i = 0; i < 8 && !clean; i += 1) { await sleep(800); clean = await cus.page.evaluate(() => { const btn = document.querySelector('button.cus-container-confirm'); return btn ? btn.disabled : true; }); } }
  note(`B after-save clean=${clean} writes=${JSON.stringify(writes)}`);
  assert.ok(clean, 'save completes and dirty state clears');
  await shot(cus.page, path.join(EV, 'card3-b-03-after-save-1440.png'));
  await cus.ctx.close();

  await browser.close();
  await fs.writeFile(path.join(EV, 'rung-log.txt'), log.join('\n'));
  note('RUNG PASS');
}

try { await main(); } catch (err) {
  log.push(`FATAL ${err.message}`);
  await fs.writeFile(path.join(EV, 'rung-log.txt'), log.join('\n'));
  console.error(err);
  process.exit(1);
}
