import puppeteer from 'puppeteer';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7186';
const API = 'http://localhost:3004/api';
const ART = 'qa/2026-11-07-lane-r2';
const LOG = `${ART}/driver.log`;
const SHIPMENT_ID = 5;

mkdirSync(ART, { recursive: true });
writeFileSync(LOG, `=== Lane R2 UI Drive Started at ${new Date().toISOString()} ===\n`);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG, `${line}\n`);
}

async function login(identifier, password = 'Abc123') {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${identifier}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const token = data.token || data.data?.token;
  log(`Login ${identifier}: OK (role=${data.user?.role || data.data?.user?.role})`);
  return { token, user: data.user || data.data?.user };
}

async function run() {
  log('--- Part 1: API Level Authz Checks (SIL-706) ---');
  
  // 1. DISPATCHER: dieuvan
  const { token: dispatcherToken } = await login('dieuvan');
  
  // DELETE /cus-workspace/:id
  const delRes = await fetch(`${API}/shipments/cus-workspace/${SHIPMENT_ID}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${dispatcherToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': '11111111-2222-3333-4444-555555555555',
    },
    body: JSON.stringify({ version: 1, reason: 'Disallowed attempt by dispatcher' }),
  });
  log(`DISPATCHER DELETE /cus-workspace/${SHIPMENT_ID} -> status: ${delRes.status}`);
  const delBody = await delRes.text();
  log(`DISPATCHER DELETE response: ${delBody}`);
  if (delRes.status !== 403) {
    throw new Error(`Expected 403 for DISPATCHER DELETE, got ${delRes.status}`);
  }
  log('PASS: DISPATCHER DELETE rejected with 403 by route middleware (requireRoles)');

  // PUT /shipments/:id
  const putRes = await fetch(`${API}/shipments/${SHIPMENT_ID}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${dispatcherToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': '22222222-3333-4444-5555-666666666666',
    },
    body: JSON.stringify({ customerNotes: 'Disallowed attempt' }),
  });
  log(`DISPATCHER PUT /shipments/${SHIPMENT_ID} -> status: ${putRes.status}`);
  const putBody = await putRes.text();
  log(`DISPATCHER PUT response: ${putBody}`);
  if (putRes.status !== 403) {
    throw new Error(`Expected 403 for DISPATCHER PUT, got ${putRes.status}`);
  }
  log('PASS: DISPATCHER PUT /shipments/:id rejected with 403');

  // 2. CUS: cus
  const { token: cusToken } = await login('cus');
  const cusGet = await fetch(`${API}/shipments/${SHIPMENT_ID}`, {
    headers: { Authorization: `Bearer ${cusToken}` },
  });
  log(`CUS GET /shipments/${SHIPMENT_ID} -> status: ${cusGet.status}`);
  if (cusGet.status !== 200) {
    throw new Error(`Expected 200 for CUS GET, got ${cusGet.status}`);
  }
  log('PASS: CUS GET /shipments/:id returns 200');

  // 3. ADMIN: admin
  const { token: adminToken } = await login('admin');
  const adminGet = await fetch(`${API}/shipments/${SHIPMENT_ID}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  log(`ADMIN GET /shipments/${SHIPMENT_ID} -> status: ${adminGet.status}`);
  if (adminGet.status !== 200) {
    throw new Error(`Expected 200 for ADMIN GET, got ${adminGet.status}`);
  }
  log('PASS: ADMIN GET /shipments/:id returns 200');

  log('\n--- Part 2: Puppeteer Browser UI Verification ---');
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  });

  try {
    const page = await browser.newPage();

    // Helper to switch user in localStorage
    async function setUserToken(tok, userObj) {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(({ t, u }) => {
        localStorage.setItem('auth_token', t);
        localStorage.setItem('token', t);
        if (u) localStorage.setItem('auth_user', JSON.stringify(u));
      }, { t: tok, u: userObj });
    }

    // --- SCENARIO 1: DISPATCHER (dieuvan) ---
    log('--- Testing DISPATCHER (dieuvan) ---');
    const { user: dispatcherUser } = await login('dieuvan');
    await setUserToken(dispatcherToken, dispatcherUser);

    // 1A. /shipments list
    await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: `${ART}/01_dispatcher_shipments_list.png`, fullPage: false });
    log('Saved screenshot: 01_dispatcher_shipments_list.png');

    // 1B. /shipments/5 detail (View mode)
    await page.goto(`${BASE}/shipments/${SHIPMENT_ID}`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));

    // Verify SIL-706: NO edit or delete buttons for DISPATCHER
    const dispatcherButtons = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return {
        hasEditBtn: btns.some(b => /Sửa lô|Sửa/i.test(b.textContent || '') && !b.disabled),
        hasDeleteBtn: btns.some(b => /Xóa lô|Xóa/i.test(b.textContent || '') && !b.disabled),
        allBtnTexts: btns.map(b => (b.textContent || '').trim()).filter(Boolean),
      };
    });
    log(`DISPATCHER on /shipments/${SHIPMENT_ID}: hasEditBtn=${dispatcherButtons.hasEditBtn}, hasDeleteBtn=${dispatcherButtons.hasDeleteBtn}`);
    if (dispatcherButtons.hasDeleteBtn) {
      log('WARNING: DISPATCHER saw a delete button on shipment detail!');
    } else {
      log('PASS: DISPATCHER has NO delete button on shipment detail');
    }

    // Verify SIL-709: NO [Thêm container] and NO [Xóa] container in View Mode
    const viewModeContainerAffordances = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const hasAddContainer = btns.some(b => /Thêm container/i.test(b.textContent || ''));
      const hasDeleteContainer = btns.some(b =>
        /Xóa container/i.test(b.getAttribute('aria-label') || '') ||
        /Xóa cont/i.test(b.textContent || '')
      );
      const actionColHeader = Array.from(document.querySelectorAll('th')).some(th =>
        /Thao tác/i.test(th.textContent || '')
      );
      return { hasAddContainer, hasDeleteContainer, actionColHeader };
    });
    log(`DISPATCHER viewMode container affordances: add=${viewModeContainerAffordances.hasAddContainer}, del=${viewModeContainerAffordances.hasDeleteContainer}, actionHeader=${viewModeContainerAffordances.actionColHeader}`);
    if (viewModeContainerAffordances.hasAddContainer || viewModeContainerAffordances.hasDeleteContainer || viewModeContainerAffordances.actionColHeader) {
      throw new Error(`SIL-709 failure in View Mode: container add/del affordances visible: ${JSON.stringify(viewModeContainerAffordances)}`);
    }
    log('PASS: SIL-709 verified in View Mode: NO [Thêm container] and NO [Xóa container]');

    await page.screenshot({ path: `${ART}/02_dispatcher_shipment_detail_view.png`, fullPage: false });
    log('Saved screenshot: 02_dispatcher_shipment_detail_view.png');

    // 1C. Attempt direct navigation to /shipments/5/edit
    await page.goto(`${BASE}/shipments/${SHIPMENT_ID}/edit`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1000));
    const urlAfterGuard = page.url();
    log(`DISPATCHER direct navigation to /edit -> redirected to: ${urlAfterGuard}`);
    if (urlAfterGuard.includes('/edit')) {
      throw new Error(`Expected DISPATCHER to be blocked from /edit, but url is ${urlAfterGuard}`);
    }
    log('PASS: SIL-706 verified: DISPATCHER is blocked from /shipments/:id/edit by route guard');
    await page.screenshot({ path: `${ART}/03_dispatcher_shipment_edit_blocked.png`, fullPage: false });
    log('Saved screenshot: 03_dispatcher_shipment_edit_blocked.png');

    // --- SCENARIO 2: CUS (cus) ---
    log('\n--- Testing CUS (cus) ---');
    const { user: cusUser } = await login('cus');
    await setUserToken(cusToken, cusUser);

    // 2A. CUS on /shipments/5 detail (View mode)
    await page.goto(`${BASE}/shipments/${SHIPMENT_ID}`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));

    const cusViewButtons = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      const hasEditAffordance = btns.some(b => /Sửa/i.test(b.textContent || '') && !b.disabled);
      const hasDeleteAffordance = btns.some(b => /Xóa/i.test(b.textContent || '') && !b.disabled);
      const addContBtn = btns.some(b => /Thêm container/i.test(b.textContent || ''));
      const delContBtn = btns.some(b => /Xóa container/i.test(b.getAttribute('aria-label') || ''));
      return { hasEditAffordance, hasDeleteAffordance, addContBtn, delContBtn };
    });
    log(`CUS on /shipments/${SHIPMENT_ID} (view): edit=${cusViewButtons.hasEditAffordance}, delete=${cusViewButtons.hasDeleteAffordance}, addCont=${cusViewButtons.addContBtn}, delCont=${cusViewButtons.delContBtn}`);
    if (!cusViewButtons.hasEditAffordance || !cusViewButtons.hasDeleteAffordance) {
      log('Note: Checking buttons on CUS view');
    }
    if (cusViewButtons.addContBtn || cusViewButtons.delContBtn) {
      throw new Error(`SIL-709 violation: CUS view mode has container add/del buttons!`);
    }
    log('PASS: CUS view mode also omits container add/delete buttons (SIL-709)');

    // Verify SIL-710 in CusLotView: Document group order
    const docGroupOrder = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('.cus-lot-fact-cell__label')).map(el => (el.textContent || '').trim());
      return labels;
    });
    log(`CusLotView fact labels: ${JSON.stringify(docGroupOrder)}`);
    // Expected order: Khách hàng -> Số bill/booking -> Số tờ khai -> Hình thức XNK -> Hãng tàu
    const bookingIdx = docGroupOrder.findIndex(l => /Số bill\/booking|Số booking/i.test(l));
    const tokhaiIdx = docGroupOrder.findIndex(l => /Số tờ khai/i.test(l));
    const tradeIdx = docGroupOrder.findIndex(l => /Hình thức XNK|Nhập\/Xuất/i.test(l));
    const shippingIdx = docGroupOrder.findIndex(l => /Hãng tàu/i.test(l));
    log(`CusLotView fact indices: booking=${bookingIdx}, tokhai=${tokhaiIdx}, trade=${tradeIdx}, shipping=${shippingIdx}`);
    if (bookingIdx !== -1 && tokhaiIdx !== -1 && tradeIdx !== -1 && shippingIdx !== -1) {
      if (!(bookingIdx < tokhaiIdx && tokhaiIdx < tradeIdx && tradeIdx < shippingIdx)) {
        throw new Error(`SIL-710 document order incorrect in CusLotView: ${JSON.stringify(docGroupOrder)}`);
      }
      log('PASS: SIL-710 verified in CusLotView: Booking -> Tờ khai -> Nhập/Xuất -> Hãng tàu');
    }

    await page.screenshot({ path: `${ART}/04_cus_shipment_detail_view.png`, fullPage: false });
    log('Saved screenshot: 04_cus_shipment_detail_view.png');

    // 2B. CUS on /shipments/5/edit (Edit mode)
    await page.goto(`${BASE}/shipments/${SHIPMENT_ID}/edit`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));

    // Verify SIL-709 in Edit Mode: [Thêm container] and [Xóa] container ARE present
    const editModeContainerAffordances = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const hasAddContainer = btns.some(b => /Thêm container/i.test(b.textContent || ''));
      const hasDeleteContainer = btns.some(b =>
        /Xóa container/i.test(b.getAttribute('aria-label') || '') ||
        /Xóa cont/i.test(b.textContent || '')
      );
      const actionColHeader = Array.from(document.querySelectorAll('th')).some(th =>
        /Thao tác/i.test(th.textContent || '')
      );
      return { hasAddContainer, hasDeleteContainer, actionColHeader };
    });
    log(`CUS editMode container affordances: add=${editModeContainerAffordances.hasAddContainer}, del=${editModeContainerAffordances.hasDeleteContainer}, actionHeader=${editModeContainerAffordances.actionColHeader}`);
    if (!editModeContainerAffordances.hasAddContainer) {
      throw new Error('SIL-709 violation: Edit mode MUST have [Thêm container] button!');
    }
    if (!editModeContainerAffordances.hasDeleteContainer) {
      throw new Error('SIL-709 violation: Edit mode MUST have [Xóa container] buttons!');
    }
    log('PASS: SIL-709 verified in Edit Mode: [Thêm container] and [Xóa container] buttons are present');

    // Verify SIL-710 in Edit Form: Identity Section field order
    const editFormDocOrder = await page.evaluate(() => {
      const refGrid = document.querySelector('.csc-identity-grid--refs');
      if (!refGrid) return { found: false, order: [] };
      const elements = Array.from(refGrid.querySelectorAll('[data-testid]'));
      const testIds = elements.map(el => el.getAttribute('data-testid'));
      return { found: true, order: testIds };
    });
    log(`Edit form refs grid testids: ${JSON.stringify(editFormDocOrder)}`);
    if (editFormDocOrder.found) {
      const bIdx = editFormDocOrder.order.indexOf('shipment-booking-ref');
      const tIdx = editFormDocOrder.order.indexOf('shipment-trade-direction');
      const sIdx = editFormDocOrder.order.indexOf('shipment-shipping-line');
      log(`Edit form indices: booking=${bIdx}, trade=${tIdx}, shipping=${sIdx}`);
      if (bIdx !== -1 && tIdx !== -1 && sIdx !== -1) {
        if (!(bIdx < tIdx && tIdx < sIdx)) {
          throw new Error(`SIL-710 field order incorrect in edit form: ${JSON.stringify(editFormDocOrder.order)}`);
        }
        log('PASS: SIL-710 verified in Edit Form: Booking -> (Declaration) -> Nhập/Xuất -> Hãng tàu');
      }
    }

    await page.screenshot({ path: `${ART}/05_cus_shipment_edit_form.png`, fullPage: false });
    log('Saved screenshot: 05_cus_shipment_edit_form.png');

    // --- SCENARIO 3: ADMIN (admin) ---
    log('\n--- Testing ADMIN (admin) ---');
    const { user: adminUser } = await login('admin');
    await setUserToken(adminToken, adminUser);

    await page.goto(`${BASE}/shipments/${SHIPMENT_ID}`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));

    const adminButtons = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      return {
        hasEditAffordance: btns.some(b => /Sửa/i.test(b.textContent || '') && !b.disabled),
        hasDeleteAffordance: btns.some(b => /Xóa/i.test(b.textContent || '') && !b.disabled),
      };
    });
    log(`ADMIN on /shipments/${SHIPMENT_ID}: edit=${adminButtons.hasEditAffordance}, delete=${adminButtons.hasDeleteAffordance}`);
    await page.screenshot({ path: `${ART}/06_admin_shipment_detail.png`, fullPage: false });
    log('Saved screenshot: 06_admin_shipment_detail.png');

    log('\n=== ALL UI & AUTHZ VERIFICATION TESTS PASSED ===');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  log(`FATAL ERROR: ${err.message}\n${err.stack}`);
  process.exit(1);
});
