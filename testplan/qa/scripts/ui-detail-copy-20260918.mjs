// TC-COPY-DETAIL-01/02/04/06 driver (local dev, 2026-09-18): the detail
// workboard (/shipments-detail) must offer the same bulk appointment copy as the
// create page and the CUS ledger, and the write must resolve the lot's own
// containers — not just the rows the page happens to show.
//
// Runs against local dev (frontend 7174 / API 3001) as the CUS account thanhdc.
// Preparation is explicit so the run is reproducible: the QA lot's source row is
// re-dated and its siblings are cleared through the real API before the click.
//
// Usage: node testplan/qa/scripts/ui-detail-copy-20260918.mjs
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = process.env.BASE_URL || 'http://localhost:7174';
const API = process.env.API_URL || 'http://localhost:3001/api';
// Presence-only mode (staging): assert the deployed affordance renders, without
// writing appointments onto a prod mirror.
const PRESENCE_ONLY = process.env.PRESENCE_ONLY === '1';
const OUT_DIR = process.env.OUT_DIR || 'qa/2026-09-18-detail-copy';
const SHIPMENT_ID = Number(process.env.SHIPMENT_ID || 41987);
const SOURCE_CONTAINER = Number(process.env.SOURCE_CONTAINER || 27700);
const EMPTY_CONTAINERS = (process.env.EMPTY_CONTAINERS || '27701,27702').split(',').map(Number);
const SOURCE_AT = process.env.SOURCE_AT || '2026-09-19T02:00:00.000Z'; // 09:00 19/09/2026 VN
// Filter to the SOURCE container alone: the point of the run is that the copy
// reaches the lot's other containers even when the board does not list them.
const SEARCH_SUFFIX = process.env.SEARCH_SUFFIX || '9732531';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const DIR = OUT_DIR;
mkdirSync(DIR, { recursive: true });
const LOGFILE = `${DIR}/ui-driver.log`;
const lines = [];
const log = (s, extra) => {
  const line = extra === undefined ? s : `${s} ${JSON.stringify(extra)}`;
  console.log(line);
  lines.push(line);
  writeFileSync(LOGFILE, lines.join('\n') + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const { token } = await login.json();
log(`login thanhdc ok — lot ${SHIPMENT_ID}, source cont ${SOURCE_CONTAINER}, empties ${EMPTY_CONTAINERS.join(',')}`);

const api = async (method, path, body) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

// --- Preparation: source dated, siblings clear, through the real API --------
const current = PRESENCE_ONLY
  ? { status: 200, body: { summary: { version: 0 }, containers: [] } }
  : await api('GET', `/shipments/cus-workspace/${SHIPMENT_ID}`);
if (current.status !== 200) throw new Error(`cannot read lot: ${current.status} ${JSON.stringify(current.body)}`);
let version = current.body.summary.version;
const before = current.body.containers.map((c) => ({ id: c.id, at: c.customerAppointmentAt, number: c.containerNumber }));
log('before-state', before);
const sourceNumber = before.find((c) => c.id === SOURCE_CONTAINER)?.number ?? null;

for (const target of PRESENCE_ONLY ? [] : [{ id: SOURCE_CONTAINER, at: SOURCE_AT }, ...EMPTY_CONTAINERS.map((id) => ({ id, at: null }))]) {
  const known = before.find((c) => c.id === target.id);
  if (!known) throw new Error(`container ${target.id} is not in lot ${SHIPMENT_ID}`);
  if ((known.at ?? null) === target.at) continue;
  const written = await api('POST', `/shipments/cus-workspace/${SHIPMENT_ID}/containers/${target.id}`, {
    expectedShipmentVersion: version,
    customerAppointmentAt: target.at,
  });
  if (written.status !== 200) throw new Error(`prepare ${target.id} failed: ${written.status} ${JSON.stringify(written.body)}`);
  version = written.body.line.shipmentVersion;
  log(`prepared container ${target.id} -> ${target.at ?? 'null'} (shipmentVersion ${version})`);
}
if (!PRESENCE_ONLY) {
  const prepared = await api('GET', `/shipments/cus-workspace/${SHIPMENT_ID}`);
  log('prepared-state', prepared.body.containers.map((c) => ({ id: c.id, at: c.customerAppointmentAt })));
}

// --- UI -------------------------------------------------------------------
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let failed = null;
const readTable = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.shipment-container-ledger tbody tr')).map((row) => ({
  container: row.querySelector('td[data-label="Thông số container"] strong')?.textContent?.trim() ?? null,
  appointment: row.querySelector('td[data-label="Lịch trình"] strong')?.textContent?.trim() ?? null,
  copyButtons: row.querySelectorAll('.shipment-container-ledger__copy').length,
})));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: Number(process.env.VIEWPORT_HEIGHT || 1000) });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  // Presence mode may run without a known container to search for (staging):
  // page the board until a row carries the affordance.
  const urls = PRESENCE_ONLY && !process.env.SEARCH_SUFFIX
    ? [1, 2, 3, 4, 5, 6].map((n) => `${BASE}/shipments-detail?dateScope=all&page=${n}`)
    : [`${BASE}/shipments-detail?dateScope=all&searchSuffix=${SEARCH_SUFFIX}`];
  let listed = [];
  let url = urls[0];
  for (url of urls) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
    await page.waitForSelector('.shipment-container-ledger tbody tr', { timeout: 20000 });
    await sleep(500);
    listed = await readTable(page);
    log(`TC-COPY-DETAIL-01 ${url}`, { rows: listed.length, withCopy: listed.filter((r) => r.copyButtons > 0).length });
    if (listed.some((row) => row.copyButtons > 0)) break;
  }
  log(`TC-COPY-DETAIL-01 first row with the affordance`, listed.find((row) => row.copyButtons > 0) ?? null);
  if (PRESENCE_ONLY) {
    if (!listed.some((row) => row.copyButtons > 0)) {
      throw new Error(`no copy affordance on any listed row: ${JSON.stringify(listed)}`);
    }
  } else if (!listed.some((row) => row.container === sourceNumber)) {
    throw new Error(`source container ${sourceNumber} is not listed for search ${SEARCH_SUFFIX}: ${JSON.stringify(listed)}`);
  }
  const siblingListed = listed.filter((row) => row.container !== sourceNumber);
  if (siblingListed.length > 0) {
    log('NOTE siblings of the lot are listed too (not required for this run)', siblingListed);
  }

  const geometry = await page.evaluate(() => {
    // Pick the first affordance whose schedule cell is an editable trigger —
    // the row that can actually be compared with the icon's column.
    const iconRows = Array.from(document.querySelectorAll('.shipment-container-ledger__copy')).map((node) => node.closest('tr'));
    const row = iconRows.find((candidate) => candidate?.querySelector('td[data-label="Lịch trình"] button')) ?? iconRows[0];
    const button = row?.querySelector('.shipment-container-ledger__copy');
    if (!button) return null;
    // The page's sticky pagination footer can sit over the lower rows; bring
    // the measured row into the viewport before hit-testing it.
    row.scrollIntoView({ block: 'center' });
    const identity = button.closest('th');
    const rect = button.getBoundingClientRect();
    // Glyph-level: the multiline blocks are full-width, so element boxes would
    // report an overlap even when no character reaches the gutter.
    const overlaps = [];
    const range = document.createRange();
    for (const node of Array.from(identity?.querySelectorAll('strong, span, em') ?? [])) {
      for (const text of Array.from(node.childNodes)) {
        if (text.nodeType !== 3) continue;
        range.selectNodeContents(text);
        const hits = Array.from(range.getClientRects()).some((box) => (
          box.width > 0 && box.height > 0
          && rect.left < box.right - 1 && rect.right > box.left + 1
          && rect.top < box.bottom - 1 && rect.bottom > box.top + 1
        ));
        if (hits) overlaps.push(text.textContent?.slice(0, 24));
      }
    }
    const trigger = button.closest('tr')?.querySelector('td[data-label="Lịch trình"] button, td[data-label="Lịch trình"] .shipment-container-ledger__cell-trigger');
    const triggerBox = trigger?.getBoundingClientRect();
    const hit = triggerBox ? document.elementFromPoint(triggerBox.left + triggerBox.width / 2, triggerBox.top + triggerBox.height / 2) : null;
    return {
      copies: document.querySelectorAll('.shipment-container-ledger__copy').length,
      row: button.closest('tr')?.querySelector('td[data-label="Thông số container"] strong')?.textContent?.trim() ?? null,
      identityLabel: identity?.getAttribute('data-label'),
      overlapsText: overlaps,
      gutter: getComputedStyle(identity?.querySelector('.shipment-container-ledger__cell-editor, .shipment-container-ledger__cell-trigger') ?? identity).paddingRight,
      scheduleTriggerHit: Boolean(hit && (hit === trigger || trigger?.contains(hit))),
      title: button.getAttribute('title'),
    };
  });
  log('TC-COPY-DETAIL-01 geometry', geometry);
  await page.screenshot({ path: `${DIR}/${STAMP}_01-before-click.png` });
  if (!geometry || geometry.overlapsText.length > 0 || !geometry.scheduleTriggerHit || geometry.gutter !== '30px') {
    failed = `affordance geometry invalid: ${JSON.stringify(geometry)}`;
  }

  if (PRESENCE_ONLY) {
    log('PRESENCE-ONLY — affordance rendered and geometry checked; no write performed');
  } else {
  await page.hover('.shipment-container-ledger__copy');
  await sleep(300);
  const revealed = await page.evaluate(() => {
    const button = document.querySelector('.shipment-container-ledger__copy');
    return button ? getComputedStyle(button).visibility : null;
  });
  log('TC-COPY-DETAIL-04 hover-visibility', revealed);
  await page.screenshot({ path: `${DIR}/${STAMP}_02-hover.png` });

  const box = await (await page.$('.shipment-container-ledger__copy')).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('.alert, [role="alert"]')).some((node) => node.textContent?.includes('Đã copy ngày giờ đóng trả')),
    { timeout: 20000 },
  );
  const notice = await page.evaluate(() => Array.from(document.querySelectorAll('.alert, [role="alert"]')).map((n) => n.textContent?.trim()).filter((t) => t?.includes('Đã copy')));
  await sleep(900);
  const after = await readTable(page);
  log('TC-COPY-DETAIL-02 notice', notice);
  log('TC-COPY-DETAIL-02 rows-after', after);
  await page.screenshot({ path: `${DIR}/${STAMP}_03-after-click.png` });

  const persisted = await api('GET', `/shipments/cus-workspace/${SHIPMENT_ID}`);
  const persistedState = persisted.body.containers.map((c) => ({ id: c.id, at: c.customerAppointmentAt }));
  log('TC-COPY-DETAIL-02 db-after', persistedState);

  const sourceIso = persistedState.find((c) => c.id === SOURCE_CONTAINER)?.at;
  const emptiesPersisted = EMPTY_CONTAINERS.map((id) => persistedState.find((c) => c.id === id)?.at);
  if (!sourceIso || emptiesPersisted.some((at) => at !== sourceIso)) {
    failed = `DB mismatch: source=${sourceIso} targets=${JSON.stringify(emptiesPersisted)}`;
  }
  const expectedCount = EMPTY_CONTAINERS.length;
  if (!notice.some((text) => text?.includes(`sang ${expectedCount} container`))) {
    failed = `notice count mismatch: ${JSON.stringify(notice)} (expected ${expectedCount})`;
  }
  const sourceRowAfter = after.find((row) => row.container === sourceNumber);
  if (!sourceRowAfter || sourceRowAfter.appointment?.startsWith('Chưa có lịch hẹn')) {
    failed = `the source row lost its appointment after the copy: ${JSON.stringify(sourceRowAfter)}`;
  }

  // TC-COPY-DETAIL-06: with the lot fully dated, a second click must write
  // nothing and say so (the affordance stays source-gated, so it is clicked
  // again rather than asserted absent).
  const secondBox = await (await page.$('.shipment-container-ledger__copy')).boundingBox();
  await page.mouse.click(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2);
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('.alert, [role="alert"]')).some((node) => node.textContent?.includes('không còn container nào cần copy')),
    { timeout: 20000 },
  );
  const noTargetNotice = await page.evaluate(() => Array.from(document.querySelectorAll('.alert, [role="alert"]')).map((n) => n.textContent?.trim()).filter((t) => t?.includes('không còn container nào cần copy')));
  const afterSecond = await api('GET', `/shipments/cus-workspace/${SHIPMENT_ID}`);
  log('TC-COPY-DETAIL-06 notice', noTargetNotice);
  log('TC-COPY-DETAIL-06 db-after-second-click', afterSecond.body.containers.map((c) => ({ id: c.id, at: c.customerAppointmentAt })));
  await page.screenshot({ path: `${DIR}/${STAMP}_04-fully-dated.png` });
  }
} finally {
  await browser.close();
}

if (failed) {
  log(`FAIL ${failed}`);
  process.exitCode = 1;
} else if (PRESENCE_ONLY) {
  log(`PASS (presence-only @ ${BASE}) — the affordance renders with its gutter and leaves the schedule cell clickable; no write performed`);
} else {
  log('PASS — one click filled every empty container of the lot; a second click reported nothing left to fill');
}
log(`artifact driver log: ${LOGFILE}`);
