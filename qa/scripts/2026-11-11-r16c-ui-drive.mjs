// r16c lane (SIL-786/788/789/790/797/799/802) — verify-first UI driver.
// LOCAL dev only — FE :7185 / BE :3012 of THIS worktree (r16c-fix). Never staging.
//   node qa/scripts/2026-11-11-r16c-ui-drive.mjs [cus|driver|ketoan|all]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FE = 'http://localhost:7185';
const API = 'http://localhost:3012/api';
const OUT = path.resolve('qa/2026-11-11_r16c');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (l) => { console.log(l); fs.appendFileSync(LOG, l + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `ui-${name}.png`) });

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} HTTP ${res.status}`);
  const body = await res.json();
  return body.token ?? body.accessToken;
}

async function api(token, method, urlPath, body) {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      // Material writes are idempotency-keyed server-side — the probe is a
      // real client, not an anonymous one.
      ...(body ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.text() };
}

const phase = process.argv[2] ?? 'all';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });

async function pageAs(token, pathname, { width = 1440, height = 950 } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${FE}${pathname}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3600);
  return page;
}

// ═══════════ CUS ═══════════
if (phase === 'all' || phase === 'cus') {
  const cus = await login('tiepvv');

  // SIL-786 — row click opens the drawer on the list, with Khai chi phí inside.
  {
    const page = await pageAs(cus, '/shipments');
    const clicked = await page.evaluate(() => {
      const row = document.querySelector('.cus-dashboard-row');
      if (!row) return 'no-row';
      const statusCell = row.querySelector('td[data-label="Trạng thái"]') ?? row;
      const rect = statusCell.getBoundingClientRect();
      // Click the CELL PADDING (top-left +4px) — not the labelled Chi tiết button.
      statusCell.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + 4, clientY: rect.top + 4 }));
      return 'clicked';
    });
    await sleep(2600);
    const drawer = await page.evaluate(() => {
      const el = document.querySelector('.cus-shipment-drawer');
      if (!el) return null;
      const btn = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('Khai chi phí'));
      return { open: true, khaiChiPhi: Boolean(btn) };
    });
    check('SIL-786 row click opens the CUS drawer', clicked === 'clicked' && drawer != null, JSON.stringify({ clicked, drawer }));
    check('SIL-786 drawer carries [Khai chi phí] for CUS', drawer?.khaiChiPhi === true);
    await shot(page, '786-cus-row-drawer');
    await page.close();
  }

  // SIL-788 — create form band map (Khách hàng·XNK | Bill·Hãng tàu | tuỳ chọn).
  {
    const page = await pageAs(cus, '/shipments/new');
    const bands = await page.evaluate(() => {
      const box = (fid) => { const el = document.querySelector(`[data-field-id="${fid}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left) }; };
      return {
        customer: box('shipment-customer'),
        trade: box('shipment-trade-direction'),
        booking: box('shipment-booking-ref'),
        shipping: box('shipment-shipping-line'),
      };
    });
    const sameRow = (a, b) => a != null && b != null && Math.abs(a.top - b.top) <= 3;
    const below = (a, b) => a != null && b != null && b.top > a.top + 10;
    check('SIL-788 band1 = Khách hàng · Hình thức XNK same row', sameRow(bands.customer, bands.trade), JSON.stringify(bands));
    check('SIL-788 band2 = Số Bill/Booking · Hãng tàu same row', sameRow(bands.booking, bands.shipping));
    check('SIL-788 band2 below band1', below(bands.customer, bands.booking));
    await shot(page, '788-create-bands');
    await page.close();
  }

  // SIL-789 — locked-lot probe (ketoan token reads the debit summary).
  const kt = await login('hoapt');
  const summaryRes = await api(kt, 'GET', '/shipments/debit-summary?lockStatus=LOCKED');
  let lockedLotId = null;
  let lockedBill = null;
  try {
    const parsed = JSON.parse(summaryRes.body);
    const rows = parsed.lots ?? parsed.items ?? parsed.rows ?? [];
    // SIL-789's surface is the CONTAINER-row tờ khai cell — a locked lot with
    // no container rows has no cell to gate; probe until one carries a row.
    for (const first of rows) {
      const id = first?.shipmentId ?? first?.id ?? null;
      if (id == null) continue;
      const probe = await api(cus, 'GET', `/shipments/cus-workspace/${id}`);
      const probeDetail = JSON.parse(probe.body);
      if ((probeDetail.containers?.length ?? 0) > 0) {
        lockedLotId = id;
        lockedBill = first?.billOrBookNumber ?? first?.lotLabel ?? null;
        globalThis.__lockedProbeDetail = probeDetail;
        break;
      }
    }
  } catch { /* summary shape drift — probe stays null */ }
  log(`locked lot probe: HTTP ${summaryRes.status} → id=${lockedLotId} bill=${lockedBill}`);

  if (lockedLotId != null) {
    const detail = globalThis.__lockedProbeDetail;
    const contId = detail.containers?.[0]?.id;
    const lockedFlag = detail.summary?.costLocked;
    const declAccess = detail.summary?.fieldAccess?.declarationNumber;
    check('SIL-789 wire: locked lot publishes costLocked=true', lockedFlag === true, `summary.costLocked=${lockedFlag}`);
    check('SIL-789 wire: declarationNumber READ_ONLY with KB reason', declAccess?.mode === 'READ_ONLY' && declAccess?.reason === 'Lô hàng đã khóa kế toán; không thể sửa tờ khai.', JSON.stringify(declAccess));
    if (contId != null) {
      const save = await api(cus, 'POST', `/shipments/cus-workspace/${lockedLotId}/containers/${contId}`, {
        expectedShipmentVersion: detail.summary.version,
        declarationNumber: 'TK-SIL789-BLOCK-PROBE',
      });
      check('SIL-789 source: locked lot refuses declaration save (409 + KB copy)', save.status === 409 && save.body.includes('Lô hàng đã khóa kế toán; không thể sửa tờ khai.'), `HTTP ${save.status} ${save.body.slice(0, 140)}`);
    }

    const bill = detail.summary?.billOrBookNumber ?? '';
    const page = await pageAs(cus, `/shipments?searchSuffix=${encodeURIComponent(bill)}`);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Chi tiết');
      btn?.click();
    });
    await sleep(2800);
    const lockCell = await page.evaluate(() => {
      const drawer = document.querySelector('.cus-shipment-drawer');
      if (!drawer) return null;
      const input = drawer.querySelector('.cus-lot-decl__input');
      const note = drawer.querySelector('.cus-lot-decl__lock');
      return { hasInput: Boolean(input), reason: note?.textContent ?? null };
    });
    check('SIL-789 UI: locked drawer declaration cell static with the KB reason line', lockCell != null && lockCell.hasInput === false && (lockCell.reason ?? '').includes('không thể sửa tờ khai'), JSON.stringify(lockCell));
    await shot(page, '789-locked-declaration-cell');
    await page.close();
  }

  // SIL-790 — Chốt giá bán drawer: dual-input presence probe.
  {
    const page = await pageAs(cus, '/shipments-debit');
    const opened = await page.evaluate(() => {
      // Only DATA rows toggle the drawer (title = Mở Chốt giá bán); group
      // rows and the select cell never route the click.
      // An OPEN lot only — the seed (and every input) freezes on locked rows;
      // the pair surface under test is the editable one.
      const row = [...document.querySelectorAll('tbody tr.shipment-debit-row')]
        .find((tr) => !tr.hasAttribute('data-locked') && tr.getAttribute('title')?.includes('Chốt giá bán'));
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return row?.getAttribute('title') ?? Boolean(row);
    });
    await sleep(2800);
    const probe = await page.evaluate(() => {
      const drawer = document.querySelector('.shipment-debit-drawer');
      const labels = [...(drawer ?? document).querySelectorAll('span, label, small')].map((el) => el.textContent?.trim() ?? '');
      return {
        drawerOpen: Boolean(drawer),
        // SIL-790 — the pair rides per-fee rows; an intake lot (no container
        // rows) states the block instead. Either surface names both cells.
        thucChiOps: labels.some((t) => t === 'Thực chi Ops'),
        thuKhachHang: labels.some((t) => t === 'Thu khách hàng'),
        intakeStrip: Boolean(drawer?.querySelector('[data-testid="debit-no-fee-block"]')),
        seedName: drawer?.querySelector('input[aria-label^="Tên phí mới"]')?.getAttribute('value') ?? null,
      };
    });
    check('SIL-790 drawer probe ran', Boolean(opened) && probe.drawerOpen === true, JSON.stringify(probe));
    check('SIL-790 dual-input pair present (fee rows or the named intake strip)', (probe.thucChiOps && probe.thuKhachHang) || probe.intakeStrip, JSON.stringify(probe));
    await shot(page, '790-debit-drawer');
    await page.close();
  }
}

// ═══════════ DRIVER ═══════════
if (phase === 'all' || phase === 'driver') {
  const drv = await login('bqhuong');

  // SIL-797 — the task pill owns its line (mobile 390 first — driver surface).
  {
    const page = await pageAs(drv, '/my-trips', { width: 390, height: 844 });
    const pill = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="load-type"]');
      if (!el) return null;
      const line = el.closest('p');
      return {
        text: el.textContent,
        lineClass: line?.className ?? '',
        insideContainerStrip: Boolean(el.closest('.driver-journey-card__container')),
      };
    });
    check('SIL-797 task pill on its own line, outside the container strip', pill != null && (pill.lineClass ?? '').includes('driver-journey-card__task') && pill.insideContainerStrip === false, JSON.stringify(pill));
    await shot(page, '797-driver-task-line');
    await page.close();
  }

  // SIL-799 — the earnings tab names the period state.
  {
    const page = await pageAs(drv, '/my-earnings', { width: 390, height: 844 });
    const state = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="period-state"]');
      return el ? { text: el.textContent, state: el.getAttribute('data-state') } : null;
    });
    check('SIL-799 earnings tab names the period state', state != null && state.text.length > 0, JSON.stringify(state));
    await shot(page, '799-earnings-period-state');
    await page.close();
  }
}

// ═══════════ KẾ TOÁN ═══════════
if (phase === 'all' || phase === 'ketoan') {
  // The local dev db's only board (driver 11 · 2026-11) carries no Q yet —
  // seed ONE Q as the writer role so a cell exists to measure; the KB color
  // is a cell law, identical on the read-only accountant view.
  const dvl = await login('dieuvan');
  const seeded = await api(dvl, 'PUT', '/timesheet/months/6/days', {
    days: [{ workDate: '2026-11-12', symbol: 'Q' }],
  });
  log(`Q seed on month 6: HTTP ${seeded.status}`);

  // The grid CELL (color law) is identical on the read-only accountant view —
  // drive HOAPT per the ticket. UUI select = react-aria trigger + portalled
  // listbox (never a native <select>): click the trigger, click the option.
  const driversRes = await api(dvl, 'GET', '/timesheet/drivers?year=2026&month=11');
  const driverRows = JSON.parse(driversRes.body).items ?? [];
  const targetDriver = driverRows.find((row) => (row.id ?? row.driverId) === 11);
  const driverName = targetDriver?.name ?? null;
  if (driverName == null) {
    log(`FAIL driver-11 name not on wire (${driverRows.length} rows)`);
    failures += 1;
  } else {
    const kt2 = await login('hoapt');
    const page = await pageAs(kt2, '/timesheet');
    const q = await page.evaluate(async (name) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      // UUI combobox: the trigger is the combobox INPUT (no native button).
      let trigger = null;
      for (let i = 0; i < 12; i += 1) {
        trigger = document.querySelector('.ts-driver-select [data-uui-control="combobox"] input, .ts-driver-select input');
        if (trigger) break;
        await sleep(1000);
      }
      if (!trigger) return { error: 'no-trigger' };
      trigger.click();
      await sleep(600);
      // Searchable combobox: typing narrows the option list to the name.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(trigger, name);
      trigger.dispatchEvent(new Event('input', { bubbles: true }));
      let option = null;
      for (let i = 0; i < 6; i += 1) {
        await sleep(700);
        option = [...document.querySelectorAll('[role="option"]')].find((el) => el.textContent?.trim() === name);
        if (option) break;
      }
      if (!option) return { error: 'no-option', names: [...document.querySelectorAll('[role="option"]')].slice(0, 3).map((el) => el.textContent) };
      option.click();
      let cell = null;
      for (let i = 0; i < 8; i += 1) {
        await sleep(1200);
        cell = document.querySelector('.ts-grid [data-symbol="Q"]');
        if (cell) break;
      }
      if (!cell) return { error: 'no-q-cell' };
      return { color: getComputedStyle(cell).color };
    }, driverName);
    check('SIL-802 Q cell paints BLUE (#175CD3), not teal', q != null && q.color === 'rgb(23, 92, 211)', JSON.stringify(q));
    await shot(page, '802-timesheet-q-blue');
    await page.close();
  }
}

await browser.close();
log(`\n${failures === 0 ? 'ALL GREEN' : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
