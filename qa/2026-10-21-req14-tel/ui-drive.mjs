// REQ-14 — rung-3 UI drive (AGENTS §9): SĐT kho/nhà máy trong chi tiết
// NHẬN LỆNH của tài xế là điều khiển chạm-gọi (tel: link), mobile 390px.
// Surface: /my-trips/:tripId → THÔNG TIN LỆNH grid (SĐT kho, SĐT liên hệ)
// + modal "Chọn liên hệ để gọi" (số nhà máy dạng chấm "0901.234.567" →
// href tel:0901234567, text hiển thị giữ nguyên dấu chấm).
// Stack: frontend http://localhost:7175 (worktree feat-req14-tel-link)
//        → backend :3002 → local dev DB (ss-prod-db / silversea).
// Scenario data (local QA-only mutations): trip 85065 (CREATED, quyet),
// fulfillment 65494, containers → operational_site 441 "Kho Biển Bạc - Đà Nẵng"
// (khoPhone 02253555555; contacts: Phạm Thị Biển 02253555555 + Bảo vệ kho
// 0901.234.567).
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const ART = 'qa/2026-10-21-req14-tel';
const LOG = 'qa/2026-10-21-req14-tel/ui-driver.log';
const TRIP_ID = 85065;
mkdirSync(ART, { recursive: true });
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'quyet', password: 'Abc123' }),
});
const { token } = await login.json();
log(`login quyet (DRIVER): ${token ? 'OK' : 'FAIL'}`);
if (!token) process.exit(1);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox'],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('dialog', (d) => void d.accept());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${BASE}/my-trips/${TRIP_ID}`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction(() => document.body?.innerText.includes('SĐT kho'), { timeout: 30000 });
await sleep(600);
check('detail page renders the driver task grid (not the login screen)', await page.evaluate(() => !document.body.innerText.includes('Đăng nhập')), `url=${page.url()}`);

// 1) THÔNG TIN LỆNH grid — SĐT kho / SĐT liên hệ rows are tel: anchors.
const grid = await page.evaluate(() => {
  const facts = [...document.querySelectorAll('.driver-task-fact')];
  const rowFor = (label) => facts.find((f) => f.querySelector('.driver-task-fact__label')?.textContent?.trim() === label);
  const pick = (label) => {
    const row = rowFor(label);
    if (!row) return null;
    const a = row.querySelector('.driver-task-fact__value a[href^="tel:"]');
    return { text: row.querySelector('.driver-task-fact__value')?.textContent?.trim() ?? '', href: a?.getAttribute('href') ?? null, isAnchor: Boolean(a) };
  };
  return { kho: pick('SĐT kho'), lienHe: pick('SĐT liên hệ') };
});
check('SĐT kho row renders an <a href="tel:…">', grid.kho?.isAnchor === true, JSON.stringify(grid.kho));
check('SĐT kho href normalized (spaces/dots stripped)', grid.kho?.href === 'tel:02253555555', `href=${grid.kho?.href}`);
check('SĐT liên hệ row renders an <a href="tel:…"> (number differs from kho)', grid.lienHe?.isAnchor === true, JSON.stringify(grid.lienHe));
check('SĐT liên hệ href normalized', grid.lienHe?.href === 'tel:0987654321', `href=${grid.lienHe?.href}`);

await page.screenshot({ path: `${ART}/ui-1-info-grid-tel-rows.png`, fullPage: false });
log('shot ui-1-info-grid-tel-rows.png (390px, THÔNG TIN LỆNH grid)');

// 2) Call sheet — 2 contacts → "Gọi kho" button opens the modal; the
//    displayed number itself is a tel: link (REQ-14 delta) beside the Gọi button.
const barButton = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.driver-task-call-bar button, .driver-task-call-bar a')].find((b) => (b.textContent || '').includes('Gọi kho'));
  if (!btn) return { found: false };
  btn.click();
  return { found: true, tag: btn.tagName.toLowerCase(), href: btn.getAttribute('href') };
});
check('call bar renders a Gọi kho affordance (multi-contact → modal button)', barButton.found === true, JSON.stringify(barButton));
await page.waitForFunction(() => document.body?.innerText.includes('Chọn liên hệ để gọi'), { timeout: 15000 });
await sleep(500);

const modal = await page.evaluate(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"], .modal, [class*="modal"]')].find((m) => (m.textContent || '').includes('Chọn liên hệ để gọi'));
  if (!dialog) return null;
  const rows = [...dialog.querySelectorAll('.site-contact-list__row')].map((row) => {
    const name = row.querySelector('.site-contact-list__identity > span')?.textContent?.trim() ?? '';
    const tel = row.querySelector('a.site-contact-list__phone[href^="tel:"]');
    const goi = [...row.querySelectorAll('a, button')].find((el) => (el.textContent || '').trim() === 'Gọi');
    return {
      name,
      numberText: tel?.textContent?.trim() ?? row.querySelector('.site-contact-list__phone')?.textContent?.trim() ?? '',
      telHref: tel?.getAttribute('href') ?? null,
      numberIsLink: Boolean(tel),
      goiHref: goi?.getAttribute('href') ?? null,
    };
  });
  return rows;
});
check('modal lists both nhà máy contacts', Array.isArray(modal) && modal.length === 2, JSON.stringify(modal));
const bien = modal?.find((r) => r.name.includes('Phạm Thị Biển'));
const baoVe = modal?.find((r) => r.name.includes('Bảo vệ kho'));
check('contact 1 (Phạm Thị Biển): displayed number is a tel: link with normalized href', bien?.numberIsLink === true && bien?.telHref === 'tel:02253555555', JSON.stringify(bien));
check('contact 2 (Bảo vệ kho, dots kept on screen): href strips dots → tel:0901234567', baoVe?.numberText === '0901.234.567' && baoVe?.telHref === 'tel:0901234567', JSON.stringify(baoVe));
check('explicit Gọi buttons still present beside the numbers (layout untouched)', modal?.every((r) => (r.goiHref ?? '').startsWith('tel:')) === true, `goiHrefs=${modal?.map((r) => r.goiHref).join(', ')}`);

await page.screenshot({ path: `${ART}/ui-2-call-modal-tel-links.png`, fullPage: false });
log('shot ui-2-call-modal-tel-links.png (390px, modal Chọn liên hệ để gọi)');

await browser.close();
log(failures === 0 ? 'RESULT: ALL CHECKS PASS' : `RESULT: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
