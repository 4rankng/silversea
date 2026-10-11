// Round-14 Phase-0 probe 3 — corrected measurements:
// FB-006: editor CHILD opacity (the reveal rules move __editor > *), class list,
//         container-query width (the ≤1037px override keeps editors persistent).
// FB-069/FB-074: detail capture with the API list at its supported limit.
// FB-067: drawer via the row's own "Chi tiết" control.
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

// ─── FB-006 corrected probe ─────────────────────────────────────────────────
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
  await sleep(1500);
  await page.waitForSelector('input[placeholder="Chọn nhà máy"]', { timeout: 60000 });
  await (await page.$('input[placeholder="Chọn nhà máy"]')).click();
  await sleep(800);
  const optionLabel = await page.evaluate(() => document.querySelector('[role="option"]')?.textContent?.trim().slice(0, 60) ?? null);
  await page.evaluate(() => document.querySelector('[role="option"]')?.click());
  await sleep(900);

  const probeFn = () => {
    const cell = document.querySelector('td[data-field-id$="-factory"]') || document.querySelector('.csc-container-cell');
    const display = cell?.querySelector('[class*="__display"]');
    const editor = cell?.querySelector('[class*="__editor"]');
    const editorChild = editor?.firstElementChild;
    const magnifier = cell?.querySelector('button[aria-label^="Xem chi tiết"], button[aria-label*="kính lúp"], button[aria-label*="chi tiết"]');
    const table = cell?.closest('table, .csc-container-table, [class*="container-table"]');
    const op = (el) => (el ? getComputedStyle(el).opacity : 'absent');
    return {
      cellClasses: cell?.className ?? null,
      displayOpacity: op(display),
      displayText: display?.textContent?.trim().slice(0, 30) ?? null,
      editorChildOpacity: op(editorChild),
      editorChildTag: editorChild?.tagName ?? null,
      magnifierOpacity: op(magnifier),
      tableWidth: table ? Math.round(table.getBoundingClientRect().width) : null,
      viewport: window.innerWidth,
    };
  };
  const at1440 = await page.evaluate(probeFn);
  await page.screenshot({ path: `${EV}/fb006-5-corrected-1440.png` });
  await page.setViewport({ width: 1024, height: 900 });
  await sleep(700);
  const at1024 = await page.evaluate(probeFn);
  await page.screenshot({ path: `${EV}/fb006-6-corrected-1024.png` });
  await page.setViewport({ width: 1440, height: 1000 });
  step('probe3-fb006', { optionLabel, at1440, at1024 });
  await page.close();
}

// ─── FB-069/FB-074 detail capture ───────────────────────────────────────────
{
  const token = await login('thanhdc');
  const listRes = await fetch(`${API}/shipments?limit=50`, { headers: { Authorization: `Bearer ${token}` } });
  const listBody = await listRes.json();
  const items = listBody.items || listBody.data || listBody.shipments || (Array.isArray(listBody) ? listBody : []);
  const lots = items.filter((s) => String(s.weightKg ?? '').includes('.')).slice(0, 3).map((s) => ({
    id: s.id, weightKg: s.weightKg, cargoMode: s.cargoMode,
    route: s.routeName ?? s.rawRouteName ?? null,
  }));
  step('probe3-lots', { count: items.length, lots });

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
        routeRows: (text.match(/Tuyến đường[^A-Z]{0,60}/g) || []).slice(0, 4),
        weightRows: [...document.querySelectorAll('dt, tr, [class*="row"]')]
          .map((r) => (r.innerText || '').replace(/\s+/g, ' '))
          .filter((t) => /Trọng lượng/.test(t) && t.length < 120).slice(0, 6),
      };
    });
    await page.screenshot({ path: `${EV}/fb069-detail-lot-${lot.id}.png`, fullPage: true });
    step('probe3-detail', { lot, detail });
  }
  await page.close();
}

// ─── FB-067 drawer via row "Chi tiết" ───────────────────────────────────────
{
  const token = await login('dungnv');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
  await sleep(4000);
  const opened = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a, [role="button"]')]
      .filter((el) => (el.textContent || '').trim() === 'Chi tiết');
    if (btns.length) { btns[0].click(); return { clicked: btns[0].textContent.trim(), total: btns.length }; }
    return { clicked: null, total: 0 };
  });
  await sleep(2000);
  const drawer = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"], [class*="drawer"], [class*="Drawer"]');
    return {
      opened: Boolean(dlg),
      selects: document.querySelectorAll('select, [role="combobox"]').length,
      portish: (dlg?.innerText || '').replace(/\s+/g, ' ').match(/Cảng[^|]{0,50}/g)?.slice(0, 6) ?? [],
      text: (dlg?.innerText || '').replace(/\s+/g, ' ').slice(0, 350),
    };
  });
  await page.screenshot({ path: `${EV}/fb067-3-drawer.png` });
  step('probe3-fb067', { opened, drawer });
  await page.close();
}

await browser.close();
step('probe3-complete');
