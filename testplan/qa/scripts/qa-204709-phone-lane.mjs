// QA driver — card 161026204709 (build be877a8d, STAGING ONLY, chain ends at report).
// Verifies the rev-merge 100%/0₫ lane renders on the PHONE card face (≤640px)
// of BOTH money boards, exercising the real merge + unmerge flows via UI clicks.
//
//   CUS board:      /shipments-debit  ("Chi phí - Quyết toán", ShipmentDebitRecords)
//   Kế toán board:  /accounting/chot-debit (AccountingDebitRecords)
// Flow:
//   1. API fixtures: QA pricing lane + 2 LCL lots (same customer).
//   2. UI MERGE (desktop, CUS tiepvv): select 2 rows → "Ghép cước thu khách".
//   3. UI PHONE (390px, CUS): card-face assertion outside <details> + screenshot.
//   4. UI PHONE (390px, ACCOUNTANT hoapt): same on Kế toán board + screenshot.
//   5. UI UNMERGE (desktop, CUS): expand member row → "Hủy ghép" → re-verify.
//   6. DB proof (psql over ssh) + API cleanup (soft-delete lots + pricing row).
import {
  BASE, API, PIN, sleep, uuid, makeLogger, healthGate, login, api, psql, boot, tap, setInput, waitText, bodyText,
} from './fullguide-lib.mjs';
import { writeFileSync } from 'node:fs';

const SCOPE = 'card204709';
const logger = makeLogger(SCOPE);
const { step, log } = logger;
const results = {};
const record = (id, verdict, note) => { results[id] = { verdict, note }; step('VERDICT', { id, verdict, note }); };
const shot = (page, name) => page.screenshot({ path: `qa/2026-10-17_${SCOPE}_${name}.png`, fullPage: true });

await healthGate(logger);

const cus = await login('thanhdc');
const acct = await login('hoapt');
const admin = await login('admin');
step('logins', { cus: !!cus.token, acct: !!acct.token, admin: !!admin.token });
if (!cus.token || !acct.token || !admin.token) throw new Error('login failed');

// ── catalog facts ────────────────────────────────────────────────────────────
const hex = uuid().slice(0, 6);
const refA = `QA-204709-A-${hex}`;
const refB = `QA-204709-B-${hex}`;
const customers = await api(cus.token, 'GET', '/customers?limit=50');
const customerList = customers.json?.items ?? customers.json ?? [];
const customer = customerList.find((c) => !c.deletedAt && c.name && c.name.length <= 40) ?? customerList.find((c) => !c.deletedAt);
const routes = await api(cus.token, 'GET', '/routes?limit=50');
const routeList = routes.json?.items ?? routes.json ?? [];
const route = routeList.find((r) => r.id === 11) ?? routeList.find((r) => !r.deletedAt) ?? routeList[0];
const classes = await api(admin.token, 'GET', '/vehicle-size-classes?limit=50');
const classList = classes.json?.items ?? classes.json ?? [];
const cls = classList.find((c) => /(^|\s)xe 5 tấn$/i.test((c.name ?? '').trim())) ?? classList.find((c) => !c.deletedAt);
step('catalog', { customer: { id: customer?.id, name: customer?.name }, route: { id: route?.id }, cls: { id: cls?.id, name: cls?.name } });

// QA pricing lane → the 100% price both boards must show on Lô 1.
const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const QA_PRICE = 1200000;
let pricingRowId = null;
{
  const r = await api(admin.token, 'POST', '/pricing-tables', {
    customerId: customer.id, routeId: route.id, vehicleSizeClassId: cls.id,
    price: QA_PRICE, effectiveDate: today, note: `QA 204709 lane ${hex}`,
  });
  pricingRowId = r.json?.id ?? null;
  step('qa-pricing-row', { status: r.status, id: pricingRowId, body: r.text?.slice(0, 200) });
}

// ── 2 LCL fixtures via API (same customer — server rejects cross-customer) ──
async function createLot(ref) {
  let sites = await api(cus.token, 'GET', `/operational-sites?customerId=${customer.id}&limit=10`);
  if (!sites.ok) sites = await api(cus.token, 'GET', '/operational-sites?limit=10');
  const siteList = sites.json?.items ?? sites.json ?? [];
  const site = Array.isArray(siteList) ? siteList.find((t) => !/chưa xác định/i.test(t.name ?? '')) ?? siteList[0] : null;
  const res = await api(cus.token, 'POST', '/shipments', {
    customerId: customer.id, bookingRef: ref, tradeDirection: 'EXPORT', cargoMode: 'LCL',
    expectedDeliveryDate: today, packageType: 'Pallet', quantity: '5', weightKg: '1900', volumeCbm: '4',
    operationalSiteId: site?.id ?? null, routeId: route?.id ?? null,
  });
  step('fixture-create', { ref, status: res.status, id: res.json?.id, err: (res.json?.error ?? res.json?.message ?? res.text?.slice(0, 200)) });
  return res.json?.id ?? null;
}
const lotA = await createLot(refA);
const lotB = await createLot(refB);
if (!lotA || !lotB) { record('SETUP', 'FAIL', `fixture creation failed A=${lotA} B=${lotB}`); throw new Error('setup failed'); }

// shared searchable-picker (label[for] → input, exact-match option preference)
async function pickSearchable(page, labelRe, fragment) {
  const clicked = await tap(page, `() => {
    const labels = [...document.querySelectorAll('label')].filter(l => /${labelRe}/i.test((l.textContent || '')) && l.offsetParent !== null);
    const forId = labels[0]?.getAttribute('for');
    if (forId) { const el = document.getElementById(forId); if (el) return el; }
    return [...document.querySelectorAll('input')].find(i => {
      const l = (i.getAttribute('aria-labelledby') || '').split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
      return /${labelRe}/i.test(l) || /${labelRe}/i.test(i.getAttribute('aria-label') || '');
    }) ?? null;
  }`);
  if (!clicked) return false;
  await sleep(700);
  if (fragment) { await page.keyboard.type(fragment, { delay: 45 }); await sleep(1100); }
  else await sleep(900);
  const picked = await tap(page, `() => {
    const options = [...document.querySelectorAll('[role="option"]')].filter(o => o.offsetParent !== null);
    if (!options.length) return null;
    const want = ${JSON.stringify(String(fragment ?? ''))}.trim();
    const anchored = new RegExp('(^|\\\\s|[^0-9.])' + want.replace(/[.*+?^\\$\\{\\}()|[\\]\\\\]/g, '\\\\$&') + '\\\\s*$', 'i');
    return options.find(o => anchored.test((o.textContent || '').trim()))
      ?? (want ? options.find(o => ((o.textContent || '').trim().toLowerCase()).includes(want.toLowerCase())) : null)
      ?? options[0];
  }`);
  await sleep(700);
  return picked;
}
const searchBoard = async (page, q) => {
  const sel = `() => document.querySelector('input[aria-label="Tìm lô hàng"], input[placeholder*="Mã lô"], input[placeholder*="Bill, Book"]') ?? [...document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')].find(i => /tìm|search|lọc/i.test(i.placeholder || ''))`;
  await setInput(page, sel, q);
  await sleep(2500);
};

// Card-face probe: for the card containing `ref`, strip every <details>
// subtree (the 'Chi tiết' collapse) and assert the money lane is still there.
async function cardFace(page, ref) {
  return page.evaluate((ref) => {
    const cards = [...document.querySelectorAll('article.ledger-record, .ledger-record, tr.shipment-debit-row')];
    const card = cards.find((el) => (el.innerText || '').includes(ref));
    if (!card) return { found: false };
    const face = card.cloneNode(true);
    face.querySelectorAll('details').forEach((d) => d.remove());
    const text = (face.innerText || '').replace(/\s+/g, ' ').trim();
    const full = (card.innerText || '').replace(/\s+/g, ' ').trim();
    return { found: true, face: text.slice(0, 800), faceLen: text.length, fullLen: full.length };
  }, ref);
}

// ══ 2. UI MERGE (desktop, CUS) ══════════════════════════════════════════════
{
  const { browser, page } = await boot({ token: cus.token, width: 1440, height: 1000 });
  try {
    await page.goto(`${BASE}/shipments-debit?customer=${customer.id}&from=${today}&to=${today}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4500);
    await waitText(page, refA, 20000);
    await sleep(1500);
    const selected = await page.evaluate((a, b) => {
      const rows = [...document.querySelectorAll('tr, [class*="row"]')];
      const out = { boxes: [], clicked: [] };
      for (const ref of [a, b]) {
        const row = rows.find((r) => (r.innerText || '').includes(ref));
        if (!row) continue;
        const box = row.querySelector('input[type="checkbox"]');
        if (box) { box.click(); out.boxes.push(ref); }
        else { row.click(); out.clicked.push(ref); }
      }
      return out;
    }, refA, refB);
    await sleep(1500);
    const mergeBtn = await tap(page, `() => [...document.querySelectorAll('button')].find(b => /ghép cước thu khách|ghép tiền thu của khách/i.test(b.textContent.trim()) && !b.disabled)`);
    await sleep(1500);
    await shot(page, 'merge-dialog');
    await pickSearchable(page, 'Loại xe tính cước thu khách', (cls?.name ?? '5 tấn').replace(/^Xe\s+/i, ''));
    const merged = await tap(page, `() => { const dlgs = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null); const dlg = dlgs[dlgs.length - 1]; return dlg ? [...dlg.querySelectorAll('button')].reverse().find(b => /ghép cước thu khách/i.test(b.textContent.trim()) && !b.disabled) : null; }`);
    await sleep(3500);
    const after = await bodyText(page);
    const toast = after.match(/Đã ghép cước thu khách[^\n]*/)?.[0] ?? null;
    await shot(page, 'merge-after');
    step('merge-ui', { selected, mergeBtn, merged, toast });
    const ok = !!merged && !!toast;
    const dbRev = psql(`SELECT id, booking_ref, rev_group_order FROM shipments WHERE id IN (${lotA},${lotB}) ORDER BY rev_group_order NULLS LAST`);
    step('merge-db', { rev: dbRev });
    record('MERGE-FLOW', ok ? 'PASS' : 'FAIL', `UI merge click=${merged}, toast="${toast}", db=[${String(dbRev).replace(/\n/g, '; ')}]`);
  } catch (e) {
    step('merge-error', { error: String(e.message ?? e) });
    await shot(page, 'merge-error').catch(() => {});
    record('MERGE-FLOW', 'FAIL', String(e.message ?? e));
  } finally { await browser.close(); }
}

// ══ 3. PHONE CUS board — card-face lane ═════════════════════════════════════
async function phoneBoard({ token, path, searchNeedle, label }) {
  const { browser, page } = await boot({ token, width: 390, height: 844 });
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);
    if (searchNeedle) {
      const searchInput = await page.$('input[aria-label="Tìm lô hàng"], input[placeholder*="Mã lô"]');
      if (searchInput) {
        await searchInput.type(searchNeedle, { delay: 30 });
        await sleep(2000);
      }
    }
    await waitText(page, refA, 20000);
    await sleep(2000);
    await shot(page, `phone-${label}`);
    const faceA = await cardFace(page, refA);
    const faceB = await cardFace(page, refB);
    step(`phone-${label}-faces`, { faceA, faceB });
    return { faceA, faceB };
  } finally { await browser.close(); }
}
{
  const { faceA, faceB } = await phoneBoard({ token: cus.token, path: `/shipments-debit?customer=${customer.id}&from=${today}&to=${today}`, label: 'cus' });
  const laneRe = /Cước vận tải \(Auto\)/;
  const moneyRe = /1\.200\.000/;
  const zeroRe = /(?:^|\D)0(?:\s*₫|\s|$|Ghép)/i;
  const noteRe = /Ghép cước cùng Bill/i;
  const aOk = faceA.found && laneRe.test(faceA.face) && moneyRe.test(faceA.face);
  const bOk = faceB.found && laneRe.test(faceB.face) && zeroRe.test(faceB.face) && noteRe.test(faceB.face);
  record('PHONE-CUS', aOk && bOk ? 'PASS' : 'FAIL',
    `Lô1 face lane+1.200.000=${aOk} :: member face lane+0₫+note=${bOk} :: A="${(faceA.face ?? '').slice(0, 220)}" :: B="${(faceB.face ?? '').slice(0, 220)}"`);
}

// ══ 4. PHONE Kế toán board — card-face lane ═════════════════════════════════
{
  const { faceA, faceB } = await phoneBoard({ token: acct.token, path: '/accounting/chot-debit', searchNeedle: hex, label: 'ketoan' });
  const laneRe = /Cước thu \(tự động\)/;
  const moneyRe = /1\.200\.000/;
  const zeroRe = /(?:^|\D)0(?:\s*₫|\s|$|Ghép)/i;
  const noteRe = /Ghép cùng Bill/i;
  const aOk = faceA.found && laneRe.test(faceA.face) && moneyRe.test(faceA.face);
  const bOk = faceB.found && laneRe.test(faceB.face) && zeroRe.test(faceB.face) && noteRe.test(faceB.face);
  record('PHONE-KETOAN', aOk && bOk ? 'PASS' : 'FAIL',
    `Lô1 face lane+1.200.000=${aOk} :: member face lane+0₫+note=${bOk} :: A="${(faceA.face ?? '').slice(0, 220)}" :: B="${(faceB.face ?? '').slice(0, 220)}"`);
}

// ══ 5. UI UNMERGE (desktop, CUS): expand member row → Hủy ghép ══════════════
{
  const { browser, page } = await boot({ token: cus.token, width: 1440, height: 1000 });
  try {
    await page.goto(`${BASE}/shipments-debit?customer=${customer.id}&from=${today}&to=${today}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4500);
    await waitText(page, refB, 20000);
    await sleep(1500);
    // Expand the member row's detail (desktop inline expansion carries Hủy ghép).
    await page.evaluate((ref) => {
      const rows = [...document.querySelectorAll('tr, [class*="row"]')];
      const row = rows.find((r) => (r.innerText || '').includes(ref));
      row?.scrollIntoView({ block: 'center' });
    }, refB);
    await sleep(1000);
    const expanded = await tap(page, `() => [...document.querySelectorAll('button')].find(b => /mở chi tiết lô/i.test(b.getAttribute('aria-label') || '') && (b.getAttribute('aria-label') || '').includes(${JSON.stringify(refB)}) && !b.disabled)
      ?? [...document.querySelectorAll('button')].find(b => /^mở chi tiết lô$/i.test(b.textContent.trim()) && (b.closest('tr, [class*="row"]')?.innerText || '').includes(${JSON.stringify(refB)}))`);
    await sleep(2500);
    await shot(page, 'unmerge-expanded');
    const unmerged = await tap(page, `() => {
      const btn = [...document.querySelectorAll('button')].find(b => /hủy ghép/i.test(b.textContent.trim()) && !b.disabled);
      if (btn) btn.scrollIntoView({ block: 'center' });
      return btn;
    }`);
    await sleep(2000);
    await shot(page, 'unmerge-confirm');
    // Confirm dialog if one appears (Xác nhận / Đồng ý / Hủy ghép).
    const confirmed = await page.evaluate(() => {
      const box = document.querySelector('.confirm-box');
      if (box) {
        const btn = box.querySelector('.confirm-actions button.btn--primary, .confirm-actions button:last-child');
        if (btn) { btn.click(); return true; }
      }
      return false;
    });
    await sleep(3500);
    const after = await bodyText(page);
    const toast = after.match(/(Đã tách|Đã hủy ghép|tách khỏi nhóm)[^\n]*/)?.[0] ?? null;
    await shot(page, 'unmerge-after');
    step('unmerge-ui', { expanded, unmerged, confirmed, toast });
    const dbRev = psql(`SELECT id, booking_ref, rev_group_order FROM shipments WHERE id IN (${lotA},${lotB}) ORDER BY id`);
    const dbSnap = psql(`SELECT shipment_id, freight_amount FROM freight_rate_snapshots WHERE shipment_id IN (${lotA},${lotB}) ORDER BY id`);
    step('unmerge-db', { rev: dbRev, snapshots: dbSnap });
    const dissolved = !String(dbRev).includes('|1|') && !String(dbRev).includes('|2|');
    record('UNMERGE-FLOW', (unmerged && dissolved) ? 'PASS' : 'FAIL',
      `expand=${expanded}, unmergeClick=${unmerged}, confirm=${confirmed}, toast="${toast}", groupDissolved=${dissolved}, db=[${String(dbRev).replace(/\n/g, '; ')}]`);
  } catch (e) {
    step('unmerge-error', { error: String(e.message ?? e) });
    await shot(page, 'unmerge-error').catch(() => {});
    record('UNMERGE-FLOW', 'FAIL', String(e.message ?? e));
  } finally { await browser.close(); }
}

// ══ 6. Cleanup: soft-delete lots + pricing lane, census ═════════════════════
for (const id of [lotA, lotB]) {
  const s = await api(admin.token, 'GET', `/shipments/${id}`).then((r) => r.json?.shipment ?? r.json ?? null).catch(() => null);
  if (s?.id) {
    const del = await api(admin.token, 'DELETE', `/shipments/${id}?version=${s.version}`);
    step('cleanup-lot', { id, status: del.status });
  }
}
if (pricingRowId) {
  const fresh = await api(admin.token, 'GET', `/pricing-tables/${pricingRowId}`);
  const del = await api(admin.token, 'DELETE', `/pricing-tables/${pricingRowId}`, null, { 'If-Unmodified-Since': fresh.json?.updatedAt });
  step('cleanup-pricing', { id: pricingRowId, status: del.status });
}
{
  const census = await api(admin.token, 'GET', `/shipments?q=QA-204709-${hex}&limit=10`);
  const items = census.json?.items ?? census.json ?? [];
  step('cleanup-census', { visible: Array.isArray(items) ? items.length : '?' });
}

step('SUMMARY', results);
writeFileSync('qa/2026-10-17_card204709_results.json', JSON.stringify({ pin: PIN, date: new Date().toISOString(), results, fixtures: { lotA, lotB, refA, refB, pricingRowId, hex } }, null, 2));
log('DRIVER DONE');
