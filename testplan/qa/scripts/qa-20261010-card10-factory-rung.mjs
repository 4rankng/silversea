// Card 20261009_10 — staging rung 3: owner-ruled 6-field quick-add for
// "Thêm nhà máy" from intake. Verifies: dialog opens in quick mode from the
// FCL factory action, exactly the six ruled fields render (no mã / loại
// điểm / maps), the inline "Thêm tuyến đường" creates a route that lands in
// the select, submit persists the site (DB-checked separately) and the
// dialog closes.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launch, shot } from './lead-qa-lib.mjs';

const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const EV = 'testplan/qa/evidence/2026-10-10_card2026100910';
const FREEZE = process.env.QA_FREEZE || 'a20ab94b';
const STAMP = Date.now().toString().slice(-6);
const ROUTE_FULL = `QA Tuyến NM ${STAMP}`;
const SITE_FULL = `QA Nhà máy ${STAMP}`;
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
// Label-scoped input lookup inside the active dialog.
const fieldByLabel = (page, label) => page.evaluateHandle((l) => {
  const labels = Array.from(document.querySelectorAll('[role=dialog] label'));
  const hit = labels.find((n) => (n.innerText || '').trim() === l);
  if (!hit) return null;
  const forId = hit.getAttribute('for');
  return (forId ? document.getElementById(forId) : hit.querySelector('input, select')) || null;
}, label);
// React Aria picker (UUI select/combobox): open the trigger named `label`,
// then click the first enabled non-placeholder option (or one matching
// `match`). Returns the picked option text.
async function ariaPick(page, label, match = null) {
  const trig = await page.evaluateHandle((l) => {
    const nodes = Array.from(document.querySelectorAll('[aria-haspopup], [role=combobox], input[aria-haspopup]'));
    return nodes.find((n) => {
      if (n.offsetParent === null) return false;
      const al = n.getAttribute('aria-label') || '';
      const lb = (n.getAttribute('aria-labelledby') || '').split(/\s+/)
        .map((i) => document.getElementById(i)?.textContent || '').join(' ');
      const ph = n.getAttribute('placeholder') || '';
      return `${al} ${lb} ${ph}`.includes(l);
    }) || null;
  }, label);
  const trigEl = trig.asElement();
  if (!trigEl) throw new Error(`no picker trigger: ${label}`);
  await trigEl.click();
  await sleep(700);
  const opt = await page.evaluateHandle((m) => {
    const opts = Array.from(document.querySelectorAll('[role=option]'))
      .filter((n) => n.offsetParent !== null && !(n.getAttribute('aria-disabled') === 'true'));
    if (m == null) return opts.find((n) => !/^—/.test((n.innerText || '').trim())) || opts[0] || null;
    return opts.find((n) => (n.innerText || '').includes(m)) || null;
  }, match);
  const optEl = opt.asElement();
  if (!optEl) throw new Error(`no option in ${label} (match=${match})`);
  const text = await optEl.evaluate((n) => (n.innerText || '').trim());
  await optEl.click();
  await sleep(700);
  return text;
}
async function pickerText(page, label) {
  return page.evaluate((l) => {
    const dialogs = Array.from(document.querySelectorAll('[role=dialog]'));
    const scope = dialogs.find((x) => (x.querySelector('h1,h2,h3')?.innerText || '').includes('Thêm nhà máy')) || document;
    const nodes = Array.from(scope.querySelectorAll('[aria-haspopup], [role=combobox], input[aria-haspopup]'));
    const n = nodes.find((x) => {
      if (x.offsetParent === null) return false;
      const al = x.getAttribute('aria-label') || '';
      const lb = (x.getAttribute('aria-labelledby') || '').split(/\s+/)
        .map((i) => document.getElementById(i)?.textContent || '').join(' ');
      return `${al} ${lb}`.includes(l);
    });
    if (!n) return null;
    return (n.value ?? n.innerText ?? '').trim();
  }, label);
}

async function main() {
  await fs.mkdir(EV, { recursive: true });
  const health = await (await fetch(`${API}/health`)).json();
  note(`HEALTH status=${health.status} buildHash=${health.buildHash}`);
  await fs.writeFile(path.join(EV, 'health.json'), JSON.stringify(health, null, 2));
  assert.equal(health.buildHash, FREEZE, `staging must serve ${FREEZE}`);

  const { browser } = await launch({ width: 1440, height: 900, base: BASE });
  const adm = await rolePage(browser, 'admin');
  await adm.page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3500);

  // customer first — openCreateSiteDialog guards on it
  const firstCustomerLabel = await ariaPick(adm.page, 'Khách hàng');
  note(`customer selected: ${firstCustomerLabel}`);
  assert.ok(firstCustomerLabel && !firstCustomerLabel.startsWith('—'), 'a customer chosen');
  await sleep(1500);

  // open quick-add factory dialog
  const addNm = await textButton(adm.page, 'Thêm nhà máy');
  await tapHandle(adm.page, addNm, 'Thêm nhà máy');
  await sleep(900);
  const dlg = await adm.page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('[role=dialog]'));
    const d = dialogs.find((x) => (x.querySelector('h1,h2,h3')?.innerText || '').includes('Thêm nhà máy')) || dialogs[0];
    if (!d) return null;
    const labels = Array.from(d.querySelectorAll('label')).map((l) => (l.innerText || '').trim()).filter(Boolean);
    return {
      title: d.querySelector('h1,h2,h3')?.innerText ?? null,
      labels,
      hasSubtitle: (d.innerText || '').includes('Điểm vận hành'),
      body: (d.innerText || '').slice(0, 400),
    };
  });
  note(`dialog: ${JSON.stringify(dlg)}`);
  assert.ok(dlg, 'factory dialog opened');
  await shot(adm.page, path.join(EV, 'card10-01-dialog-quick-6fields-1440.png'));
  for (const f of ['Tên đầy đủ', 'Tên ngắn', 'Địa chỉ', 'Tuyến đường', 'Tên liên hệ', 'SĐT liên hệ']) {
    assert.ok(dlg.labels.includes(f), `ruled field present: ${f}`);
  }
  const fullFormMarkers = dlg.labels.filter((l) => /^(Mã|Loại điểm)$/.test(l));
  assert.equal(fullFormMarkers.length, 0, 'quick mode must not render mã / loại điểm');
  assert.ok(!(dlg.body || '').includes('maps') && !(dlg.body || '').toLowerCase().includes('google'), 'no maps block in quick mode');
  assert.equal(dlg.hasSubtitle, false, 'full-form subtitle hidden in quick mode');

  // inline route creation inside the factory dialog
  const inlineRoute = await adm.page.evaluateHandle(() => document.querySelector('button.operational-site-create__add-route'));
  await tapHandle(adm.page, inlineRoute, 'inline Thêm tuyến đường');
  await sleep(900);
  const routeDlg = await adm.page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('[role=dialog]'));
    const d = dialogs.find((x) => (x.innerText || '').includes('Khoảng cách'));
    return d ? {
      hasKm: true,
      labels: Array.from(d.querySelectorAll('label')).map((l) => (l.innerText || '').trim()).filter(Boolean),
    } : null;
  });
  note(`route dialog: ${JSON.stringify(routeDlg)}`);
  assert.ok(routeDlg?.hasKm, 'route create dialog opened from inline button');
  await shot(adm.page, path.join(EV, 'card10-02-route-dialog-1440.png'));

  const routeName = await fieldByLabel(adm.page, 'Tên đầy đủ');
  await tapHandle(adm.page, routeName, 'route name field');
  await adm.page.keyboard.type(ROUTE_FULL);
  const routeShort = await fieldByLabel(adm.page, 'Tên ngắn');
  await tapHandle(adm.page, routeShort, 'route short field');
  await adm.page.keyboard.type(`QA-NM-${STAMP}`);
  const routeSubmit = await adm.page.evaluateHandle(() => document.querySelector('button.route-create-dialog__submit'));
  await tapHandle(adm.page, routeSubmit, 'route submit');
  await sleep(2500);

  // back in the factory dialog: handleRouteCreated auto-selects the new
  // route (update('routeId', route.id)) — the picker must display it.
  const shownRoute = await pickerText(adm.page, 'Tuyến đường');
  note(`Tuyến đường picker shows: ${shownRoute}`);
  assert.ok((shownRoute || '').includes(STAMP), 'picker auto-displays the new route');
  await shot(adm.page, path.join(EV, 'card10-03-route-created-1440.png'));

  // fill the six fields + submit
  const fill = async (label, value) => {
    const h = await fieldByLabel(adm.page, label);
    await tapHandle(adm.page, h, label);
    await adm.page.keyboard.type(value);
  };
  await fill('Tên đầy đủ', SITE_FULL);
  await fill('Tên ngắn', `QA-NM-${STAMP}`);
  await fill('Địa chỉ', 'Số 1 KCN VSIP, Bắc Ninh');
  await fill('Tên liên hệ', 'Nguyễn Văn QA');
  await fill('SĐT liên hệ', '0901234567');
  await shot(adm.page, path.join(EV, 'card10-04-filled-1440.png'));
  const submit = await adm.page.evaluateHandle(() => {
    const dialogs = Array.from(document.querySelectorAll('[role=dialog]'));
    const d = dialogs.find((x) => (x.querySelector('h1,h2,h3')?.innerText || '').includes('Thêm nhà máy'));
    return d ? Array.from(d.querySelectorAll('button.btn--primary')).find((b) => (b.innerText || '').includes('Thêm nhà máy')) : null;
  });
  await tapHandle(adm.page, submit, 'factory submit');
  let closed = false;
  for (let i = 0; i < 12 && !closed; i += 1) {
    await sleep(800);
    closed = await adm.page.evaluate(() => !Array.from(document.querySelectorAll('[role=dialog]'))
      .some((d) => (d.querySelector('h1,h2,h3')?.innerText || '').includes('Thêm nhà máy')));
  }
  note(`dialog closed after submit: ${closed}`);
  assert.ok(closed, 'factory dialog closed after create');
  await shot(adm.page, path.join(EV, 'card10-05-after-create-1440.png'));
  await adm.ctx.close();
  await browser.close();

  await fs.writeFile(path.join(EV, 'rung-log.txt'), log.join('\n'));
  await fs.writeFile(path.join(EV, 'created.json'), JSON.stringify({ ROUTE_FULL, SITE_FULL, STAMP, customer: firstCustomerLabel }, null, 2));
  note('RUNG PASS');
}

try { await main(); } catch (err) {
  log.push(`FATAL ${err.message}`);
  await fs.writeFile(path.join(EV, 'rung-log.txt'), log.join('\n'));
  console.error(err);
  process.exit(1);
}
