// Round-14 Phase-0 staging probe — evidence intake for the ten broken tickets.
//
// Reproduces each round-14 FAIL at QA's exact environment (staging
// vantai.tingting.vip, build 68609387) to classify each ticket:
//   R real defect / S round-13 scope-miss / D data-dependent / P ruling conflict.
//
// READ-ONLY everywhere: the create form is never saved, /penalties and
// dispatch surfaces are inspected but not written. Writes belong to the
// fix-phase rungs where they can be net-zero (create + restore).
//
// Evidence: testplan/qa/evidence/2026-10-11_round14-phase0/
// Driver log: qa/2026-10-11_round14_phase0-ui-driver.log
import puppeteer from 'puppeteer';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-11_round14-phase0';
const DRIVER_LOG = '/Volumes/LexarSSD/projects/silversea-prod/qa/2026-10-11_round14_phase0-ui-driver.log';
mkdirSync(EV, { recursive: true });
writeFileSync(DRIVER_LOG, '');
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

const AX_NAME = 'Copy ngày giờ đóng trả';
const axHasCopyButton = async (page) => {
  const snap = await page.accessibility.snapshot({ interestingOnly: false });
  const stack = snap ? [snap] : [];
  while (stack.length) {
    const n = stack.pop();
    if ((n.name || '').includes(AX_NAME) && n.role === 'button') return true;
    if (n.children) stack.push(...n.children);
  }
  return false;
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const results = {};
const run = async (name, fn) => {
  try {
    results[name] = await fn();
    step('probe-done', { probe: name, ok: true });
  } catch (err) {
    results[name] = { error: String(err) };
    step('probe-done', { probe: name, ok: false, error: String(err) });
  }
};

// ─── FB-006 + FB-009 — create form (CUS thanhdc) ────────────────────────────
await run('fb006-factory-cell', async () => {
  const token = await login('thanhdc');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => step('goto', { note: 'networkidle timeout — continue' }));
  await page.waitForFunction(() => document.body.innerText.includes('Khách hàng'), { timeout: 90000 });

  const custInput = await page.evaluateHandle(() => {
    const lbl = [...document.querySelectorAll('label')].find((l) => (l.textContent || '').includes('Khách hàng'));
    return (lbl?.closest('div') ?? document).querySelector('input, [role="combobox"]');
  });
  await custInput.asElement().click();
  await page.keyboard.type('Long Minh');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="option"]')].some((o) => (o.textContent || '').toLowerCase().includes('long minh')), { timeout: 30000 }).catch(() => step('fb006', { note: 'no customer option matched — continue' }));
  await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || '').toLowerCase().includes('long minh'))?.click());
  await sleep(1500);

  await page.waitForSelector('input[placeholder="Chọn nhà máy"]', { timeout: 60000 });
  await (await page.$('input[placeholder="Chọn nhà máy"]')).click();
  await sleep(800);
  const optionLabel = await page.evaluate(() => document.querySelector('[role="option"]')?.textContent?.trim().slice(0, 60) ?? null);
  await page.evaluate(() => document.querySelector('[role="option"]')?.click());
  await sleep(800);

  const PROBE = `(marker) => {
    const cell = document.querySelector('td[data-field-id$="-factory"]')
      || document.querySelector('.csc-container-cell');
    const display = cell?.querySelector('.csc-container-cell__display, [class*="__display"]');
    const editor = cell?.querySelector('[class*="__editor"]');
    const input = cell?.querySelector('input');
    const op = (el) => el ? getComputedStyle(el).opacity : 'absent';
    return {
      marker, cellPresent: Boolean(cell), pickerClass: Boolean(cell?.classList.contains('csc-container-cell--picker')),
      inputAriaExpanded: input?.getAttribute('aria-expanded') ?? null,
      displayText: display?.textContent?.trim().slice(0, 40) ?? null,
      displayOpacity: op(display), editorOpacity: op(editor),
      viewport: window.innerWidth,
    };
  };`;
  const ac1 = await page.evaluate(`${PROBE}('after-pick-1440')`);
  await page.screenshot({ path: `${EV}/fb006-1-after-pick-1440.png` });
  step('fb006-after-pick-1440', { option: optionLabel, ...ac1 });

  await page.setViewport({ width: 1024, height: 900 });
  await sleep(600);
  const narrow = await page.evaluate(`${PROBE}('after-pick-1024')`);
  await page.screenshot({ path: `${EV}/fb006-2-after-pick-1024.png` });
  step('fb006-after-pick-1024', narrow);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.close();
  return { ac1, narrow, optionLabel };
});

await run('fb009-copy-button', async () => {
  const token = await login('thanhdc');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => step('goto', { note: 'networkidle timeout — continue' }));
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
  const segValues = { hh: '09', mm: '00', dd: '20', mm2: '10', yyyy: '2026' };
  for (const [seg, val] of Object.entries(segValues)) {
    const el = await page.$(`tr.csc-container-row input[data-seg="${seg}"]`);
    if (el) { await el.click({ clickCount: 3 }); await el.type(val); }
  }
  await page.keyboard.press('Tab');
  await sleep(800);

  const gating = await page.evaluate(() => ({
    rows: document.querySelectorAll('tr.csc-container-row').length,
    copyButtonsMounted: document.querySelectorAll('.csc-container-row__copy').length,
    sectionCopyMounted: [...document.querySelectorAll('button')].some((b) => (b.innerText || '').includes('Copy giờ hẹn')),
  }));
  const axAtRest = await axHasCopyButton(page);
  await page.mouse.move(5, 5);
  const rest = await page.evaluate(() => {
    const b = document.querySelector('.csc-container-row__copy');
    if (!b) return { button: false };
    const cs = getComputedStyle(b);
    return { button: true, opacity: cs.opacity, visibility: cs.visibility, display: cs.display };
  });
  await page.screenshot({ path: `${EV}/fb009-1-at-rest.png` });
  step('fb009-at-rest', { axAtRest, gating, rest });

  let hover = null;
  const rowHandle = await page.$('tr.csc-container-row');
  if (rowHandle) {
    await rowHandle.hover();
    await sleep(400);
    hover = await page.evaluate(() => {
      const b = document.querySelector('.csc-container-row__copy');
      return b ? { opacity: getComputedStyle(b).opacity } : { button: false };
    });
    await page.screenshot({ path: `${EV}/fb009-2-hover.png` });
    step('fb009-hover', hover);
  }
  await page.close();
  return { gating, axAtRest, rest, hover };
});

// ─── FB-069 + FB-074 — LCL overview vs detail (CUS thanhdc) ─────────────────
await run('fb069-fb074-lcl-detail', async () => {
  const token = await login('thanhdc');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
  await sleep(2500);

  // Find an LCL row with a decimal-looking weight; capture overview text.
  const overview = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr, [class*="shipment-row"]')];
    const lcl = rows.filter((r) => (r.textContent || '').includes('LCL'));
    return {
      rowCount: rows.length,
      lclCount: lcl.length,
      samples: lcl.slice(0, 5).map((r) => (r.innerText || '').replace(/\s+/g, ' ').slice(0, 220)),
      decimalWeightOnPage: (document.body.innerText.match(/\d+\.\d{2}\s*kg/g) || []).slice(0, 10),
    };
  });
  await page.screenshot({ path: `${EV}/fb069-0-overview-list.png` });
  step('fb069-overview', overview);

  // API ground truth: list shipments and find decimal-stored weights.
  const apiList = await page.evaluate(async () => {
    const res = await fetch('/api/shipments?limit=50', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    if (!res.ok) return { status: res.status };
    const body = await res.json();
    const items = body.items || body.data || body.shipments || (Array.isArray(body) ? body : []);
    return {
      status: 200,
      count: items.length,
      decimals: items.filter((s) => String(s.weightKg ?? s.cargoWeightKg ?? '').includes('.')).slice(0, 5)
        .map((s) => ({ id: s.id, bill: s.billNumber ?? s.sob ?? null, weightKg: s.weightKg ?? s.cargoWeightKg, cargoMode: s.cargoMode })),
    };
  });
  step('fb069-api-list', apiList);
  await page.close();
  return { overview, apiList };
});

// ─── FB-050 — FinancePage top-trucks bar chart (admin) ──────────────────────
await run('fb050-chart', async () => {
  const token = await login('admin');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/finance`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
  await sleep(3000);
  const chart = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h2,h3,h4')].find((h) => /xe|truck/i.test(h.textContent || ''));
    const region = heading?.parentElement ?? document.body;
    return {
      headingText: heading?.textContent?.trim() ?? null,
      svgCount: region.querySelectorAll('svg').length,
      text: (region.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
    };
  });
  await page.screenshot({ path: `${EV}/fb050-1-finance-top-trucks.png`, fullPage: true });
  step('fb050-chart', chart);
  await page.close();
  return chart;
});

// ─── FB-057 — topbar search width (admin) ───────────────────────────────────
await run('fb057-topbar-search', async () => {
  const token = await login('admin');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
  await sleep(2000);
  const probeWidth = () => page.evaluate(() => {
    const input = [...document.querySelectorAll('input')].find((i) => /tìm|search/i.test(`${i.placeholder || ''} ${i.getAttribute('aria-label') || ''}`));
    if (!input) return { found: false, placeholders: [...document.querySelectorAll('input')].map((i) => i.placeholder).slice(0, 10) };
    const cs = getComputedStyle(input);
    return { found: true, placeholder: input.placeholder, width: cs.width, maxWidth: cs.maxWidth, rectWidth: input.getBoundingClientRect().width };
  });
  const atRest = await probeWidth();
  const searchInput = await page.evaluateHandle(() => [...document.querySelectorAll('input')].find((i) => /tìm|search/i.test(`${i.placeholder || ''} ${i.getAttribute('aria-label') || ''}`)));
  if (searchInput.asElement()) {
    await searchInput.asElement().click();
    await page.keyboard.type('a');
    await sleep(500);
  }
  const focused = await probeWidth();
  await page.screenshot({ path: `${EV}/fb057-1-topbar-search.png` });
  step('fb057-search', { atRest, focused });
  await page.close();
  return { atRest, focused };
});

// ─── FB-051 — penalty save feedback surface (admin, READ-ONLY) ──────────────
await run('fb051-penalty-toast-surface', async () => {
  const token = await login('admin');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/penalties`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
  await sleep(2500);
  const surface = await page.evaluate(() => ({
    heading: document.querySelector('h1,h2')?.textContent?.trim() ?? null,
    buttons: [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean).slice(0, 20),
    toastNodesPresent: document.querySelectorAll('.toast, [role="status"], [role="alert"]').length,
  }));
  await page.screenshot({ path: `${EV}/fb051-1-penalties-surface.png`, fullPage: true });
  step('fb051-surface', surface);
  await page.close();
  return surface;
});

// ─── FB-067 — master-plan container drawer port editors (dungnv) ────────────
await run('fb067-ports-drawer', async () => {
  const token = await login('dungnv');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
  await sleep(3500);
  const board = await page.evaluate(() => ({
    bodyStart: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
    clickableRows: document.querySelectorAll('tr, [class*="row"]').length,
  }));
  await page.screenshot({ path: `${EV}/fb067-1-master-plan.png`, fullPage: true });
  step('fb067-board', board);
  await page.close();
  return board;
});

// ─── FB-038/072 — dispatch detail warning surface (dungnv) ──────────────────
await run('fb038-overlap-warning-surface', async () => {
  const token = await login('dungnv');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
  await sleep(3500);
  const surface = await page.evaluate(() => ({
    bodyStart: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
    warningNodes: [...document.querySelectorAll('[class*="warn"], [role="alert"]')].map((n) => (n.textContent || '').trim().slice(0, 80)).slice(0, 10),
  }));
  await page.screenshot({ path: `${EV}/fb038-1-dispatch-detail.png`, fullPage: true });
  step('fb038-surface', surface);
  await page.close();
  return surface;
});

writeFileSync(`${EV}/results.json`, JSON.stringify(results, null, 2));
step('phase0-complete', { probes: Object.keys(results).length });
await browser.close();
