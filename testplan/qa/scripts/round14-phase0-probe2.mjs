// Round-14 Phase-0 follow-up probe — the probes whose first pass was
// incomplete: FB-006 style probe (fixed evaluate wrapper), FB-069/FB-074
// detail-page capture on a real "500.00" LCL lot, FB-050 chart DOM,
// FB-067 drawer deep probe. READ-ONLY.
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

// ─── FB-069 + FB-074 — open the detail of a "500.00" LCL lot ────────────────
{
  const token = await login('thanhdc');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  // Ground truth list — pick the LCL lots with decimal weights (Node-side).
  const listRes = await fetch(`${API}/shipments?limit=100`, { headers: { Authorization: `Bearer ${token}` } });
  const listBody = await listRes.json();
  const items = listBody.items || listBody.data || listBody.shipments || (Array.isArray(listBody) ? listBody : []);
  const lotIds = items.filter((s) => String(s.weightKg ?? '').includes('.')).slice(0, 3).map((s) => ({
    id: s.id, weightKg: s.weightKg, cargoMode: s.cargoMode,
    route: s.routeName ?? s.rawRouteName ?? null,
    bill: s.billNumber ?? s.sob ?? null,
  }));
  step('probe2-lot-candidates', { lotIds });

  for (const lot of lotIds) {
    await page.goto(`${BASE}/shipments/${lot.id}`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
    await sleep(2500);
    const detail = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('dt, tr, [class*="detail"]')];
      const text = (document.body.innerText || '').replace(/\s+/g, ' ');
      return {
        weightMentions: (text.match(/[\d.,]+\s*kg/g) || []).slice(0, 12),
        routeMentions: (text.match(/Tuyến[^\n]{0,80}/g) || []).slice(0, 6),
        weightRows: rows.map((r) => (r.innerText || '').replace(/\s+/g, ' ')).filter((t) => /Trọng lượng|kg/.test(t)).slice(0, 8),
      };
    });
    await page.screenshot({ path: `${EV}/fb069-detail-lot-${lot.id}.png`, fullPage: true });
    step('probe2-detail', { lot, detail });
  }
  await page.close();
}

// ─── FB-006 — style probe with a correct call wrapper ───────────────────────
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
    const input = cell?.querySelector('input');
    const op = (el) => (el ? getComputedStyle(el).opacity : 'absent');
    return {
      cellPresent: Boolean(cell),
      pickerClass: Boolean(cell?.classList.contains('csc-container-cell--picker')),
      inputAriaExpanded: input?.getAttribute('aria-expanded') ?? null,
      displayText: display?.textContent?.trim().slice(0, 40) ?? null,
      displayOpacity: op(display),
      editorOpacity: op(editor),
      viewport: window.innerWidth,
    };
  };
  const at1440 = await page.evaluate(probeFn);
  await page.screenshot({ path: `${EV}/fb006-3-probe-1440.png` });
  await page.setViewport({ width: 1024, height: 900 });
  await sleep(700);
  const at1024 = await page.evaluate(probeFn);
  await page.screenshot({ path: `${EV}/fb006-4-probe-1024.png` });
  step('probe2-fb006', { optionLabel, at1440, at1024 });
  await page.close();
}

// ─── FB-050 — chart DOM detail (admin) ──────────────────────────────────────
{
  const token = await login('admin');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/finance`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
  await sleep(3000);
  const chart = await page.evaluate(() => {
    const headings = [...document.querySelectorAll('*')].filter((h) => /^Top xe/.test((h.textContent || '').trim()) && h.children.length < 8);
    const head = headings[headings.length - 1];
    const card = head?.closest('.wf-card, .wf-chart, section, div');
    return {
      heading: head?.textContent?.trim().slice(0, 60) ?? null,
      svg: Boolean(card?.querySelector('svg')),
      svgAria: card?.querySelector('svg')?.getAttribute('aria-label') ?? null,
      cardText: (card?.innerText || '').replace(/\s+/g, ' ').slice(0, 500),
    };
  });
  const chartEl = await page.evaluateHandle(() => {
    const headings = [...document.querySelectorAll('*')].filter((h) => /^Top xe/.test((h.textContent || '').trim()) && h.children.length < 8);
    return headings[headings.length - 1]?.closest('.wf-card, .wf-chart, section, div');
  });
  if (chartEl.asElement()) await chartEl.asElement().screenshot({ path: `${EV}/fb050-2-top-trucks-card.png` }).catch(() => page.screenshot({ path: `${EV}/fb050-2-top-trucks-card.png`, fullPage: true }));
  step('probe2-fb050', chart);
  await page.close();
}

// ─── FB-067 — open a container drawer on the master plan ────────────────────
{
  const token = await login('dungnv');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
  await sleep(3500);
  const opened = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('button, a, [role="button"], td')].filter((el) => /Chi tiết|xem chi tiết|cont/i.test((el.textContent || '').trim()) && (el.textContent || '').trim().length < 40);
    if (cands[0]) { cands[0].click(); return cands[0].textContent.trim().slice(0, 40); }
    return null;
  });
  await sleep(1800);
  const drawer = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"], [class*="drawer"]');
    return {
      opened: Boolean(dlg),
      hasPortSelects: [...document.querySelectorAll('select, [role="combobox"]')].length,
      portish: (dlg?.innerText || '').replace(/\s+/g, ' ').match(/Cảng[^|]{0,60}/g)?.slice(0, 6) ?? [],
      text: (dlg?.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
    };
  });
  await page.screenshot({ path: `${EV}/fb067-2-drawer.png` });
  step('probe2-fb067', { opened, drawer });
  await page.close();
}

await browser.close();
step('probe2-complete');
