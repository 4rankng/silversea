// SIL-665 — Driver portal: Cont/Seal photo placeholder frames clickable + redundant buttons removed
// Rung-3 verification drive on LOCAL stack (frontend 7175 / backend 3002).
// User: bqhuong / Abc123
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7290}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const DRIVER = process.env.DRIVER ?? 'bqhuong';
const OUT = path.resolve('qa/2026-11-03_sil665');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '2026-11-03_sil665_ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `2026-11-03_sil665_ui-${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// 1. Health check
const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') {
  log('ABORT: local API health not ok');
  process.exit(2);
}

// 2. Login
const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: DRIVER, password: 'Abc123' }),
});
if (!loginRes.ok) {
  log(`ABORT: login failed for ${DRIVER} (${loginRes.status})`);
  process.exit(2);
}
const { token } = await loginRes.json();
log(`LOGIN ok driver=${DRIVER}`);

const TRIP_ID = Number(process.env.TRIP_ID ?? 576);
log(`DRIVING tripId=${TRIP_ID}`);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();

// Set mobile viewport 390x844
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument((t) => {
  if (location.origin.startsWith('http://localhost')) {
    localStorage.setItem('token', t);
  }
}, token);

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

// Navigate to driver trip detail
await page.goto(`${FRONT}/my-trips/${TRIP_ID}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.dcc-bento__photos', { timeout: 15000 });
await sleep(600);

// Scroll into view of .dcc-bento__photos
await page.evaluate(() => {
  document.querySelector('.dcc-bento__photos')?.scrollIntoView({ behavior: 'instant', block: 'center' });
});
await sleep(400);

// Assert bento photo section structure
const photoSectionState = await page.evaluate(() => {
  const photosEl = document.querySelector('.dcc-bento__photos');
  if (!photosEl) return null;
  const contBtn = photosEl.querySelector('button[aria-label="Thêm ảnh cont"]');
  const sealBtn = photosEl.querySelector('button[aria-label="Thêm ảnh seal"]');
  const noteBtn = photosEl.querySelector('button[aria-label="Thêm ảnh biên bản"]');
  const allCaptureBtns = Array.from(photosEl.querySelectorAll('.dcc-capture-btn')).map(b => b.textContent?.trim());
  return {
    hasContBtn: !!contBtn,
    contBtnClass: contBtn?.className,
    contBtnText: contBtn?.textContent?.trim(),
    hasSealBtn: !!sealBtn,
    sealBtnClass: sealBtn?.className,
    sealBtnText: sealBtn?.textContent?.trim(),
    hasNoteBtn: !!noteBtn,
    allCaptureBtns,
  };
});

log(`PHOTO SECTION STATE: ${JSON.stringify(photoSectionState)}`);
check('Khung Cont là button có aria-label="Thêm ảnh cont"', photoSectionState?.hasContBtn);
check('Khung Cont mang class dcc-bento__tile-btn--empty', photoSectionState?.contBtnClass?.includes('dcc-bento__tile-btn--empty'));
check('Khung Seal là button có aria-label="Thêm ảnh seal"', photoSectionState?.hasSealBtn);
check('Khung Seal mang class dcc-bento__tile-btn--empty', photoSectionState?.sealBtnClass?.includes('dcc-bento__tile-btn--empty'));
check('2 nút thừa Thêm ảnh cont/seal đã bị bỏ khỏi bento view', 
  !photoSectionState?.allCaptureBtns.some(t => t?.includes('Thêm ảnh cont') || t?.includes('Thêm ảnh seal')),
  `captureBtns=${JSON.stringify(photoSectionState?.allCaptureBtns)}`
);
check('Nút Thêm ảnh biên bản được giữ nguyên', photoSectionState?.allCaptureBtns.some(t => t?.includes('Thêm ảnh biên bản')));

await shot(page, '01-bento-photos-before-click-390');

// Click Cont frame
log('Clicking Cont placeholder frame...');
await page.click('.dcc-bento__photos button[aria-label="Thêm ảnh cont"]');
await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
await sleep(300);

const contDialogState = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return null;
  const title = dialog.querySelector('h2, .modal-title, .dialog-title, header, div')?.textContent ?? dialog.textContent;
  const buttons = Array.from(dialog.querySelectorAll('button')).map(b => b.textContent?.trim());
  return { title, buttons };
});

log(`CONT DIALOG STATE: ${JSON.stringify(contDialogState)}`);
check('Bấm khung Cont mở dialog Thêm ảnh cont', contDialogState?.title?.includes('Thêm ảnh cont'));
check('Dialog Cont có nút Chụp ảnh', contDialogState?.buttons.some(b => b?.includes('Chụp ảnh')));
check('Dialog Cont có nút Chọn từ thư viện', contDialogState?.buttons.some(b => b?.includes('Chọn từ thư viện')));
check('Dialog Cont có nút Hủy', contDialogState?.buttons.some(b => b?.includes('Hủy')));

await shot(page, '02-cont-dialog-opened-from-frame-390');

// Close dialog
const cancelBtn = await page.evaluateHandle(() => {
  const buttons = Array.from(document.querySelectorAll('[role="dialog"] button'));
  return buttons.find(b => b.textContent?.includes('Hủy'));
});
if (cancelBtn) {
  await cancelBtn.asElement()?.click();
  await sleep(400);
}

// Click Seal frame
log('Clicking Seal placeholder frame...');
await page.click('.dcc-bento__photos button[aria-label="Thêm ảnh seal"]');
await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
await sleep(300);

const sealDialogState = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return null;
  const title = dialog.querySelector('h2, .modal-title, .dialog-title, header, div')?.textContent ?? dialog.textContent;
  const buttons = Array.from(dialog.querySelectorAll('button')).map(b => b.textContent?.trim());
  return { title, buttons };
});

log(`SEAL DIALOG STATE: ${JSON.stringify(sealDialogState)}`);
check('Bấm khung Seal mở dialog Thêm ảnh seal (đúng mục, không nhầm sang Cont)', sealDialogState?.title?.includes('Thêm ảnh seal') && !sealDialogState?.title?.includes('Thêm ảnh cont'));
check('Dialog Seal có nút Chụp ảnh', sealDialogState?.buttons.some(b => b?.includes('Chụp ảnh')));
check('Dialog Seal có nút Chọn từ thư viện', sealDialogState?.buttons.some(b => b?.includes('Chọn từ thư viện')));

await shot(page, '03-seal-dialog-opened-from-frame-390');

// Close dialog
const cancelBtn2 = await page.evaluateHandle(() => {
  const buttons = Array.from(document.querySelectorAll('[role="dialog"] button'));
  return buttons.find(b => b.textContent?.includes('Hủy'));
});
if (cancelBtn2) {
  await cancelBtn2.asElement()?.click();
  await sleep(400);
}

// Desktop view 1440x900
log('Testing desktop view (1440x900)...');
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
await sleep(500);

await page.evaluate(() => {
  document.querySelector('.dcc-bento__photos')?.scrollIntoView({ behavior: 'instant', block: 'center' });
});
await sleep(300);
await shot(page, '04-bento-desktop-1440');

// Click Cont frame on desktop
await page.click('.dcc-bento__photos button[aria-label="Thêm ảnh cont"]');
await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
await sleep(300);

const desktopContDialog = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]');
  return !!dialog && (dialog.textContent?.includes('Thêm ảnh cont') ?? false);
});
check('Desktop 1440px: Bấm khung Cont mở dialog thành công', desktopContDialog);
await shot(page, '05-cont-dialog-desktop-1440');

await browser.close();

log(`\nUI VERIFICATION COMPLETE: ${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
