// FB-038 UI rung driver v2 — real trusted pointer taps via Puppeteer CDP.
// Dialog fields are SearchableSelect comboboxes (no <label> elements): drive
// them click → select-all → type → click exact option.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const EV = '/Volumes/LexarSSD/projects/silversea-prod/qa/evidence/2026-10-08_fb038-fb001-minimax';
const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002';
const log = (m) => { console.log(`[driver] ${m}`); fs.appendFileSync(`${EV}/fb038_ui-driver.log`, `[puppeteer] ${m}\n`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shot = async (page, name) => { await page.screenshot({ path: `${EV}/${name}` }); log(`screenshot ${name}`); };

async function realClick(page, handle) {
  const box = await handle.asElement().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await page.mouse.down();
  await page.mouse.up();
}

const loginRes = await fetch(`${API}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
const { token } = await loginRes.json();
if (!token) throw new Error('no token');
log('api login ok');

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 900 } });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('input[placeholder="Bill, Cont, Tờ khai..."]', { timeout: 30000 });
  await page.click('input[placeholder="Bill, Cont, Tờ khai..."]');
  await page.keyboard.type('FBMM', { delay: 40 });
  await sleep(2000);
  log('filtered FBMM');

  const btn = await page.waitForFunction(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Phân xe lại') ?? null, { timeout: 30000 });
  await btn.asElement().evaluate((b) => b.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await realClick(page, btn);
  log('clicked Phân xe lại');
  await page.waitForFunction(() => document.body.textContent.includes('Xác nhận phân xe lại'), { timeout: 20000 });
  // wait for the dialog to finish loading (truck combo carries the current plate)
  await page.waitForFunction(() => [...document.querySelectorAll('input')].some((i) => i.value === 'QA-FB038-MM-B'), { timeout: 20000 });
  await shot(page, 'fb038_ui-2-reassign-dialog-open.png');
  log('dialog open + loaded');

  async function pickCombo(currentValue, search, exactOption) {
    const handle = await page.waitForFunction((cv) => [...document.querySelectorAll('input')].find((i) => i.value === cv) ?? null, { timeout: 15000 }, currentValue);
    const input = handle.asElement();
    await realClick(page, handle);
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(search, { delay: 30 });
    await sleep(1200); // dropdown options fetch
    const opt = await page.waitForFunction((exact) => {
      const cands = [...document.querySelectorAll('[role="option"], li, [class*=option]')]
        .filter((o) => o.textContent.trim() === exact && o.offsetParent != null);
      return cands[0] ?? null;
    }, { timeout: 15000 }, exactOption);
    await realClick(page, opt);
    await sleep(800);
    log(`combo ${currentValue} → ${exactOption}`);
  }

  await pickCombo('QA-FB038-MM-B', 'QA-FB038-MM', 'QA-FB038-MM');
  await pickCombo('QA-FB038-MM lái xe B', 'QA-FB038-MM', 'QA-FB038-MM lái xe');

  // verify the combos now carry the QA fixtures
  const state = await page.evaluate(() => [...document.querySelectorAll('input')]
    .filter((i) => i.value.includes('QA-FB038-MM')).map((i) => i.value));
  log('combo state: ' + JSON.stringify(state));
  if (!state.includes('QA-FB038-MM') || !state.includes('QA-FB038-MM lái xe')) {
    await shot(page, 'fb038_ui-debug-combo-state.png');
    throw new Error('combos not set: ' + JSON.stringify(state));
  }

  // reason — real tap + typing
  const reasonHandle = await page.waitForFunction(() => [...document.querySelectorAll('input, textarea')]
    .find((i) => i.value.includes('round-8 double-booking') || (i.placeholder || '').includes('Bắt buộc')) ?? null, { timeout: 10000 });
  await realClick(page, reasonHandle);
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.keyboard.type('QA-FB038-MM round-8 double-booking repro', { delay: 12 });
  log('reason typed');
  await shot(page, 'fb038_ui-3-dialog-filled.png');

  const confirm = await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Xác nhận phân xe lại'));
    return b && b.getAttribute('aria-disabled') !== 'true' ? b : null;
  }, { timeout: 15000 });
  await realClick(page, confirm);
  log('clicked Xác nhận phân xe lại');

  await page.waitForFunction(() => document.body.textContent.includes('trùng lịch kế hoạch'), { timeout: 20000 });
  await shot(page, 'fb038_ui-4-guard-409-error.png');
  const errText = await page.evaluate(() => {
    const el = document.querySelector('[role="alert"]');
    return el ? el.textContent.trim() : 'NO-ALERT';
  });
  log(`alert text: ${errText}`);
  console.log(JSON.stringify({ uiRung: 'CLICKED', alertText: errText }));
} finally {
  await browser.close();
  log('browser closed');
}
