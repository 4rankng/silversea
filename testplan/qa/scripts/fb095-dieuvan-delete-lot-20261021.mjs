/**
 * FB-095 (card 211026005623) UI driver — rung 3 evidence, local dev stack.
 *
 * "Điều vận KHÔNG có nút xóa lô chính" → verdict (a): the /dispatch-detail lot
 * grid had NO delete affordance for any role. This driver proves the fix on
 * the real surface:
 *   1. seed: 2 born-ready LCL lots (w4b-lh400 recipe) grouped into a COST
 *      pair (host = Lô 1) as dungnv (DISPATCHER);
 *   2. ADMIN at /dispatch-detail: row shows "Lẻ · Ghép (1/2)" + "Xóa lô",
 *      click → confirm names the FB-095 promote law, reason required,
 *      confirm → soft-delete + toast + grid refresh (screenshots before/after);
 *   3. DISPATCHER at /dispatch-detail: same button answers with the guard's
 *      own law text (role law CUS/ADMIN NOT loosened) and touches nothing;
 *   4. DB proof on the local dev Postgres (5441): host row soft-deleted,
 *      survivor dissolved (FB-095 promote-on-delete), audit rows
 *      SHIPMENT_DELETED + SHIPMENT_LCL_GROUP_UNMERGED (cause DELETE).
 *
 * Env: QA_BASE (default http://localhost:7175), QA_API (default
 * http://localhost:3002/api), QA_OUT (default qa/2026-10-21-fb095).
 * Exit status: 0 only when every step passes.
 */
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const BASE = process.env.QA_BASE ?? 'http://localhost:7175';
const API = process.env.QA_API ?? 'http://localhost:3002/api';
const OUT = process.env.QA_OUT ?? 'qa/2026-10-21-fb095';
const PREFIX = '2026-10-21_fb095-dieuvan-delete';
mkdirSync(OUT, { recursive: true });

const require = createRequire(new URL('../../../backend/package.json', import.meta.url));
const postgres = require('postgres');

let failures = 0;
const log = (line) => {
  const t = `${new Date().toISOString()} ${line}`;
  console.log(t);
};
function check(name, ok, detail = '') {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => randomUUID();

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  const body = await res.json().catch(() => ({}));
  return body.token ?? null;
}

async function api(token, method, path, body) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (method !== 'GET' && method !== 'HEAD') headers['Idempotency-Key'] = uuid();
  const res = await fetch(`${API}${path}`, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, ok: res.ok, json, text };
}

async function withUser(browser, token, fn) {
  const page = await browser.newPage();
  // puppeteer-spa-auth: token BEFORE first paint or the guard silently
  // redirects to /login.
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  page.setDefaultTimeout(20000);
  try {
    await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

async function shot(page, name) {
  const path = resolve(OUT, `${PREFIX}_${name}.png`);
  await page.screenshot({ path, fullPage: true });
  log(`SHOT ${path}`);
  return path;
}

async function textPresent(page, text) {
  return page.evaluate((t) => (document.body.innerText ?? '').includes(t), text);
}

async function waitForText(page, text, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await textPresent(page, text)) return true;
    await sleep(250);
  }
  return false;
}

async function searchRef(page, ref) {
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  const search = await page.waitForSelector('[aria-label="Tìm nhanh"]', { timeout: 20000 }).catch(() => null);
  if (search) {
    await search.type(ref);
    return true;
  }
  return page.evaluate((r) => {
    const input = [...document.querySelectorAll('input')].find((i) => /tìm|search/i.test(i.placeholder || ''))
      || [...document.querySelectorAll('input[type="text"], input[type="search"]')][0];
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, r);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, ref);
}

async function clickRowDelete(page, ref) {
  return page.evaluate((r) => {
    const buttons = [...document.querySelectorAll('button')]
      .filter((b) => (b.getAttribute('aria-label') || '').startsWith('Xóa lô ·') && b.offsetParent !== null);
    const inRow = buttons.find((b) => {
      const row = b.closest('tr');
      return row && (row.innerText || '').includes(r);
    });
    const target = inRow ?? buttons[0];
    if (!target) return { clicked: false, label: null };
    target.click();
    return { clicked: true, label: target.getAttribute('aria-label') };
  }, ref);
}

async function dbToJson(query) {
  const sql = postgres({ host: '127.0.0.1', port: 5441, user: 'postgres', password: 'postgres', database: 'silversea' });
  try {
    return (await sql.unsafe(query)).map((r) => r.j ?? r);
  } finally {
    await sql.end();
  }
}

async function dbCheck(name, query, assert, detailOf = (rows) => JSON.stringify(rows[0] ?? {}).slice(0, 240)) {
  try {
    const rows = await dbToJson(query);
    check(name, assert(rows), detailOf(rows));
    return rows;
  } catch (err) {
    check(name, false, `query error: ${err.message}`);
    return [];
  }
}

// ─── seed: 2 born-ready LCL lots → COST group (host = Lô 1) ─────────────────
const dieuvanToken = await login('dungnv');
const adminToken = await login('admin');
check('login dungnv (DISPATCHER) + admin', Boolean(dieuvanToken && adminToken));
if (!dieuvanToken || !adminToken) process.exit(2);

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
check('backend health', health?.status === 'ok', JSON.stringify(health ?? {}).slice(0, 120));
if (health?.status !== 'ok') process.exit(2);

const customers = await api(dieuvanToken, 'GET', '/customers?limit=50');
const customer = (customers.json?.items ?? customers.json ?? []).find((c) => !c.deletedAt);
check('seed customer', Boolean(customer?.id), `id=${customer?.id}`);
const classes = await api(adminToken, 'GET', '/vehicle-size-classes?limit=50');
const cls = (classes.json?.items ?? classes.json ?? []).find((c) => /5 tấn/i.test(c.name ?? ''))
  ?? (classes.json?.items ?? classes.json ?? [])[0];
check('seed vehicle class', Boolean(cls?.id), `id=${cls?.id} ${cls?.name ?? ''}`);
if (!customer?.id || !cls?.id) process.exit(3);

const hex = uuid().slice(0, 8);
const refHost = `QA-095D-${hex}-1`;
const refMember = `QA-095D-${hex}-2`;
const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

async function createBornReadyLcl(ref) {
  const res = await api(dieuvanToken, 'POST', '/shipments', {
    customerId: customer.id,
    bookingRef: ref,
    tradeDirection: 'EXPORT',
    cargoMode: 'LCL',
    expectedDeliveryDate: today,
  });
  return { status: res.status, id: res.json?.id ?? null, lotStatus: res.json?.status ?? null };
}
const host = await createBornReadyLcl(refHost);
const member = await createBornReadyLcl(refMember);
check('seed host lot born-ready', host.status === 201 && host.lotStatus === 'READY_FOR_DISPATCH', JSON.stringify(host));
check('seed member lot born-ready', member.status === 201 && member.lotStatus === 'READY_FOR_DISPATCH', JSON.stringify(member));
if (!host.id || !member.id) process.exit(3);

const grouped = await api(dieuvanToken, 'POST', '/shipments/lcl/cost-group', {
  shipmentIds: [host.id, member.id],
  vehicleSizeClassId: cls.id,
  actualTruckNo: `29C-QA${hex.slice(0, 4)}`,
});
check('seed COST group (host = Lô 1)',
  grouped.ok && grouped.json?.memberCount === 2,
  JSON.stringify(grouped.json ?? grouped.text ?? '').slice(0, 240));
if (!grouped.ok) process.exit(3);
writeFileSync(resolve(OUT, `${PREFIX}_fixtures.json`), JSON.stringify({ host, member, refHost, refMember, groupId: grouped.json?.groupId }, null, 2));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
try {
  // ─── ADMIN: real delete flow on the host lot ("lô chính") ─────────────────
  await withUser(browser, adminToken, async (page) => {
    await page.setViewport({ width: 1440, height: 900 });
    await searchRef(page, refHost);
    const badge = await waitForText(page, 'Lẻ · Ghép (1/2)', 20000);
    check('UI-01 /dispatch-detail hàng lô chính có badge "Lẻ · Ghép (1/2)"', badge);

    const hasButton = await page.evaluate((r) => {
      const buttons = [...document.querySelectorAll('button')]
        .filter((b) => (b.getAttribute('aria-label') || '').startsWith('Xóa lô ·'));
      return buttons.some((b) => {
        const row = b.closest('tr');
        return row && (row.innerText || '').includes(r);
      });
    }, refHost);
    check('UI-02 hàng lô chính có nút "Xóa lô" (ADMIN)', hasButton);
    await shot(page, 'ui-01-before');

    const click1 = await clickRowDelete(page, refHost);
    check('UI-03 bấm "Xóa lô" mở modal xác nhận', click1.clicked, String(click1.label));
    const lawCopy = await waitForText(page, 'Lô này là Lô chính của nhóm 2 lô ghép trả ĐV', 8000)
      && await textPresent(page, 'chuyển 100% cước trả ĐV cho lô kế tiếp')
      && await textPresent(page, 'Nhóm giải tán vì chỉ còn một lô');
    check('UI-04 confirm nêu luật FB-095 promote-on-delete + giải tán', lawCopy);
    await shot(page, 'ui-02-confirm');

    // Reason required: confirm stays disabled until the textarea is filled.
    const disabledBefore = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter((b) => (b.textContent ?? '').trim() === 'Xóa lô hàng');
      return btns.length > 0 && btns.every((b) => b.disabled);
    });
    check('UI-05 chưa nhập lý do → "Xác nhận" bị disable', disabledBefore === true);

    await page.evaluate((reason) => {
      const ta = [...document.querySelectorAll('textarea')].find((t) => t.closest('.cus-action-reason'));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, reason);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, `QA card 211026005623 — xóa lô chính test ${refHost}`);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter((b) => (b.textContent ?? '').trim() === 'Xóa lô hàng' && !b.disabled);
      btns[btns.length - 1]?.click();
    });
    const toasted = await waitForText(page, 'Đã xóa lô', 15000);
    check('UI-06 xác nhận → toast "Đã xóa lô"', toasted);
    await shot(page, 'ui-03-after');

    // DOM post-state: the refreshed grid no longer carries the host row.
    await page.reload({ waitUntil: 'networkidle2' });
    await searchRef(page, refHost);
    await sleep(2500);
    const gone = !(await textPresent(page, refHost));
    check('UI-07 lưới tải lại — hàng lô chính biến mất', gone);
    await shot(page, 'ui-04-grid-after');
  });

  // ─── DISPATCHER: the affordance answers with the role law, touches nothing ─
  await withUser(browser, dieuvanToken, async (page) => {
    await searchRef(page, refMember);
    const rowSeen = await waitForText(page, refMember, 20000);
    check('UI-08 DISPATCHER thấy hàng thành viên còn lại', rowSeen);

    const click2 = await clickRowDelete(page, refMember);
    check('UI-09 DISPATCHER vẫn thấy nút "Xóa lô" (affordance không biến mất)', click2.clicked);
    const law = await waitForText(page, 'Chỉ CUS hoặc Quản trị viên mới được yêu cầu xóa lô hàng.', 8000);
    check('UI-10 bấm → banner nguyên văn luật service (role guard không nới)', law);
    const noDialog = !(await textPresent(page, 'Lý do xóa'));
    check('UI-11 không mở dialog xóa cho DISPATCHER', noDialog);
    await shot(page, 'ui-05-dieuvan-role-law');

    // AGENTS.md §3 — the changed surface at the three drive widths: the row
    // action cluster (Xóa lô) + the role-law banner must render without
    // clipping at 390/768/1440.
    for (const width of [390, 768, 1440]) {
      await page.setViewport({ width, height: 900, isMobile: width < 800 });
      await searchRef(page, refMember);
      await waitForText(page, refMember, 20000);
      const visible = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')]
          .find((b) => (b.getAttribute('aria-label') || '').startsWith('Xóa lô ·') && b.offsetParent !== null);
        return Boolean(btn);
      });
      check(`UI-12 ${width}px nút "Xóa lô" hiển thị, không clip`, visible);
      await shot(page, `ui-06-w${width}`);
    }
  });
} finally {
  await browser.close();
}

// ─── DB side-effect proof (local dev Postgres 5441) ─────────────────────────
const dbAfter = await dbToJson(
  `SELECT to_jsonb(s) AS j FROM shipments s WHERE s.id IN (${host.id}, ${member.id})`,
);
writeFileSync(resolve(OUT, `${PREFIX}_db-after.json`), JSON.stringify(dbAfter, null, 2));
check('DB-01 host soft-deleted (deleted_at set; actor proven by audit DB-03)',
  dbAfter.some((r) => r.id === host.id && r.deleted_at != null),
  JSON.stringify(dbAfter.find((r) => r.id === host.id) ?? {}).slice(0, 240));
check('DB-02 survivor giải tán — cost_group_id/order null (FB-095 promote-on-delete)',
  dbAfter.some((r) => r.id === member.id && r.deleted_at == null && r.cost_group_id == null && r.cost_group_order == null),
  JSON.stringify(dbAfter.find((r) => r.id === member.id) ?? {}).slice(0, 240));

await dbCheck(
  'DB-03 audit SHIPMENT_DELETED cho lô chính',
  'SELECT to_jsonb(a) AS j FROM audit_logs a ORDER BY a.id DESC LIMIT 40',
  (rs) => rs.some((r) => {
    const s = JSON.stringify(r);
    return s.includes('SHIPMENT_DELETED') && s.includes(String(host.id));
  }),
);
await dbCheck(
  'DB-04 audit SHIPMENT_LCL_GROUP_UNMERGED cause=DELETE, dissolved=true, survivor id',
  'SELECT to_jsonb(a) AS j FROM audit_logs a ORDER BY a.id DESC LIMIT 40',
  (rs) => rs.some((r) => {
    const s = JSON.stringify(r);
    return s.includes('SHIPMENT_LCL_GROUP_UNMERGED')
      && s.includes('"cause":"DELETE"')
      && s.includes('"dissolved":true')
      && s.includes(String(member.id));
  }),
);

// ─── fixture cleanup: survivor gets the same governed delete (API) ──────────
const versionRow = await dbToJson(`SELECT to_jsonb(s) AS j FROM shipments s WHERE s.id = ${member.id}`);
const survivorVersion = Number(versionRow[0]?.version ?? 0);
const cleanup = await api(adminToken, 'DELETE', `/shipments/${member.id}`, { version: survivorVersion, reason: `QA cleanup ${PREFIX}` });
check('cleanup survivor lot deleted', cleanup.ok, `status=${cleanup.status}`);

log(`DONE failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
