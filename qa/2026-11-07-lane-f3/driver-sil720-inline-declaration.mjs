/**
 * Lane F3 — SIL-720 (id 840) UI DRIVEN probe.
 *
 * Drives the CUS lot page (/shipments/:id, view mode): click the SỐ TỜ KHAI
 * cell → the inline editor opens → Enter saves through the per-container
 * command → the FB-109 auto-copy fills the lot's still-empty sibling container
 * and the page re-reads so BOTH rows show the number on THIS surface.
 *
 * Evidence (this lane's qa/ folder):
 *   01-inline-editor-open.png   the inline editor on the cell
 *   02-inline-saved.png         the page after the save (both rows + toast)
 *   sil720-api-proof.json       the persisted declaration numbers (API = DB)
 *   driver-sil720.log           this driver's step log + exit status
 *
 * The lot is a throwaway it creates itself and deletes at the end.
 *
 * Usage: node qa/2026-11-07-lane-f3/driver-sil720-inline-declaration.mjs
 */
import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.F3_BASE_URL ?? 'http://localhost:7192';
const USER = process.env.F3_USER ?? 'cus';
const PASS = process.env.F3_PASS ?? 'Abc123';
const DECLARATION = process.env.F3_DECLARATION ?? `TK-F3-${Date.now().toString().slice(-9)}`;

const log = [];
function step(name, detail) {
  const line = `${new Date().toISOString()} ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`;
  log.push(line);
  console.log(line);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
let exitCode = 0;
let shipmentId = null;

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('dialog', async (d) => d.accept());

  // ── 1. login ──────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input', { timeout: 20000 });
  const inputs = await page.$$('input');
  await inputs[0].type(USER);
  await inputs[1].type(PASS);
  await Promise.all([
    page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 }),
    page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Đăng nhập');
      btn?.click();
    }),
  ]);
  step('login', { user: USER, url: page.url() });

  // ── 2. a throwaway FCL lot with two containers (the FB-109 pair) ─────────
  const created = await page.evaluate(async () => {
    const token = localStorage.getItem('token');
    const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const letters = { A:10,B:12,C:13,D:14,E:15,F:16,G:17,H:18,I:19,J:20,K:21,L:23,M:24,N:25,O:26,P:27,Q:28,R:29,S:30,T:31,U:32,V:34,W:35,X:36,Y:37,Z:38 };
    const check = (prefix) => {
      let sum = 0;
      prefix.split('').forEach((ch, i) => { sum += (/[0-9]/.test(ch) ? Number(ch) : letters[ch]) * 2 ** i; });
      return `${prefix}${(sum % 11) % 10}`;
    };
    const list = await (await fetch('/api/shipments?limit=40', { headers: h })).json();
    const first = (list.items ?? []).find((i) => i.cargoMode === 'FCL' && (i.containerCount20 || i.containerCount40));
    const detail = await (await fetch(`/api/shipments/${first.id}`, { headers: h })).json();
    const ship = detail.shipment ?? {};
    const res = await fetch('/api/shipments/quick', {
      method: 'POST',
      headers: { ...h, 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        customerId: ship.customerId,
        blNumber: `R4B-F3-${Date.now().toString().slice(-9)}`,
        tradeDirection: 'IMPORT',
        cargoMode: 'FCL',
        shippingLineName: 'MAERSK',
        operationalSiteId: ship.operationalSiteId,
        containers: [
          { containerNumber: check('FTST000000'), containerTypeId: 1, customerAppointmentAt: '2026-11-25T08:00:00.000Z' },
          { containerNumber: check('FTST000001'), containerTypeId: 1, customerAppointmentAt: '2026-11-25T08:00:00.000Z' },
        ],
      }),
    });
    const raw = await res.text();
    let body = null;
    try { body = JSON.parse(raw); } catch { /* non-JSON body */ }
    return { status: res.status, id: body?.shipment?.id ?? body?.id ?? null, error: body?.error ?? null, raw: raw.slice(0, 300) };
  });
  if (created.status !== 201 || !created.id) throw new Error(`fixture create failed: ${JSON.stringify(created)}`);
  shipmentId = created.id;
  step('fixture', created);

  // ── 3. the lot page (view mode) ──────────────────────────────────────────
  await page.goto(`${BASE}/shipments/${shipmentId}`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => /Sửa số tờ khai/.test(b.getAttribute('aria-label') || '')),
    { timeout: 30000 },
  );
  const triggers = await page.$$eval('button', (nodes) => nodes
    .map((b) => b.getAttribute('aria-label'))
    .filter((l) => l && /Sửa số tờ khai/.test(l)));
  step('inline-triggers', triggers);
  if (triggers.length !== 2) throw new Error(`expected 2 inline declaration triggers, got ${triggers.length}`);

  // ── 4. click the cell → the inline editor opens ──────────────────────────
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => (b.getAttribute('aria-label') || '').startsWith('Sửa số tờ khai'));
    btn.click();
  });
  await page.waitForSelector('[data-cell-editor-portal] input[aria-label="Số tờ khai"]', { timeout: 15000 });
  const editorLabel = await page.$eval('[data-cell-editor-portal]', (el) => el.getAttribute('aria-label'));
  const hint = await page.$eval('[data-cell-editor-portal]', (el) => el.innerText.replace(/\s+/g, ' ').trim());
  step('editor-open', { editorLabel, hint });
  await page.screenshot({ path: path.join(HERE, '01-inline-editor-open.png') });

  // ── 5. type + Enter → save ───────────────────────────────────────────────
  await page.click('[data-cell-editor-portal] input[aria-label="Số tờ khai"]');
  await page.type('[data-cell-editor-portal] input[aria-label="Số tờ khai"]', DECLARATION);
  const typed = await page.$eval('[data-cell-editor-portal] input[aria-label="Số tờ khai"]', (el) => el.value);
  step('typed', { typed });
  await page.keyboard.press('Enter');
  await sleep(3000);
  const toastLines = await page.evaluate(() => (document.body.innerText.match(/[^\n]*(tờ khai)[^\n]*/g) ?? []).slice(0, 6));
  step('after-enter', { toastLines });
  await page.waitForFunction(
    () => document.body.innerText.includes('Đã lưu số tờ khai'),
    { timeout: 20000 },
  );
  await sleep(1500);
  const toast = await page.evaluate(() => (document.body.innerText.match(/Đã lưu số tờ khai[^\n]*/g) ?? []));
  const cells = await page.$$eval('[data-field-id$="-declaration"]', (nodes) => nodes.map((n) => n.innerText.replace(/\s+/g, ' ').trim()));
  step('after-save', { toast, cells });
  if (!toast.some((t) => t.includes('tự điền thêm cho 1 container'))) {
    throw new Error(`the FB-109 auto-copy was not reported: ${JSON.stringify(toast)}`);
  }
  if (cells.length !== 2 || cells.some((c) => !c.includes(DECLARATION))) {
    throw new Error(`both rows must show the number on THIS surface: ${JSON.stringify(cells)}`);
  }
  await page.screenshot({ path: path.join(HERE, '02-inline-saved.png') });

  // ── 6. the persisted side effect (API = the DB rows) ─────────────────────
  const proof = await page.evaluate(async (id) => {
    const token = localStorage.getItem('token');
    const h = { Authorization: `Bearer ${token}` };
    const detail = await (await fetch(`/api/shipments/${id}`, { headers: h })).json();
    return (detail.containers ?? []).map((c) => ({ containerNumber: c.containerNumber, declarationNumber: c.declarationNumber }));
  }, shipmentId);
  step('api-proof', proof);
  await writeFile(path.join(HERE, 'sil720-api-proof.json'), JSON.stringify({ shipmentId, declaration: DECLARATION, containers: proof }, null, 2));
  if (proof.length !== 2 || proof.some((c) => c.declarationNumber !== DECLARATION)) {
    throw new Error(`the persisted rows do not carry the number: ${JSON.stringify(proof)}`);
  }

  // ── 7. clean up the throwaway lot ────────────────────────────────────────
  const deleted = await page.evaluate(async (id) => {
    const token = localStorage.getItem('token');
    const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const detail = await (await fetch(`/api/shipments/${id}`, { headers: h })).json();
    const res = await fetch(`/api/shipments/cus-workspace/${id}`, {
      method: 'DELETE',
      headers: { ...h, 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ version: detail.shipment.version, reason: 'lane F3 probe — throwaway lot' }),
    });
    return res.status;
  }, shipmentId);
  step('cleanup', { shipmentId, deleteStatus: deleted });
  step('VERDICT', 'PASS — inline tờ khai on the lot page (SIL-720)');
} catch (error) {
  exitCode = 1;
  step('VERDICT', `FAIL — ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (shipmentId) {
    log.push(`${new Date().toISOString()} fixture ${shipmentId} may still exist — delete it with DELETE /api/shipments/cus-workspace/${shipmentId} (reason: lane F3 probe).`);
  }
  log.push(`EXIT ${exitCode}`);
  await writeFile(path.join(HERE, 'driver-sil720.log'), `${log.join('\n')}\n`);
  await browser.close();
}
process.exit(exitCode);
