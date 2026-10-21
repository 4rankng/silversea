// UI drive — CUS-10 (ruling Frank 21/10): the Tổng quan drawer's "Chi tiết
// container" deletes a container ONLY through the labeled danger button +
// confirm "Xóa container <số>?". TICKET-09 stays untouched: this driver never
// visits /shipments-detail (its absence pins live in vitest).
//
// Flow: login cus → search the lot → open the drawer → assert the labeled
// danger button → click → confirm dialog names the number (API NOT yet fired)
// → confirm → POST …/remove 200 → drawer CLOSES → toast → re-open drawer:
// the deleted cont is gone (danh sách mất cont).
//
// Run: QA_BASE=http://localhost:7175 QA_LOT=311985 QA_CONT=QATU0001234 \
//      QA_USER=cus node testplan/qa/scripts/2026-10-21-cus10-drawer-delete-ui-drive.mjs
// Ports come from the environment (dev-port contract); no hardcoded ports.
import { mkdirSync, appendFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.QA_BASE;
const LOT = process.env.QA_LOT ?? '311985';
const CONT = process.env.QA_CONT ?? 'QATU0001234';
const USER = process.env.QA_USER ?? 'cus';
const PASS = process.env.QA_PASS ?? 'Abc123';
if (!BASE) {
  console.error('QA_BASE is required (dev-port contract: no hardcoded ports).');
  process.exit(2);
}
const DIR = `${process.cwd()}/qa/2026-10-21-cus10-drawer-delete`;
mkdirSync(DIR, { recursive: true });
const logPath = `${DIR}/ui-driver.log`;
const log = (line) => {
  console.log(line);
  appendFileSync(logPath, `${line}\n`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
  let removePosts = 0;
  let removeStatus = 0;
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('response', (res) => {
    if (res.url().includes(`/containers/${LOT}`) === false && res.url().includes('/remove') === false) return;
    if (res.url().includes('/remove') && res.request().method() === 'POST') {
      removePosts += 1;
      removeStatus = res.status();
      log(`REMOVE POST → ${res.status()} ${res.url()}`);
    }
  });

  // ── Login ────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 45_000 });
  await page.waitForSelector('#username-input', { timeout: 20_000 });
  await page.evaluate((user, pass) => {
    const set = (sel, value) => {
      const el = document.querySelector(sel);
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      desc.set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('#username-input', user);
    set('#password-input', pass);
    document.querySelector('form').requestSubmit();
  }, USER, PASS);
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30_000 });
  log(`LOGIN OK as ${USER} → ${await page.evaluate(() => location.pathname)}`);

  // ── Find the lot and open the drawer ─────────────────────────────────────
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 45_000 });
  await page.waitForSelector('input[aria-label="Tìm lô hàng"]', { timeout: 30_000 });
  // The list row shows composition chips (e.g. "2x40HC"), never the raw cont
  // numbers — the reliable filter signal is the filtered row COUNT.
  await page.click('input[aria-label="Tìm lô hàng"]');
  await page.type('input[aria-label="Tìm lô hàng"]', CONT, { delay: 40 });
  await page.waitForFunction(() => (
    document.querySelectorAll('button[aria-label^="Mở chi tiết lô hàng"]').length === 1
  ), { timeout: 30_000 });
  log(`SEARCH OK — 1 row for ${CONT}`);
  const rowTextBefore = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button[aria-label^="Mở chi tiết lô hàng"]'))[0];
    return btn ? btn.closest('tr')?.textContent?.replace(/\s+/g, ' ').trim() ?? '' : '';
  });
  log(`ROW BEFORE: ${rowTextBefore.slice(0, 220)}`);

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button[aria-label^="Mở chi tiết lô hàng"]'))[0];
    btn.click();
  });
  await page.waitForSelector('.cus-shipment-drawer', { timeout: 30_000 });
  await page.waitForFunction((cont) => {
    const drawer = document.querySelector('.cus-shipment-drawer');
    const head = Array.from(drawer?.querySelectorAll('strong') ?? []).some((el) => el.textContent.trim() === 'Chi tiết container');
    return head && drawer.textContent.includes(cont);
  }, { timeout: 30_000 }, CONT);
  log('DRAWER OPEN — Chi tiết container ledger visible');

  // ── BEFORE: the labeled danger button ────────────────────────────────────
  const btnState = await page.evaluate((cont) => {
    const btn = Array.from(document.querySelectorAll('.cus-shipment-drawer button'))
      .find((el) => el.getAttribute('aria-label') === `Xóa container ${cont}`);
    if (!btn) return null;
    return { label: btn.textContent.trim(), className: btn.className, disabled: btn.disabled, title: btn.title };
  }, CONT);
  if (!btnState) { log('FAIL: no Xóa container button for ' + CONT); process.exitCode = 1; throw new Error('missing button'); }
  if (!btnState.className.includes('btn--danger-outline')) { log(`FAIL: not danger-styled: ${btnState.className}`); process.exitCode = 1; }
  log(`BUTTON OK: label="${btnState.label}" class="${btnState.className}" disabled=${btnState.disabled} title="${btnState.title}"`);

  const drawerEl = await page.$('.cus-shipment-drawer');
  await drawerEl.screenshot({ path: `${DIR}/ui-1-drawer-before.png` });
  log('SCREENSHOT ui-1-drawer-before.png');

  // ── Confirm dialog names the number; API must NOT fire yet ──────────────
  await page.evaluate((cont) => {
    const btn = Array.from(document.querySelectorAll('.cus-shipment-drawer button'))
      .find((el) => el.getAttribute('aria-label') === `Xóa container ${cont}`);
    btn.click();
  }, CONT);
  await page.waitForSelector('.confirm-box', { timeout: 15_000 });
  const confirmText = await page.$eval('.confirm-box .confirm-message', (el) => el.textContent.trim());
  if (confirmText !== `Xóa container ${CONT}?`) { log(`FAIL: confirm message "${confirmText}"`); process.exitCode = 1; }
  if (removePosts !== 0) { log(`FAIL: remove API fired before confirm (${removePosts})`); process.exitCode = 1; }
  const confirmBtn = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.confirm-box button')).find((el) => el.textContent.trim() === 'Xóa container');
    return btn ? { label: btn.textContent.trim(), className: btn.className } : null;
  });
  if (!confirmBtn) { log('FAIL: no danger confirm button in dialog'); process.exitCode = 1; }
  log(`CONFIRM DIALOG OK: message="${confirmText}" confirmBtn="${confirmBtn?.label}" class="${confirmBtn?.className}" removePosts=${removePosts}`);
  await sleep(350); // let the dialog entrance animation settle for the shot
  await page.screenshot({ path: `${DIR}/ui-2-confirm.png` });
  log('SCREENSHOT ui-2-confirm.png');

  // ── Confirm → remove → drawer closes → list reflects the removal ────────
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.confirm-box button')).find((el) => el.textContent.trim() === 'Xóa container');
    btn.click();
  });
  for (let waited = 0; waited < 20_000 && removePosts === 0; waited += 200) await sleep(200);
  log(`REMOVE POST done: count=${removePosts} status=${removeStatus}`);
  if (removeStatus !== 200) { log(`FAIL: remove status ${removeStatus}`); process.exitCode = 1; }

  await page.waitForFunction(() => !document.querySelector('.cus-shipment-drawer'), { timeout: 20_000 });
  log('DRAWER CLOSED after confirmed remove (CUS-10 acceptance)');
  await page.waitForFunction((cont) => document.body.innerText.includes(`Đã xóa container ${cont}`), { timeout: 10_000 }, CONT)
    .then(() => log('TOAST OK: Đã xóa container ' + CONT))
    .catch(() => log('NOTE: success toast not captured (may have expired)'));
  await page.screenshot({ path: `${DIR}/ui-3-after-delete-list.png` });
  log('SCREENSHOT ui-3-after-delete-list.png');
  // The list refresh rides onLineSaved(null) (card 071026100800 contract).
  // When the search term IS the deleted cont, the refreshed list legitimately
  // drops to ZERO rows ("Không có lô hàng phù hợp") — the cont is gone from
  // the list entirely; otherwise the row chip drops its count.
  await page.waitForFunction((before) => {
    const btns = document.querySelectorAll('button[aria-label^="Mở chi tiết lô hàng"]');
    if (btns.length === 0) return document.body.innerText.includes('Không có lô hàng phù hợp');
    const text = (btns[0].closest('tr')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return text !== '' && text !== before;
  }, { timeout: 20_000, polling: 250 }, rowTextBefore).catch(() => {});
  const rowCountAfter = await page.evaluate(() => document.querySelectorAll('button[aria-label^="Mở chi tiết lô hàng"]').length);
  log(`LIST AFTER: ${rowCountAfter} row(s) for the deleted cont's search (0 = cont gone from list)`);

  // ── Re-open the drawer on a SURVIVING cont: the deleted one is gone ──────
  const remain = process.env.QA_CONT_REMAIN;
  if (remain) {
    const input = await page.$('input[aria-label="Tìm lô hàng"]');
    await input.click({ clickCount: 3 });
    await page.type('input[aria-label="Tìm lô hàng"]', remain, { delay: 40 });
    await page.waitForFunction((c) => (
      document.querySelectorAll('button[aria-label^="Mở chi tiết lô hàng"]').length === 1
    ), { timeout: 30_000, polling: 250 }, remain);
  } else {
    await page.waitForFunction(() => (
      document.querySelectorAll('button[aria-label^="Mở chi tiết lô hàng"]').length >= 1
    ), { timeout: 30_000, polling: 250 });
  }
  await page.evaluate(() => {
    document.querySelectorAll('button[aria-label^="Mở chi tiết lô hàng"]')[0].click();
  });
  await page.waitForSelector('.cus-shipment-drawer', { timeout: 30_000 });
  await page.waitForFunction(() => {
    const drawer = document.querySelector('.cus-shipment-drawer');
    return Array.from(drawer?.querySelectorAll('strong') ?? []).some((el) => el.textContent.trim() === 'Chi tiết container');
  }, { timeout: 30_000 });
  await sleep(600);
  const after = await page.evaluate((cont) => {
    const drawer = document.querySelector('.cus-shipment-drawer');
    const rows = Array.from(drawer.querySelectorAll('.cus-container-row')).filter((el) => drawer.innerText.includes(el.textContent));
    return {
      contCountCell: drawer.querySelector('.cus-container-ledger__head span')?.textContent?.trim() ?? '',
      deletedStillVisible: drawer.textContent.includes(cont),
      rowTexts: Array.from(drawer.querySelectorAll('.cus-container-row strong[id^="cus-drawer-detail-container-"]')).map((el) => el.textContent.trim()),
    };
  }, CONT);
  log(`AFTER RE-OPEN: head="${after.contCountCell}" deletedStillVisible=${after.deletedStillVisible} rows=[${after.rowTexts.join(', ')}]`);
  if (after.deletedStillVisible) { log(`FAIL: ${CONT} still rendered after delete`); process.exitCode = 1; }
  const drawerEl2 = await page.$('.cus-shipment-drawer');
  await drawerEl2.screenshot({ path: `${DIR}/ui-4-drawer-after-reopen.png` });
  log('SCREENSHOT ui-4-drawer-after-reopen.png');

  if (pageErrors.length) { log(`PAGE ERRORS: ${pageErrors.join(' | ')}`); process.exitCode = 1; }
  log(process.exitCode === 1 ? 'DRIVER FINISHED WITH FAILURES' : 'DRIVER OK');
} catch (err) {
  log(`DRIVER ERROR: ${err}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
