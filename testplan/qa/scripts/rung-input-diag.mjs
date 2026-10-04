// Input delivery diagnostic: trusted vs all events, pre- and post-login navigation.
import { launch, login, probe } from './lead-qa-lib.mjs';

const { browser, page, base } = await launch({ width: 1440, height: 900 });

// Phase 1: /login pre-nav tap on username input
await page.goto(`${base}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));
const before1 = await probe(page);
await page.mouse.move(400, 380);
await page.mouse.down();
await page.mouse.up();
await new Promise((r) => setTimeout(r, 400));
const after1 = await probe(page);
const focus1 = await page.evaluate(() => document.activeElement?.tagName + '/' + (document.activeElement?.type || ''));
console.log('PHASE1 login', JSON.stringify({ before1, after1, focus1 }));

// Phase 2: login then tap on /dispatch
await login(page, base, 'dungnv');
await page.goto(`${base}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));
const before2 = await probe(page);
const el = await page.$('.master-plan-grid tbody tr:nth-child(2) .master-plan-grid__allocation-trigger');
const box = await el.boundingBox();
const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.up();
await new Promise((r) => setTimeout(r, 600));
const after2 = await probe(page);
const focus2 = await page.evaluate(() => document.activeElement?.tagName + '/' + (document.activeElement?.className || '').toString().slice(0, 40));
const dialog = await page.evaluate(() => !!document.querySelector('.dispatch-allocation-popover,[role=dialog]'));
console.log('PHASE2 dispatch', JSON.stringify({ cx, cy, before2, after2, focus2, dialog }));
await browser.close();
