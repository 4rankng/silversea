// QA driver (c-detail) — badge Nhập lẻ trên trang chi tiết lô hàng.
// BASE/TAG tham chiếu như driver chính. Lô LCL QA: shipment 312423 (LONG MINH).
import { chromium } from '@playwright/test';
import { appendFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:7176';
const TAG = process.env.TAG || 'sau';
const OUT = process.env.OUT || '../../2026-10-22-tiepvu2';
const LOG = `${OUT}/qa-tiepvu2-${TAG}-driver.log`;
const SHIP = process.env.SHIP || '312423';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[name="username"]', 'admin');
  await page.fill('input[name="password"]', 'Abc123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/shipments/${SHIP}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const dd = await page.locator('dt:has-text("Xuất / Nhập") + dd').innerText().catch(() => '');
  const loaiLo = await page.locator('dt:has-text("Loại lô") + dd').innerText().catch(() => '');
  appendFileSync(LOG, `(c) detail ${SHIP}: Xuất / Nhập="${dd}" | Loại lô="${loaiLo}" | url=${page.url()}\n`);
  await page.screenshot({ path: `${OUT}/2026-10-22-tiepvu2_${TAG}_cus-c2-detail.png` });
  console.log(`OK (c-detail) ${TAG}: "${dd}"`);
} catch (e) {
  appendFileSync(LOG, `FAIL-c-detail: ${e?.message}\n`);
  console.log(`FAIL (c-detail) ${e?.message}`);
} finally {
  await browser.close();
}
