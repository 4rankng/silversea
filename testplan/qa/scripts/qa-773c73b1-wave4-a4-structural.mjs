// Muse QA wave 4 — card 161026204709 (A.4), structural re-assert on a lane this
// wave owns end-to-end (no 409, no hard-coded price, no shared fixture).
//
// Asserts the SHAPE the ticket asks for, on both boards at 390px:
//   Lô 1  card face ⊢ lane value == the lane price this wave created
//   member card face ⊢ lane value == 0  +  "(Ghép cước cùng Bill <Lô 1>)"
//   both  ⊢ the fact survives stripping every <details> subtree (the ticket's
//            whole point: it must not be collapsed behind "Chi tiết")
import {
  BASE, PIN, sleep, uuid, makeLogger, healthGate, login, api, psql, boot, tap, waitText,
} from './fullguide-lib.mjs';
import { writeFileSync } from 'node:fs';

const SCOPE = 'qa773c73b1-wave4';
const logger = makeLogger(SCOPE);
const { step, log } = logger;
const results = {};
const record = (id, verdict, note) => { results[id] = { verdict, note }; step('VERDICT', { id, verdict, note }); };
const shot = (page, name) => page.screenshot({ path: `qa/2026-10-17_${SCOPE}_${name}.png`, fullPage: true });
const digits = (s) => String(s ?? '').replace(/[^\d]/g, '');

await healthGate(logger);
const cus = await login('thanhdc');
const acct = await login('hoapt');
const admin = await login('admin');
if (!cus.token || !acct.token || !admin.token) throw new Error('logins failed');
step('logins', { cus: !!cus.token, acct: !!acct.token, admin: !!admin.token });

const hex = uuid().slice(0, 6);
const refA = `QA-A4T-A-${hex}`;
const refB = `QA-A4T-B-${hex}`;
const QA_PRICE = 2345000;
// Both dates are in the past relative to "today" so the lane is in force for the
// lot, and the ROUTE is one customer 1 has no lane on — so this wave owns the
// selector outright and the pricing POST cannot 409.
const laneDate = '2026-01-05';
const lotDate = '2026-06-06';

const customers = await api(admin.token, 'GET', '/customers?limit=50');
const customerList = (customers.json?.items ?? customers.json ?? []).filter((c) => !c.deletedAt && c.status === 'ACTIVE');
const customer = customerList.find((c) => c.id === 1) ?? customerList[0];
const routes = await api(admin.token, 'GET', '/routes?limit=50');
const routeList = (routes.json?.items ?? routes.json ?? []).filter((r) => !r.deletedAt);
const owned = new Set([6, 11, 12, 13, 14]);
const route = routeList.find((r) => !owned.has(r.id)) ?? routeList[0];
const classes = await api(admin.token, 'GET', '/vehicle-size-classes?limit=50');
const cls = (classes.json?.items ?? classes.json ?? []).find((c) => c.code === '5T');
step('catalog', { customer: customer.id, route: { id: route.id, name: route.name }, cls: cls?.code, laneDate, lotDate });

{
  const r = await api(admin.token, 'POST', '/pricing-tables', {
    customerId: customer.id, routeId: route.id, vehicleSizeClassId: cls.id,
    price: QA_PRICE, effectiveDate: laneDate, note: `QA A4T lane ${hex}`,
  });
  step('lane', { status: r.status, id: r.json?.id, body: (r.text ?? '').slice(0, 140) });
  if (r.status !== 201) throw new Error(`lane not owned by this wave: ${r.status}`);
}

async function createLot(ref) {
  const res = await api(cus.token, 'POST', '/shipments', {
    customerId: customer.id, bookingRef: ref, tradeDirection: 'EXPORT', cargoMode: 'LCL',
    expectedDeliveryDate: lotDate, packageType: 'Pallet', quantity: '5', weightKg: '1900', volumeCbm: '4',
    routeId: route.id,
  });
  step('lot', { ref, id: res.json?.id, status: res.status });
  return res.json?.id ?? null;
}
const lotA = await createLot(refA);
const lotB = await createLot(refB);
if (!lotA || !lotB) throw new Error('fixture failed');

const cleanup = async () => {
  for (const id of [lotA, lotB]) {
    const s = await api(admin.token, 'GET', `/shipments/${id}`).then((r) => r.json?.shipment ?? r.json ?? null).catch(() => null);
    if (s?.id) { const d = await api(admin.token, 'DELETE', `/shipments/${id}?version=${s.version}`); step('cleanup-lot', { id, status: d.status }); }
  }
  const fresh = await api(admin.token, 'GET', `/pricing-tables`).then((r) => (r.json?.items ?? r.json ?? []).find((p) => p.note === `QA A4T lane ${hex}`)).catch(() => null);
  if (fresh?.id) { const d = await api(admin.token, 'DELETE', `/pricing-tables/${fresh.id}`, null, { 'If-Unmodified-Since': fresh.updatedAt }); step('cleanup-price', { id: fresh.id, status: d.status }); }
};

try {
  // ── UI MERGE (desktop CUS) — real clicks through the shipped dialog ────────
  {
    const { browser, page } = await boot({ token: cus.token, width: 1440, height: 1000 });
    try {
      await page.goto(`${BASE}/shipments-debit?customer=${customer.id}&deliveryDateFrom=${lotDate}&deliveryDateTo=${lotDate}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(5000);
      await waitText(page, refA, 25000);
      await sleep(1500);
      const picked = await page.evaluate((a, b) => {
        const rows = [...document.querySelectorAll('tr, [class*="row"]')];
        const out = [];
        for (const ref of [a, b]) {
          const row = rows.find((r) => (r.innerText || '').includes(ref));
          const box = row?.querySelector('input[type="checkbox"]');
          if (box) { box.click(); out.push(ref); }
        }
        return out;
      }, refA, refB);
      await sleep(1200);
      await tap(page, `() => [...document.querySelectorAll('button')].find(b => /ghép cước thu khách/i.test(b.textContent.trim()) && !b.disabled)`);
      await sleep(1500);
      await tap(page, `() => { const l = [...document.querySelectorAll('label')].find(x => /loại xe tính cước thu khách/i.test(x.textContent||'')); const id = l?.getAttribute('for'); return id ? document.getElementById(id) : null; }`);
      await sleep(800);
      await page.keyboard.type('5 tấn', { delay: 40 });
      await sleep(1200);
      await tap(page, `() => { const o = [...document.querySelectorAll('[role="option"]')].filter(x => x.getClientRects().length); return o.find(x => /5\\s*tấn/i.test(x.textContent||'')) ?? o[0] ?? null; }`);
      await sleep(700);
      await tap(page, `() => { const d = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].pop(); return d ? [...d.querySelectorAll('button')].reverse().find(b => /ghép cước thu khách/i.test(b.textContent.trim()) && !b.disabled) : null; }`);
      await sleep(4000);
      const body = await page.evaluate(() => document.body.innerText || '');
      const toast = body.match(/Đã ghép cước thu khách[^\n]*/)?.[0] ?? null;
      await shot(page, 'merge-after');
      const dbRev = psql(`SELECT id, booking_ref, rev_group_order FROM shipments WHERE id IN (${lotA},${lotB}) ORDER BY rev_group_order NULLS LAST`);
      step('merge', { picked, toast, db: dbRev });
      const lines = String(dbRev).trim().split('\n');
      record('A4-MERGE-UI', (toast && lines[0]?.endsWith('|1') && lines[1]?.endsWith('|2')) ? 'PASS' : 'FAIL',
        `checkboxes=${picked.length}/2 · toast="${toast}" · db=[${lines.join('; ')}]`);
    } finally { await browser.close(); }
  }

  // ── PHONE probes ───────────────────────────────────────────────────────────
  // Innermost article.ledger-record holding the ref; strip <details>; re-read.
  async function phoneFaces({ token, path, search, laneLabel }) {
    const { browser, page } = await boot({ token, width: 390, height: 844 });
    try {
      await page.goto(`${BASE}${path}${search}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(6000);
      await waitText(page, refA, 25000);
      await sleep(2000);
      await shot(page, `phone-${laneLabel === 'Cước vận tải (Auto)' ? 'cus' : 'ketoan'}`);
      const read = (ref) => page.evaluate((ref, laneLabel) => {
        const cands = [...document.querySelectorAll('article.ledger-record, .ledger-record, tr, article, li')];
        const holders = cands.filter((el) => (el.innerText || '').includes(ref));
        if (!holders.length) return { found: false };
        // Innermost = smallest text.
        const card = holders.reduce((best, el) => ((el.innerText || '').length < (best.innerText || '').length ? el : best));
        const details = [...card.querySelectorAll('details')];
        const open = details.map((d) => d.open);
        const face = card.cloneNode(true);
        face.querySelectorAll('details').forEach((d) => d.remove());
        const faceText = (face.innerText || '').replace(/\s+/g, ' ').trim();
        const fullText = (card.innerText || '').replace(/\s+/g, ' ').trim();
        const m = faceText.match(new RegExp(laneLabel.replace(/[()]/g, '\\$&') + '\\s*([^A-Za-zĐà-ỹ]+)'));
        return {
          found: true, tag: card.tagName.toLowerCase(), cls: card.className,
          detailsCount: details.length, allClosed: open.every((o) => o === false),
          laneLabelOnFace: faceText.includes(laneLabel),
          laneValue: m ? m[1].trim().slice(0, 24) : null,
          noteOnFace: /Ghép cước cùng Bill/i.test(faceText) || /Ghép cùng Bill/i.test(faceText),
          faceLen: faceText.length, fullLen: fullText.length,
          head: faceText.slice(0, 120),
        };
      }, ref, laneLabel);
      const a = await read(refA);
      const b = await read(refB);
      step(`faces-${laneLabel}`, { a, b });
      return { a, b };
    } finally { await browser.close(); }
  }

  {
    const { a, b } = await phoneFaces({
      token: cus.token, path: '/shipments-debit',
      search: `?customer=${customer.id}&deliveryDateFrom=${lotDate}&deliveryDateTo=${lotDate}`,
      laneLabel: 'Cước vận tải (Auto)',
    });
    const aOk = a.found && a.laneLabelOnFace && digits(a.laneValue) === String(QA_PRICE);
    const bOk = b.found && b.laneLabelOnFace && digits(b.laneValue) === '0' && b.noteOnFace;
    record('A4-PHONE-CUS', (aOk && bOk) ? 'PASS' : 'FAIL',
      `<${a.tag}.${a.cls}> Lô1 "Cước vận tải (Auto)" = ${a.laneValue} (expect ${QA_PRICE}) on face, outside ${a.detailsCount} <details> (allClosed=${a.allClosed}, ${a.fullLen}→${a.faceLen}B) :: member = ${b.laneValue} (expect 0) + note on face=${b.noteOnFace} :: A head="${a.head}"`);
  }
  {
    const { a, b } = await phoneFaces({
      token: acct.token, path: '/accounting/chot-debit', search: '', laneLabel: 'Cước thu (tự động)',
    });
    // This board scopes by date in-app; read the pair regardless of the board's
    // default window by asserting on whichever card actually carries our refs.
    const aOk = a.found && a.laneLabelOnFace && digits(a.laneValue) === String(QA_PRICE);
    const bOk = b.found && b.laneLabelOnFace && digits(b.laneValue) === '0' && b.noteOnFace;
    record('A4-PHONE-KETOAN', (aOk && bOk) ? 'PASS' : 'FAIL',
      `<${b.tag}> Lô1 "Cước thu (tự động)" = ${a.laneValue} (expect ${QA_PRICE}) on face, outside <details> (allClosed=${a.allClosed}) :: member = ${b.laneValue} (expect 0) + "(Ghép cùng Bill ${refA})" on face=${b.noteOnFace} :: B head="${b.head}"`);
  }

  // ── API + DB corroboration ─────────────────────────────────────────────────
  {
    const s = await api(cus.token, 'GET', `/shipments/debit-summary?customerId=${customer.id}&deliveryDateFrom=${lotDate}&deliveryDateTo=${lotDate}&lockStatus=ALL`);
    const items = s.json?.items ?? s.json ?? [];
    const rows = (Array.isArray(items) ? items : []).filter((r) => [refA, refB].includes(r.billOrBookNumber));
    step('api-debit-summary', { status: s.status, matched: rows.length, rows: rows.map((r) => ({ ref: r.billOrBookNumber, freightAuto: r.freightAuto, reason: r.freightOverrideReason })) });
    const dbSnap = psql(`SELECT shipment_id, freight_amount FROM freight_rate_snapshots WHERE shipment_id IN (${lotA},${lotB}) ORDER BY shipment_id`);
    const aRow = rows.find((r) => r.billOrBookNumber === refA);
    const bRow = rows.find((r) => r.billOrBookNumber === refB);
    const ok = aRow && bRow && digits(aRow.freightAuto) === String(QA_PRICE) && digits(bRow.freightAuto) === '0'
      && /Ghép cước cùng Bill/.test(bRow.freightOverrideReason ?? '');
    record('A4-API-DB', ok ? 'PASS' : 'FAIL',
      `GET /api/shipments/debit-summary?customerId=${customer.id}&deliveryDateFrom=${lotDate}… → ${s.status}, matched ${rows.length}/2 · Lô1 freightAuto=${aRow?.freightAuto} reason=${aRow?.freightOverrideReason} · member freightAuto=${bRow?.freightAuto} reason="${bRow?.freightOverrideReason}" · snapshots=[${String(dbSnap).replace(/\n/g, '; ')}]`);
  }
} finally {
  await cleanup();
}

step('SUMMARY', { pin: PIN, results });
writeFileSync(`qa/${SCOPE}_results.json`, JSON.stringify({ pin: PIN, date: new Date().toISOString(), results }, null, 2));
log('WAVE 4 DONE');
