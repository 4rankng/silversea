// Round-14 Phase-0 probe 4 — FB-009 state matrix + FB-069 detail capture.
// 1) appointment entered via segments WITHOUT Tab (mouse click-away) — does
//    the copy button mount? (the suspected 'mất hẳn' hole)
// 2) after Tab-commit — button mounts (control).
// 3) both rows filled — button absent (by design, nothing to copy).
// 4) FB-069/FB-074: detail page text for decimal-weight lots (fixed field).
import puppeteer from 'puppeteer';
import { appendFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-11_round14-phase0';
const DRIVER_LOG = '/Volumes/LexarSSD/projects/silversea-prod/qa/2026-10-11_round14_phase0-ui-driver.log';
mkdirSync(EV, { recursive: true });
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(DRIVER_LOG, line + '\n');
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

// ─── FB-009 state matrix ────────────────────────────────────────────────────
{
  const token = await login('thanhdc');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
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

  const addBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')]
    .find((b) => (b.innerText || '').trim() === 'Thêm container'));
  await addBtn.asElement().click();
  await sleep(600);

  // (1) type segments on row 1, click away (NO Tab).
  const segValues = { hh: '09', mm: '00', dd: '20', mm2: '10', yyyy: '2026' };
  for (const [seg, val] of Object.entries(segValues)) {
    const el = await page.$(`tr.csc-container-row input[data-seg="${seg}"]`);
    if (el) { await el.click({ clickCount: 3 }); await el.type(val); }
  }
  await page.mouse.click(5, 5); // click away — blur, no Tab
  await sleep(800);
  const afterClickAway = await page.evaluate(() => ({
    copyButtons: document.querySelectorAll('.csc-container-row__copy').length,
    segValues: [...document.querySelectorAll('tr.csc-container-row input[data-seg]')].map((i) => `${i.dataset.seg}=${i.value}`).join(','),
  }));
  await page.screenshot({ path: `${EV}/fb009-3-clickaway.png` });
  step('probe4-fb009-clickaway', afterClickAway);

  // (2) Tab-commit control.
  const seg = await page.$('tr.csc-container-row input[data-seg="yyyy"]');
  if (seg) { await seg.click(); await page.keyboard.press('Tab'); }
  await sleep(800);
  const afterTab = await page.evaluate(() => ({
    copyButtons: document.querySelectorAll('.csc-container-row__copy').length,
  }));
  step('probe4-fb009-tab', afterTab);

  // (3) fill row 2 as well → no destination.
  const rows = await page.$$('tr.csc-container-row');
  if (rows[1]) {
    for (const [sg, val] of Object.entries(segValues)) {
      const el = await rows[1].$(`input[data-seg="${sg}"]`);
      if (el) { await el.click({ clickCount: 3 }); await el.type(val); }
    }
    await page.keyboard.press('Tab');
    await sleep(800);
  }
  const bothFilled = await page.evaluate(() => ({
    copyButtons: document.querySelectorAll('.csc-container-row__copy').length,
    sectionCopy: [...document.querySelectorAll('button')].filter((b) => (b.innerText || '').includes('Copy giờ hẹn')).map((b) => b.innerText.trim().slice(0, 40)),
  }));
  await page.screenshot({ path: `${EV}/fb009-4-both-filled.png` });
  step('probe4-fb009-both-filled', bothFilled);
  await page.close();
}

// ─── FB-069/FB-074 detail capture (fixed field name) ────────────────────────
{
  const token = await login('thanhdc');
  const listRes = await fetch(`${API}/shipments?limit=50`, { headers: { Authorization: `Bearer ${token}` } });
  const listBody = await listRes.json();
  const items = listBody.items || listBody.data || listBody.shipments || (Array.isArray(listBody) ? listBody : []);
  const lots = items.filter((s) => String(s.weightKg ?? s.cargoWeightKg ?? '').includes('.')).slice(0, 3).map((s) => ({
    id: s.id, weight: s.weightKg ?? s.cargoWeightKg, mode: s.cargoMode,
  }));
  step('probe4-lots', { count: items.length, lots });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  for (const lot of lots) {
    await page.goto(`${BASE}/shipments/${lot.id}`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
    await sleep(2500);
    const detail = await page.evaluate(() => {
      const text = (document.body.innerText || '').replace(/\s+/g, ' ');
      return {
        weightMentions: (text.match(/[\d.,]+\s*kg/g) || []).slice(0, 12),
        routeRows: (text.match(/Tuyến đường\s[^|]{0,60}/g) || []).slice(0, 4),
        detailPairs: [...document.querySelectorAll('dt')].map((dt) => `${dt.textContent.trim()}=${dt.nextElementSibling?.textContent?.trim().slice(0, 40) ?? ''}`).slice(0, 20),
      };
    });
    await page.screenshot({ path: `${EV}/fb069-detail2-lot-${lot.id}.png`, fullPage: true });
    step('probe4-detail', { lot, detail });
  }
  await page.close();
}

await browser.close();
step('probe4-complete');
