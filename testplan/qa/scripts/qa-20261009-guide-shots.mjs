// Clean placeholder shot for the guide (no clicks — field renders HH:mm / DD/MM/YYYY)
import { launch, login, step, evidenceDir, BASE } from './lead-qa-harness.mjs';
const dir = evidenceDir('2026-10-09_wave8b-leadqa');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page } = await launch({ width: 1440, height: 900 });
await login(page, 'thanhdc');
await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);
const root = await page.$('[data-split-datetime]');
await root.evaluate((n) => n.scrollIntoView({ block: 'center' }));
await sleep(400);
await page.screenshot({ path: `${dir}/guide-placeholder-closeup.png`, clip: { x: 1050, y: (await root.boundingBox()).y - 60, width: 380, height: 160 } });
await page.screenshot({ path: `${dir}/guide-shipment-form-full.png`, fullPage: true });
await browser.close();
console.log('GUIDE SHOTS DONE');
