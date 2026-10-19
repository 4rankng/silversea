// FB-114 (kanban card 171026122150) — verify the LANDED fix, not re-fix it.
// Two halves, both claimed fixed by other lanes (e11cd255 hit target +
// 330169fc honest dialog copy):
//   1. the "+" Thêm hãng tàu target is comfortably hittable, and clicks at its
//      EDGES land on it — while the neighbouring field still gets its own click
//   2. the dialog names a shipping line for THIS lot and the value reaches the
//      form field (the card's "thêm xong không lưu data")
// LOCAL ONLY: vite 7175 -> api 3002.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb114';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let L = null;
for (let i = 1; i <= 3 && !L?.token; i++) {
  const t = await (await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
  })).text();
  try { L = JSON.parse(t); } catch { await sleep(1200 * i); }
}
if (!L?.token) { console.log('LOGIN FAILED as admin'); process.exit(1); }

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), L.token);

const boxOf = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}, sel);

const dialogText = () => page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]');
  return dlg ? (dlg.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) : null;
});

try {
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(7000);

  // The shipping-line block renders for FCL (the default mode); the lane
  // renamed the action, so match the live aria-label.
  const SEL = '[aria-label="Đặt tên hãng tàu cho lô này"]';
  const mode = await page.evaluate(() => {
    const body = document.body.innerText || '';
    return {
      hasShippingLineLabel: /Hãng tàu/.test(body),
      hasPencilAction: Boolean(document.querySelector('[aria-label="Đặt tên hãng tàu cho lô này"]')),
      hasCustomerAction: Boolean(document.querySelector('[aria-label="Thêm khách hàng"]')),
    };
  });
  console.log('page state =', JSON.stringify(mode));

  const btn = await boxOf(SEL);
  console.log('BUTTON BOX =', JSON.stringify(btn));
  if (!btn) { console.log('=== FAIL: no Thêm hãng tàu button (FCL may not be selected) ==='); await browser.close(); process.exit(1); }

  const INPUT_SEL = '#shipment-shipping-line input, [data-field-id="shipment-shipping-line"] input';
  const inputBox = await boxOf(INPUT_SEL);
  console.log('INPUT BOX  =', JSON.stringify(inputBox));
  const gap = inputBox ? Math.round(btn.x - (inputBox.x + inputBox.w)) : null;
  console.log(`button size = ${btn.w}x${btn.h} | gap to input's right edge = ${gap}px`);
  await page.screenshot({ path: `${SHOTS}/01-form.png` });

  const sizeOk = btn.w >= 32 && btn.h >= 32;

  // --- 1. click near the button's TOP-LEFT inch: reaches the outermost part of
  //        the target rather than the icon's centre.
  const probe = async (dx, dy, label) => {
    await page.mouse.click(btn.x + dx, btn.y + dy);
    await sleep(1200);
    const txt = await dialogText();
    const opened = txt != null && /hãng tàu/i.test(txt);
    await page.screenshot({ path: `${SHOTS}/02-click-${label}.png` });
    if (opened) {
      await page.keyboard.press('Escape');
      await sleep(900);
    }
    return opened;
  };
  const topLeft = await probe(2, 2, 'topleft');
  console.log(`click at (+2,+2) opened the dialog = ${topLeft}`);
  const bottomRight = await probe(Math.round(btn.w) - 3, Math.round(btn.h) - 3, 'bottomright');
  console.log(`click at (w-3,h-3) opened the dialog = ${bottomRight}`);

  // --- 2. the neighbouring field must keep its own click (no stolen hit area)
  let inputKeptClick = null;
  if (inputBox) {
    await page.evaluate((sel) => document.querySelector(sel)?.focus(), INPUT_SEL);
    await page.mouse.click(inputBox.x + 10, inputBox.y + inputBox.h / 2);
    await sleep(1000);
    const state = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const dlg = document.querySelector('[role="dialog"]');
      return {
        inputFocused: document.activeElement === el,
        dialogOpen: dlg != null && /hãng tàu/i.test(dlg.textContent || ''),
      };
    }, INPUT_SEL);
    inputKeptClick = state;
    console.log('neighbour click state =', JSON.stringify(state));
    await page.screenshot({ path: `${SHOTS}/03-neighbour.png` });
    if (state.dialogOpen) { await page.keyboard.press('Escape'); await sleep(800); }
  }

  // --- 3. the "not saved" half: name a line, apply, and see it reach the field
  await page.mouse.click(btn.x + btn.w / 2, btn.y + btn.h / 2);
  await sleep(1500);
  const copy = await dialogText();
  console.log('DIALOG COPY =', JSON.stringify(copy));
  const honestCopy = Boolean(copy) && !/thêm vào danh mục|thêm mới hãng tàu vào/i.test(copy) && /hãng tàu/i.test(copy);

  const NAME = `FB114-VERIFY-${Date.now() % 100000}`;
  const typed = await page.evaluate((name) => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return false;
    const input = dlg.querySelector('input[type="text"], input:not([type])');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, NAME);
  console.log('typed into dialog =', typed);
  await sleep(600);

  const applied = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return 'no-dialog';
    const btn = [...dlg.querySelectorAll('button')]
      .find((b) => /lưu|áp dụng|đặt tên|thêm|đồng ý/i.test((b.textContent || '').trim()));
    if (!btn) return 'no-apply-button';
    const label = (btn.textContent || '').trim();
    btn.click();
    return label;
  });
  console.log('apply button clicked =', applied);
  await sleep(1500);

  const saved = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.value : null;
  }, INPUT_SEL);
  const savedOk = saved === NAME;
  console.log(`field value after apply = ${JSON.stringify(saved)} | expected ${JSON.stringify(NAME)} | saved = ${savedOk}`);
  await page.screenshot({ path: `${SHOTS}/04-saved.png` });

  console.log('\n--- verdict ---');
  console.log(`target >=32px               : ${sizeOk} (${btn.w}x${btn.h})`);
  console.log(`click at top-left edge      : ${topLeft}`);
  console.log(`click at bottom-right edge  : ${bottomRight}`);
  console.log(`neighbour field keeps click : ${inputKeptClick ? !inputKeptClick.dialogOpen : 'n/a'}`);
  console.log(`dialog copy honest          : ${honestCopy}`);
  console.log(`named line reaches the form : ${savedOk}`);

  const ok = sizeOk && topLeft && bottomRight
    && (!inputKeptClick || !inputKeptClick.dialogOpen) && savedOk;
  console.log(ok ? '\n=== PASS ===' : '\n=== FAIL ===');
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.log('ERR', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
