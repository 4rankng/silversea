// Rung 325: appointment preset + Enter saves and closes (as thanhdc, CUS drawer, REAL taps/keys).
// mutates: 1 appointment save on a fixture container row (declared; local dev, unrestricted).
import { launch, probe, shot, setViewport } from './lead-qa-lib.mjs';

const base = process.env.QA_BASE || 'http://localhost:7175';
const E = process.env.EVID_DIR;
const { browser, page } = await launch({ width: 1440, height: 1000 });
const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const { token } = await res.json();

// fixture: one lot with 3 containers via the real write path (declared mutation, local dev)
if (!process.env.SHIP_ID) {
  const cf = await fetch(`${base}/api/shipments/quick`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({
      isAdHoc: true,
      rawCustomerName: 'QA325 APPT FIXTURE',
      bookingRef: 'QA325-APPT-01',
      tradeDirection: 'EXPORT',
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-10-15',
      containers: [
        { containerNumber: 'MSCU1111113', containerTypeId: 1 },
        { containerNumber: 'TGHU2222220', containerTypeId: 1 },
        { containerNumber: 'CSQU3333330', containerTypeId: 1 },
      ],
    }),
  });
  const cj = await cf.json();
  console.log('FIXTURE_CREATE', cf.status, JSON.stringify(cj).slice(0, 140));
}
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${base}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3500));
{
  const search = await page.$('input[aria-label="Tìm lô hàng"]');
  if (search) { await search.click(); await page.keyboard.type('QA325', { delay: 35 }); }
  await new Promise((r) => setTimeout(r, 2200));
}

// open the DRAWER ("Chi tiết" action — the compact edit dialog does NOT carry the ledger)
let found = false;
for (let i = 0; i < 8 && !found; i++) {
  const clicked = await page.evaluate((idx) => {
    const rows = [...document.querySelectorAll('tbody tr, [class*=card], [class*=record]')].filter((e) => e.querySelector('td, button'));
    const row = rows[idx];
    if (!row) return false;
    const btn = [...row.querySelectorAll('button')].find((b) => /Chi tiết/i.test(b.getAttribute('aria-label') || b.innerText || ''));
    if (!btn) return false;
    btn.click();
    return true;
  }, i);
  if (!clicked) { console.log('ROW_TRY', i, 'no Chi tiết button'); continue; }
  await new Promise((r) => setTimeout(r, 2200));
  found = await page.evaluate(() => !!document.querySelector('button[aria-label^="Giờ hẹn đóng hoặc trả"]'));
  console.log('ROW_TRY', i, 'hasApptTrigger:', found);
  if (!found) { await page.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 900)); }
}

const drawer = await page.evaluate(() => {
  const d = document.querySelector('.cus-shipment-drawer, [role=dialog]');
  const trig = [...document.querySelectorAll('button')].find((b) => /Giờ hẹn đóng hoặc trả/.test(b.getAttribute('aria-label') || ''));
  return { open: !!d, hasApptTrigger: !!trig, trigLabel: trig?.getAttribute('aria-label')?.slice(0, 60), text: (d?.innerText || '').replace(/\n/g, ' | ').slice(0, 180) };
});
console.log('DRAWER', JSON.stringify(drawer));
if (!drawer.hasApptTrigger) { console.log('FAIL: no appointment trigger in drawer'); await browser.close(); process.exit(1); }

const trig = await page.$('button[aria-label^="Giờ hẹn đóng hoặc trả"]');
await trig.click();
await new Promise((r) => setTimeout(r, 1200));

const pop = await page.evaluate(() => {
  const p = document.querySelector('.cus-appointment-popover') || document.querySelector('[role=dialog]');
  return {
    open: !!document.querySelector('.cus-appointment-popover'),
    pills: [...(p || document).querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean).slice(0, 14),
    text: (p?.innerText || '').replace(/\n/g, ' | ').slice(0, 220),
  };
});
console.log('POPOVER', JSON.stringify(pop));

// preset flow: tap 'Ngày kia' pill + '13:30' slot, then Enter
for (const b of await page.$$('button')) {
  const txt = await b.evaluate((e) => e.innerText.trim());
  if (txt === 'Ngày kia') { await b.click(); console.log('TAPPED preset Ngày kia'); break; }
}
await new Promise((r) => setTimeout(r, 500));
for (const b of await page.$$('button')) {
  const txt = await b.evaluate((e) => e.innerText.trim());
  if (txt === '13:30') { await b.click(); console.log('TAPPED slot 13:30'); break; }
}
await new Promise((r) => setTimeout(r, 500));
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 2500));

const outcome = await page.evaluate(() => ({
  popoverClosed: !document.querySelector('.cus-appointment-popover'),
  toasts: [...document.querySelectorAll('[role=status],[role=alert],[class*=toast]')].map((e) => (e.innerText || '').trim().slice(0, 60)).join(' / '),
  triggerLabel: (document.querySelector('button[aria-label^="Giờ hẹn đóng hoặc trả"]')?.getAttribute('aria-label') || '').slice(0, 80),
  banner: /Có thay đổi container chưa lưu/.test(document.body.innerText),
}));
console.log('OUTCOME_PRESET_ENTER', JSON.stringify(outcome));
console.log('PROBE', JSON.stringify(await probe(page)));

await shot(page, `${E}/preset-enter-after.png`, { full: false });
await setViewport(page, 390, 844);
await shot(page, `${E}/preset-enter-after-390.png`, { full: false });
await browser.close();
