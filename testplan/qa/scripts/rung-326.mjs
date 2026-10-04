// Rung 326: segmented date/time auto-advance in "Chỉnh sửa điều phối" (Giờ trả hàng) — real typing + focus assertions.
// mutates: none (types but never saves; dialog closed via Hủy)
import { launch, tap, probe, shot, setViewport } from './lead-qa-lib.mjs';

const base = process.env.QA_BASE || 'http://localhost:7175';
const E = process.env.EVID_DIR;
const { browser, page } = await launch({ width: 1440, height: 1000 });
const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
const { token } = await res.json();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${base}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));

// open "Chỉnh sửa điều phối" on the first row that has the trigger
const trigInfo = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].filter((b) => /Chỉnh sửa điều phối/i.test(b.getAttribute('aria-label') || b.innerText || ''));
  return { count: btns.length };
});
console.log('TRIGGERS', JSON.stringify(trigInfo));
const el = await page.$('button[aria-label="Chỉnh sửa điều phối"], button[aria-label*="Chỉnh sửa điều phối"]');
if (!el) { console.log('FAIL: no editor trigger — dump:', await page.evaluate(() => document.body.innerText.slice(0, 200))); await browser.close(); process.exit(1); }
await el.click(); // real CDP click
await new Promise((r) => setTimeout(r, 1500));

const dlg = await page.evaluate(() => {
  const d = document.querySelector('[role=dialog]');
  return { open: !!d, hasEndGroup: /Giờ trả hàng/.test(d?.innerText || ''), text: (d?.innerText || '').replace(/\n/g, ' | ').slice(0, 240) };
});
console.log('DIALOG', JSON.stringify(dlg));

async function activeLabel() {
  return page.evaluate(() => {
    const a = document.activeElement;
    return (a?.getAttribute('aria-label') || a?.placeholder || a?.tagName || 'none');
  });
}

// AC1a: hour "08" → focus advances to PHÚT
const hour = await page.$('input[aria-label="Giờ — Giờ trả hàng"]');
if (!hour) { console.log('FAIL: no hour segment'); await browser.close(); process.exit(1); }
await hour.click();
await page.keyboard.type('08', { delay: 120 });
await new Promise((r) => setTimeout(r, 500));
const afterHour = await activeLabel();
console.log('AFTER_HOUR_08', JSON.stringify({ focus: afterHour, advancedToMinute: /Phút/.test(afterHour) }));

// AC1b: day "02" → focus advances to THÁNG
const day = await page.$('input[aria-label="Ngày — Giờ trả hàng"]');
await day.click();
await page.keyboard.type('02', { delay: 120 });
await new Promise((r) => setTimeout(r, 500));
const afterDay = await activeLabel();
console.log('AFTER_DAY_02', JSON.stringify({ focus: afterDay, advancedToMonth: /Tháng/.test(afterDay) }));
console.log('PROBE', JSON.stringify(await probe(page)));

for (const [w, h] of [[1280, 900], [1440, 900], [1920, 1080], [2560, 1400]]) {
  await setViewport(page, w, h);
  await shot(page, `${E}/editor-${w}.png`, { full: false });
}
await setViewport(page, 1440, 900);
const gbox = await page.evaluate(() => {
  const g = document.querySelector('[role=group][aria-label="Giờ trả hàng"], fieldset');
  const all = [...document.querySelectorAll('[role=dialog] *')].find((e) => /Giờ trả hàng/.test(e.getAttribute('aria-label') || '') && e.getBoundingClientRect().height > 20);
  const b = (all || g).getBoundingClientRect();
  return { x: b.x - 12, y: b.y - 12, width: b.width + 24, height: b.height + 24 };
});
await page.screenshot({ path: `${E}/segments-crop.png`, clip: { x: Math.max(0, gbox.x), y: Math.max(0, gbox.y), width: gbox.width, height: gbox.height } });
await setViewport(page, 390, 844);
await shot(page, `${E}/editor-390.png`, { full: false });

for (const b of await page.$$('button')) {
  const txt = await b.evaluate((e) => e.innerText.trim());
  if (txt === 'Hủy' || txt === 'Huỷ') { await b.click(); break; }
}
await new Promise((r) => setTimeout(r, 800));
console.log('CLOSE', JSON.stringify({ dialogGone: await page.evaluate(() => !document.querySelector('[role=dialog]')) }));
await browser.close();
