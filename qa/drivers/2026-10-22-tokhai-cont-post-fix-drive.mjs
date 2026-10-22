// Card 261022095235a/b — POST-FIX UI drive (rung 3). LOCAL ONLY 7178 → 3005.
// A. /shipments/:id — management ledger (Thêm/Xóa per ruling 22/10) + tờ khai
//    inline edit with CUS-05 sync toast + DB proof.
// B. /shipments-detail — ISO hint + one-tap fix in the container editor.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = process.env.BASE ?? 'http://localhost:7178';
const API = `${BASE}/api`;
const OUT = 'qa/2026-10-22-cus-tokhai-cont';
const SHOTS = '/tmp/tokhai-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (sql) => execSync(`docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c ${JSON.stringify(sql)}`).toString().trim();

let L = null;
for (let i = 0; i < 3 && !L?.token; i++) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }) });
  try { L = await r.json(); } catch { }
  if (!L?.token) await sleep(1000);
}
if (!L?.token) { console.log('LOGIN FAILED'); process.exit(1); }
console.log('LOGIN OK cus');
const T = L.token;
const jf = async (path, opts) => {
  const res = await fetch(`${API}${path}`, opts);
  let body = null; try { body = await res.json(); } catch { }
  return { status: res.status, body };
};
const auth = (e = {}) => ({ Authorization: `Bearer ${T}`, 'Content-Type': 'application/json', ...e });

// ── Fixture: lô NHẬP 3 cont trống số; #1 seed bẩn (khách nhập sai) ────────
const boot = (await jf('/catalogs/bootstrap', { headers: auth() })).body;
const customers = (await jf('/customers?limit=5', { headers: auth() })).body;
const cust = (customers.items ?? customers.rows ?? customers)[0];
const ct = (boot.containerTypes ?? [])[0];
const stamp = Date.now().toString().slice(-5);
const TK = `HAGHTB297${stamp}`;
const created = await jf('/shipments/quick', { method: 'POST', headers: auth({ 'Idempotency-Key': crypto.randomUUID() }), body: JSON.stringify({
  customerId: cust.id, tradeDirection: 'IMPORT', blNumber: TK, shippingLineName: 'MAERSK',
  containers: [
    { containerNumber: '', containerTypeId: ct.id },
    { containerNumber: '', containerTypeId: ct.id },
    { containerNumber: '', containerTypeId: ct.id },
  ],
}) });
if (created.status !== 201) { console.log('FIXTURE FAILED', created.status, JSON.stringify(created.body).slice(0, 200)); process.exit(1); }
const sid = created.body.id;
const cids = psql(`select id from shipment_containers where shipment_id=${sid} order by id`).split('\n').filter(Boolean);
psql(`update shipment_containers set container_number='MSKU1234560' where id=${cids[0]}`);
console.log(`fixture lot=${sid} bl=${TK} rows=${cids.join(',')} (#1 dirty MSKU1234560)`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), T);
const netLog = [];
page.on('response', async (res) => {
  if (res.url().includes('/api/') && res.status() >= 400) {
    let body = ''; try { body = (await res.text()).slice(0, 220); } catch { }
    netLog.push(`${res.request().method()} ${res.status()} ${res.url().replace(BASE, '')} :: ${body}`);
  }
});
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const results = [];
const check = (id, ok, detail = '') => { results.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ' :: ' + detail : ''}`); };
/** Set a React controlled input exactly (headless triple-click selection is
 *  unreliable; the native value setter + input event is deterministic). */
const setInput = (el, value) => page.evaluate((node, v) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(node, v);
  node.dispatchEvent(new Event('input', { bubbles: true }));
}, el, value);

// ── A. Detail page: management ledger + tờ khai inline + sync ──────────────
await page.goto(`${BASE}/shipments/${sid}`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2500);
await shot('p1-detail-management');
const affordances = await page.evaluate(() => ({
  add: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Thêm container'),
  declCol: [...document.querySelectorAll('th')].some((t) => t.textContent.trim() === 'Số tờ khai'),
  declTriggers: document.querySelectorAll('.cus-declaration-trigger').length,
  removeBtns: [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Xóa container').length,
}));
check('UI-R6 Thêm container @detail', affordances.add, JSON.stringify(affordances));
check('UI-R1 Số tờ khai column + triggers', affordances.declCol && affordances.declTriggers === 3, `triggers=${affordances.declTriggers}`);
check('UI-R6 Xóa container rows', affordances.removeBtns === 3, `remove=${affordances.removeBtns}`);

// Click tờ khai trigger của dòng #1 → nhập → Enter
await page.click('.cus-declaration-trigger');
await sleep(400);
await shot('p2-declaration-editor-open');
const declInput = await page.$('input[id^="declaration-input-"]');
await setInput(declInput, `${TK}-TK01`);
await sleep(250);
await page.keyboard.press('Enter');
await sleep(2600);
await shot('p3-declaration-saved-sync');
const toastText = await page.evaluate(() => document.body.innerText.includes('tự copy sang 2 cont'));
check('UI-R2 sync toast', toastText, 'toast text found in body');
const declValues = await page.evaluate(() => [...document.querySelectorAll('.cus-declaration-trigger')].map((b) => b.textContent.trim()));
check('UI-R2 all rows synced in DOM', declValues.every((v) => v === `${TK}-TK01`), declValues.join('|'));
const dbSync = psql(`select declaration_number from shipment_containers where shipment_id=${sid} order by id`);
check('UI-R2 DB proof', dbSync.split('\n').every((v) => v.trim() === `${TK}-TK01`), dbSync.replace(/\n/g, '|'));

// Cont #2 đặt số riêng (divergence) — rồi sửa #1, #2 giữ nguyên
const triggers = await page.$$('.cus-declaration-trigger');
await triggers[1].click();
await sleep(350);
const inp2 = await page.$('input[id^="declaration-input-"]');
await setInput(inp2, `TK-RIENG-${stamp}`);
await page.keyboard.press('Enter');
await sleep(2200);
const triggers2 = await page.$$('.cus-declaration-trigger');
await triggers2[0].click();
await sleep(350);
const inp1 = await page.$('input[id^="declaration-input-"]');
await setInput(inp1, `${TK}-TK01-NEW`);
await page.keyboard.press('Enter');
await sleep(2400);
await shot('p4-divergence');
const declValues2 = await page.evaluate(() => [...document.querySelectorAll('.cus-declaration-trigger')].map((b) => b.textContent.trim()));
check('UI-R3 divergence kept', declValues2[1] === `TK-RIENG-${stamp}` && declValues2[0] === `${TK}-TK01-NEW`, declValues2.join('|'));
const dbDiv = psql(`select declaration_number from shipment_containers where shipment_id=${sid} order by id`);
check('UI-R3 DB proof', dbDiv.includes(`TK-RIENG-${stamp}`), dbDiv.replace(/\n/g, '|'));

// Thêm container TỪ màn chi tiết
await page.click('button::-p-text(Thêm container)');
await sleep(700);
await shot('p5-detail-add-row');
const numInput = await page.$('input[aria-label="Số container"]');
await numInput.type('CSQU3054383');
await sleep(300);
await page.click('.cus-container-ledger__add-row button::-p-text(Thêm)');
await sleep(2600);
await shot('p6-detail-add-done');
const rowAfter = await page.evaluate(() => document.querySelectorAll('.cus-container-row').length);
check('UI-R6b add FROM detail', rowAfter === 4, `rows=${rowAfter}`);
const dbAfterAdd = psql(`select count(*) from shipment_containers where shipment_id=${sid}`);
check('UI-R6b DB proof', dbAfterAdd.trim() === '4', `count=${dbAfterAdd}`);
// Added row inherits the lot's tờ khai (A.1+A.6)
const addedDecl = psql(`select declaration_number from shipment_containers where shipment_id=${sid} and container_number='CSQU3054383'`);
check('UI-added row inherits tờ khai', addedDecl.trim() === `${TK}-TK01-NEW`, addedDecl.trim());

// Xóa container vừa thêm (confirm dialog)
const removeBtns = await page.$$xFind ? null : await page.$$('button::-p-text(Xóa container)');
await removeBtns[removeBtns.length - 1].click();
await sleep(600);
await shot('p7-remove-confirm');
const confirmBtn = await page.$('.modal button::-p-text(Xóa container), [role="dialog"] button::-p-text(Xóa container)');
if (confirmBtn) { await confirmBtn.click(); await sleep(2400); }
await shot('p8-remove-done');
const dbAfterRm = psql(`select count(*) from shipment_containers where shipment_id=${sid}`);
check('UI-R6c remove FROM detail', dbAfterRm.trim() === '3', `count=${dbAfterRm}`);

// ── B. Workboard: ISO hint + one-tap fix trong editor số cont ─────────────
await page.goto(`${BASE}/shipments-detail?searchSuffix=${TK}&dateScope=all`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2500);
await shot('p9-workboard');
// The cell trigger carries no aria-label attribute — its accessible name is
// the inner span text ("Chỉnh sửa ô thông số container <số>: …").
const cellHandle = await page.evaluateHandle((num) => {
  const buttons = [...document.querySelectorAll('.shipment-container-ledger__cell-trigger')];
  return buttons.find((b) => b.textContent.includes('Chỉnh sửa ô thông số container') && b.textContent.includes(num)) ?? null;
}, 'MSKU1234560');
const cell = cellHandle.asElement();
if (!cell) {
  check('UI-R8 open container editor', false, 'trigger not found');
} else {
  await cell.click();
  await sleep(2000);
  await shot('p10-container-editor');
  const num = await page.$('.shipment-container-ledger__inline-editor input[maxlength="20"]');
  await setInput(num, 'MSKU1234560');
  await sleep(400);
  await shot('p11-iso-hint');
  const hint = await page.evaluate(() => {
    const h = document.querySelector('.shipment-container-ledger__number-hint');
    const btn = document.querySelector('.shipment-container-ledger__number-hint button');
    return { has: Boolean(h), text: h?.textContent.trim() ?? '', fix: btn?.textContent.trim() ?? null };
  });
  check('UI-R8 ISO hint', hint.has && /sai chữ số kiểm tra/i.test(hint.text), JSON.stringify(hint));
  if (hint.fix) {
    await page.click('.shipment-container-ledger__number-hint button');
    await sleep(300);
    const fixed = await page.evaluate(() => document.querySelector('.shipment-container-ledger__inline-editor input[maxlength="20"]').value);
    check('UI-R8 one-tap fix', /^MSKU\d{7}$/.test(fixed) && fixed !== 'MSKU1234560', `fixed=${fixed}`);
    await shot('p12-iso-fixed');
    // Focus back INTO the input before Enter — the editor ignores Enter while
    // focus sits on a button (its own contract), so save via the input.
    await page.click('.shipment-container-ledger__inline-editor input[maxlength="20"]');
    await page.keyboard.press('Enter');
    await sleep(2600);
    await shot('p13-container-saved');
    const dbFixed = psql(`select container_number from shipment_containers where shipment_id=${sid} order by id limit 1`);
    check('UI-R8 DB proof dirty number fixed', dbFixed.trim() === 'MSKU1234565', `first row now=${dbFixed.trim()}`);
  }
}

fs.writeFileSync(`${OUT}/post-fix-network.log`, netLog.join('\n') || '(no 4xx/5xx captured)');
fs.writeFileSync(`${SHOTS}/post-fix-run.log`, results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.id}`).join('\n'));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} UI checks passed`);
console.log('LOT=', sid, 'TK=', TK);
await browser.close();
process.exit(failed.length ? 1 : 0);
