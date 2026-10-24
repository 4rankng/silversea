// SIL-191 — rung-3 UI drive (BEFORE = staging fe966b30 read-only; AFTER = worktree local stack).
// FB-093 QA R42: chọn lô đã ghép trên /accounting/chot-debit → thanh công cụ
// phải có "Tách nhóm". Staging build fe966b30 KHÔNG có nút ở bất kỳ đâu
// (per-row chỉ render khi lcl.revGroupId != null — lô ghép TRẢ ĐV của QA là
// cost-merged nên cell không bao giờ sinh nút). Sau fix: strip expose "Tách
// nhóm" cho multi-select đang ghép, đúng dimension (REV/COST).
// Run: node qa/scripts/2026-10-24-sil191-tach-nhom-ui-drive.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const LOCAL_API = process.env.API ?? 'http://localhost:3092/api';
const LOCAL_FRONT = process.env.FRONT ?? 'http://localhost:7175';
const STAGING = 'https://vantai.tingting.vip';
const PSQL_C = process.env.PSQL_CONTAINER ?? 'ss-prod-db';
const OUT = path.resolve('qa/2026-10-24-sil-r42');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver-sil191.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail) => { log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures += 1; };
const jf = async (url, opts) => { const res = await fetch(url, opts); let body = null; try { body = await res.json(); } catch { body = null; } return { status: res.status, body }; };
const authH = (t, e = {}) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...e });
const psql = (sql) => execSync(`docker exec ${PSQL_C} psql -U postgres -d silversea -qtAX -c ${JSON.stringify(sql)}`).toString().trim();
const login = async (base, identifier) => {
  for (let i = 0; i < 3; i++) {
    const r = await jf(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
    if (r.body?.token) return r.body.token;
    await sleep(1000);
  }
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// PHASE A — BEFORE trên STAGING (build fe966b30), CHỈ ĐỌC: đăng nhập hoapt,
// chọn đúng cặp lô QA đã dùng (ghép TRẢ ĐV), chụp thanh công cụ.
// ─────────────────────────────────────────────────────────────────────────────
async function phaseBefore(browser) {
  log('── PHASE A: BEFORE trên staging fe966b30 (read-only) ──');
  const token = await login(`${STAGING}/api`, 'hoapt');
  if (!token) { check('BEFORE: login hoapt staging', false, 'ABORT'); return; }
  check('BEFORE: login hoapt (Kế toán) staging OK', true);

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  // puppeteer-spa-auth: token vào localStorage TRƯỚC mọi page load của origin.
  await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('token', t); } catch {} }, token);
  await page.goto(`${STAGING}/accounting/chot-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  check('BEFORE: không bị đẩy về login', !page.url().includes('/login'), page.url());

  // Đợt mặc định = tháng hiện tại; lô QA có ngay=2026-10-24 → nằm trong kỳ.
  const searchInput = await page.waitForSelector('input[aria-label="Tìm lô hàng"]', { timeout: 30000 }).catch(() => null);
  if (!searchInput) { check('BEFORE: thấy ô tìm kiếm', false, 'ABORT'); await page.close(); return; }
  await searchInput.type('R39B1');
  await sleep(1500);

  // Định danh hàng theo DÒNG ĐẦU TIÊN của cell lô (bill thật) — textContent
  // nguyên hàng chứa cả note "(Ghép cùng Bill <ref khác>)" của hàng BẠN KIA,
  // find() theo text thô sẽ khớp nhầm hàng (bug đã gặp trong drive này).
  const clickRowByRef = async (ref) => {
    const handle = await page.evaluateHandle((want) => {
      const rows = [...document.querySelectorAll('tbody tr')];
      return rows.find((tr) => {
        const first = tr.querySelector('.debit-col--lot span');
        return (first?.textContent ?? '').trim() === want || (tr.querySelector('td:nth-child(2)')?.textContent ?? '').trim().startsWith(want);
      }) ?? null;
    }, ref);
    const el = handle.asElement();
    if (!el) return { found: false, selected: false };
    const box = await el.boundingBox();
    if (!box) return { found: false, selected: false };
    await page.mouse.click(box.x + Math.min(box.width / 2, 300), box.y + box.height / 2);
    await sleep(700);
    const selected = await page.evaluate((want) => {
      const rows = [...document.querySelectorAll('tbody tr')];
      const row = rows.find((tr) => (tr.querySelector('.debit-col--lot span')?.textContent ?? '').trim() === want);
      return row?.hasAttribute('data-selected') ?? false;
    }, ref);
    return { found: true, selected };
  };
  const r1 = await clickRowByRef('R39B1-LCL01');
  check('BEFORE: chọn R39B1-LCL01 (row data-selected)', r1.found && r1.selected, JSON.stringify(r1));
  const r2 = await clickRowByRef('R39B1-LCL02');
  check('BEFORE: chọn R39B1-LCL02 (row data-selected)', r2.found && r2.selected, JSON.stringify(r2));
  await sleep(800);
  const stripText = await page.evaluate(() => document.querySelector('.debit-selection')?.textContent ?? '');
  check('BEFORE: strip báo "Đã chọn 2 lô"', stripText.includes('Đã chọn 2 lô'), stripText.slice(0, 120));
  const counts = await page.evaluate(() => ({
    strip: document.querySelectorAll('.debit-selection .tach-nhom-action').length,
    anywhere: document.querySelectorAll('.tach-nhom-action').length,
  }));
  check('BEFORE (defect): strip KHÔNG có nút Tách nhóm', counts.strip === 0, `strip=${counts.strip}`);
  check('BEFORE (defect): toàn trang KHÔNG có nút Tách nhóm nào (per-row không render với lô cost-merged)', counts.anywhere === 0, `anywhere=${counts.anywhere}`);
  await page.screenshot({ path: path.join(OUT, 'ui-before-staging-1440.png') });
  log('SCREENSHOT qa/2026-10-24-sil-r42/ui-before-staging-1440.png');
  await page.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE B — AFTER trên local worktree stack: dựng fixture Q- ghép TRẢ ĐV
// (đúng dimension của QA), lái strip Tách nhóm tới tận DB.
// ─────────────────────────────────────────────────────────────────────────────
async function phaseAfter(browser) {
  log('── PHASE B: AFTER trên local worktree (BE :3092 / FE :7175) ──');
  const health = await jf(`${LOCAL_API}/health`);
  check('AFTER: local API health', health.body?.status === 'ok');
  const cusToken = await login(LOCAL_API, 'cus');
  const disToken = await login(LOCAL_API, 'bacdk');
  const ktToken = await login(LOCAL_API, 'hoapt');
  if (!cusToken || !disToken || !ktToken) { check('AFTER: logins (cus/bacdk/hoapt)', false, 'ABORT'); return; }
  check('AFTER: logins cus (tạo lô) + bacdk (ghép trả ĐV) + hoapt (Kế toán drive)', true);

  const key = () => crypto.randomUUID();
  const boot = (await jf(`${LOCAL_API}/catalogs/bootstrap`, { headers: authH(cusToken) })).body;
  const customers = (await jf(`${LOCAL_API}/customers?limit=5`, { headers: authH(cusToken) })).body;
  const cust = (customers.items ?? customers.rows ?? customers)[0];
  const classes = (await jf(`${LOCAL_API}/vehicle-size-classes`, { headers: authH(cusToken) })).body;
  const classList = classes.items ?? classes.rows ?? classes ?? [];
  const vclass = classList[0];
  check('AFTER: fixture catalog (khách hàng + loại xe)', cust?.id != null && vclass?.id != null, `customer=${cust?.id} class=${vclass?.id}`);

  const stamp = Date.now().toString().slice(-6);
  const today = new Date().toISOString().slice(0, 10);
  const quickLcl = async (suffix) => (await jf(`${LOCAL_API}/shipments/quick`, { method: 'POST', headers: authH(cusToken, { 'Idempotency-Key': key() }), body: JSON.stringify({
    customerId: cust.id, tradeDirection: 'IMPORT', blNumber: `Q191${suffix}${stamp}`, shippingLineName: 'MAERSK',
    cargoMode: 'LCL', expectedDeliveryDate: today,
  }) })).body?.id;
  const lotA = await quickLcl('A');
  const lotB = await quickLcl('B');
  check('AFTER: tạo 2 lô Q- LCL', lotA != null && lotB != null, `A=${lotA} B=${lotB}`);

  // Ghép TRẢ ĐV (cost dimension — đúng kịch bản QA R42) bằng token ĐIỀU VẬN.
  const merge = await jf(`${LOCAL_API}/shipments/lcl/cost-group`, { method: 'POST', headers: authH(disToken, { 'Idempotency-Key': key() }), body: JSON.stringify({
    shipmentIds: [lotA, lotB], vehicleSizeClassId: vclass.id, actualTruckNo: '29C-191.19',
  }) });
  check('AFTER: ghép trả ĐV (cost group) 201', merge.status === 201, `status=${merge.status} ${JSON.stringify(merge.body).slice(0, 160)}`);
  const groupIdPre = psql(`select cost_group_id from shipments where id=${lotA}`).trim();
  check('AFTER: DB rev/cost group đã gắn trước drive', groupIdPre !== '', `cost_group_id=${groupIdPre}`);

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('token', t); } catch {} }, ktToken);
  await page.goto(`${LOCAL_FRONT}/accounting/chot-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2000);
  check('AFTER: không bị đẩy về login', !page.url().includes('/login'), page.url());

  const searchInput = await page.waitForSelector('input[aria-label="Tìm lô hàng"]', { timeout: 30000 }).catch(() => null);
  // Needle = stamp 6 số: nằm trong bill CẢ HAI lô Q191A/B<stamp>, không đụng lô khác.
  await searchInput.type(stamp);
  await sleep(1500);
  const clickRowByRef = async (ref) => {
    // Định danh theo dòng ĐẦU TIÊN của cell lô — hàng member mang note
    // "(Ghép cùng Bill <principal>)" nên find theo text thô khớp nhầm hàng.
    const handle = await page.evaluateHandle((want) => {
      const rows = [...document.querySelectorAll('tbody tr')];
      return rows.find((tr) => (tr.querySelector('.debit-col--lot span')?.textContent ?? '').trim() === want) ?? null;
    }, ref);
    const el = handle.asElement();
    if (!el) return { found: false, selected: false };
    const box = await el.boundingBox();
    if (!box) return { found: false, selected: false };
    await page.mouse.click(box.x + Math.min(box.width / 2, 300), box.y + box.height / 2);
    await sleep(700);
    const selected = await page.evaluate((want) => {
      const rows = [...document.querySelectorAll('tbody tr')];
      const row = rows.find((tr) => (tr.querySelector('.debit-col--lot span')?.textContent ?? '').trim() === want);
      return row?.hasAttribute('data-selected') ?? false;
    }, ref);
    return { found: true, selected };
  };
  const refA = `Q191A${stamp}`;
  const refB = `Q191B${stamp}`;
  const rA = await clickRowByRef(refA);
  check('AFTER: chọn lô Q-191 A (data-selected)', rA.found && rA.selected, `${refA} ${JSON.stringify(rA)}`);
  const rB = await clickRowByRef(refB);
  check('AFTER: chọn lô Q-191 B (data-selected)', rB.found && rB.selected, `${refB} ${JSON.stringify(rB)}`);
  await sleep(800);

  const stripButton = await page.waitForSelector('.debit-selection .tach-nhom-action', { timeout: 8000 }).catch(() => null);
  check('AFTER: strip CÓ nút "Tách nhóm" khi chọn 2 lô đang ghép', stripButton != null);
  if (!stripButton) { await page.screenshot({ path: path.join(OUT, 'ui-after-local-1440.png') }); await page.close(); return; }
  const aria = await page.evaluate((el) => ({ label: el.getAttribute('aria-label'), disabled: el.getAttribute('aria-disabled') }), stripButton);
  check('AFTER: nút armed (aria-disabled không set) + aria nêu đúng dimension trả ĐV', aria.disabled == null && (aria.label ?? '').includes('ghép trả ĐV'), JSON.stringify(aria));
  await page.screenshot({ path: path.join(OUT, 'ui-after-local-1440.png') });
  log('SCREENSHOT qa/2026-10-24-sil-r42/ui-after-local-1440.png (chưa click)');

  // Click lại theo tọa độ MỚI (strip có thể re-render giữa 2 lần đọc).
  const fresh = await page.$('.debit-selection .tach-nhom-action');
  if (!fresh) { check('AFTER: click nút strip', false, 'mất nút trước khi click'); await page.close(); return; }
  const fbox = await fresh.boundingBox();
  await page.mouse.click(fbox.x + fbox.width / 2, fbox.y + fbox.height / 2);
  await sleep(900);
  const dialogText = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '');
  check('AFTER: dialog confirm copy ghép trả ĐV', dialogText.includes('Tách nhóm ghép trả ĐV') && dialogText.includes('cước trả ĐV độc lập'), dialogText.slice(0, 140));

  // Confirm là nút CUỐI tên đúng "Tách nhóm" trong dialog.
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('[role="dialog"] button')];
    const confirm = buttons.filter((b) => (b.textContent ?? '').trim() === 'Tách nhóm').at(-1);
    confirm?.click();
  });
  await sleep(3500);
  const afterCounts = await page.evaluate(() => ({
    strip: document.querySelectorAll('.debit-selection .tach-nhom-action').length,
    body: document.body.textContent ?? '',
  }));
  check('AFTER: sau tách, strip hết nút (lô không còn ghép)', afterCounts.strip === 0);
  check('AFTER: toast "Đã tách nhóm cước trả ĐV" hiển thị', afterCounts.body.includes('Đã tách nhóm cước trả ĐV'));
  await page.screenshot({ path: path.join(OUT, 'ui-after-local-1440-unmerged.png') });
  log('SCREENSHOT qa/2026-10-24-sil-r42/ui-after-local-1440-unmerged.png');

  const dbPost = psql(`select id || '=' || coalesce(cost_group_id,'<NULL>') || '/' || coalesce(cost_vehicle_class_id::text,'<NULL>') from shipments where id in (${lotA},${lotB}) order by id`).split('\n').join(' | ');
  check('AFTER: DB side-effect — cost_group_id + loại xe nhóm gỡ khỏi cả 2 lô', dbPost.includes('<NULL>') && !dbPost.includes(groupIdPre), dbPost);
  fs.writeFileSync(path.join(OUT, 'db-side-effect-sil191.txt'),
    `TRƯỚC: shipments ${lotA},${lotB} cost_group_id=${groupIdPre}\nSAU : ${dbPost}\n(unmerge qua POST /api/shipments/lcl/unmerge-group dimension=COST từ nút strip)`);
  await page.close();
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  await phaseBefore(browser);
  await phaseAfter(browser);
} finally {
  await browser.close();
}
log(failures === 0 ? 'SIL-191 UI drive: ALL PASS' : `SIL-191 UI drive: ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
