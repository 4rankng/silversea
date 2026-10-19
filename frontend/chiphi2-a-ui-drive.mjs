/* Card 191026160000 UI drive — the three changed surfaces on the local stack
 * (frontend :7175 → backend :3002, dev Postgres :5441):
 *   1. OPS form (Kế hoạch làm hàng → Khai chi phí): two fee blocks, Số Cont
 *      multi-select with chọn-all, OPTIONAL photo — save with NO photo.
 *   2. Thêm khoản chi drawer (phoi-phieu → Xem chi tiết → ＋ Thêm dòng):
 *      the two type tabs + the type's own sub-table + tick → Lưu duyệt.
 *   3. BÁO CÁO THU / TRẢ PHƠI: tabs, party drill-down, batch phiếu bar.
 * Auth: JWT pre-injected via evaluateOnNewDocument (puppeteer-spa-auth).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '../node_modules/.pnpm/puppeteer-core@25.1.0/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOK = (u) => fs.readFileSync(`/private/var/folders/8j/qs8k8y3n1hlfbl4q20k0hgjh0000gn/T/opencode/tok_${u}.txt`, 'utf8').trim();
const BASE = 'http://localhost:7175';
const QA_DIR = path.resolve(__dirname, '../qa');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const STAMP = '2026-10-19_chiphi2-a';

const log = (...a) => console.log('[c191026]', ...a);

async function newPage(browser, token) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((jwt) => {
    localStorage.setItem('token', jwt);
  }, token);
  return page;
}

async function clickButtonByText(page, text, { exact = false } = {}) {
  const handle = await page.evaluateHandle((needle, isExact) => {
    const accName = (el) => {
      const labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) return labelledby.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
      return el.getAttribute('aria-label') || el.textContent || '';
    };
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find(b => {
      const t = (accName(b) || '').replace(/\s+/g, ' ').trim();
      return isExact ? t === needle : t.includes(needle);
    }) || null;
  }, text, exact);
  const el = handle.asElement();
  if (!el) throw new Error(`button not found: ${text}`);
  await el.click();
  return el;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(QA_DIR, `${STAMP}_${name}.png`) });

const driverLog = [];

function note(step, detail) {
  driverLog.push(`${step}: ${detail}`);
  log(step, detail);
}

async function main() {
  fs.mkdirSync(QA_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', protocolTimeout: 240000,
    args: ['--window-size=1480,940', '--disable-features=Translate'],
  });
  try {
    // ── 1. OPS form — Kế hoạch làm hàng ──────────────────────────────────
    const opsPage = await newPage(browser, TOK('giaonhan'));
    await opsPage.goto(`${BASE}/ops/orders`, { waitUntil: 'domcontentloaded' });
    await opsPage.waitForFunction(() => Array.from(document.querySelectorAll('button'))
      .some(b => (b.textContent || '').includes('Khai chi phí')), { timeout: 180000 });
    await sleep(800);
    await clickButtonByText(opsPage, 'Khai chi phí');
    await opsPage.waitForSelector('.ops-modal', { timeout: 15000 });
    await sleep(800);
    const blocksOk = await opsPage.evaluate(() => ({
      noInvoice: Boolean(Array.from(document.querySelectorAll('section')).find(s => s.getAttribute('aria-label') === 'Phí không hóa đơn')),
      invoice: Boolean(Array.from(document.querySelectorAll('section')).find(s => s.getAttribute('aria-label') === 'Phí có hóa đơn')),
      addBtns: Array.from(document.querySelectorAll('button')).filter(b => b.textContent?.includes('Thêm chi phí')).length,
      chooseAll: Boolean(document.querySelector('input[aria-label="Chọn tất cả số cont"]')),
      photoHead: Boolean(Array.from(document.querySelectorAll('.ops-form-photos__head span')).find(s => s.textContent?.includes('Ảnh biên lai'))),
      noDebtLabel: !document.body.textContent.includes('Nợ chứng từ'),
      dateDefault: (document.querySelector('input[data-date-input]') || {}).value || '',
    }));
    note('ops-form', JSON.stringify(blocksOk));
    await shot(opsPage, 'ops-form-blocks');
    // Chọn tất cả containers
    await opsPage.click('input[aria-label="Chọn tất cả số cont"]');
    await sleep(300);
    const contState = await opsPage.evaluate(() => {
      const trigger = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label')?.includes('số cont'));
      return { label: trigger?.getAttribute('aria-label') || '', title: trigger?.getAttribute('title') || '' };
    });
    note('ops-cont-all', JSON.stringify(contState));
    await shot(opsPage, 'ops-form-cont-all');

    // Save an invoice-block fee with NO photo: add row in Phí có hóa đơn.
    const added = await opsPage.evaluate(() => {
      const section = Array.from(document.querySelectorAll('section')).find(s => s.getAttribute('aria-label') === 'Phí có hóa đơn');
      if (!section) return 'no-section';
      const btn = Array.from(section.querySelectorAll('button')).find(b => b.textContent?.includes('Thêm chi phí'));
      if (!btn) return `no-btn:${section.textContent.slice(0, 80)}`;
      btn.click();
      return 'added';
    });
    if (added !== 'added') throw new Error(`invoice add failed: ${added}`);
    await sleep(500);
    // Open the invoice block's Loại phí trigger (label→control association)
    // and pick the first real option.
    await opsPage.evaluate(() => {
      const section = Array.from(document.querySelectorAll('section')).find(s => s.getAttribute('aria-label') === 'Phí có hóa đơn');
      const label = Array.from(section.querySelectorAll('label')).find(l => (l.textContent || '').trim().startsWith('Loại phí'));
      const control = label ? (label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector('input, button')) : null;
      if (!control) throw new Error('no Loại phí control in invoice block');
      control.focus(); control.click();
    });
    await sleep(600);
    await opsPage.evaluate(() => {
      const option = Array.from(document.querySelectorAll('[role="option"]')).find(o => o.textContent?.trim() && !o.textContent.includes('Chọn loại phí'));
      option?.click();
    });
    await sleep(500);
    const amountHandle = await opsPage.evaluateHandle(() => {
      const section = Array.from(document.querySelectorAll('section')).find(s => s.getAttribute('aria-label') === 'Phí có hóa đơn');
      const label = Array.from(section.querySelectorAll('label')).find(l => (l.textContent || '').includes('Thực chi'));
      return label ? (label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector('input')) : null;
    });
    const amountInput = amountHandle.asElement();
    if (!amountInput) throw new Error('no amount input in invoice block');
    await amountInput.click({ clickCount: 3 });
    await opsPage.keyboard.type('190000');
    await sleep(500);
    await shot(opsPage, 'ops-form-filled');
    const savedOps = await opsPage.evaluate(() => {
      const save = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Lưu');
      if (save && !save.disabled) { save.click(); return 'clicked'; }
      return `disabled:${save?.getAttribute('disabled')}`;
    });
    note('ops-form-save', savedOps);
    const posts = [];
    opsPage.on('response', async (res) => {
      if (res.url().includes('/ops/expenses') && res.request().method() === 'POST') {
        posts.push(`${res.status()}`);
      }
    });
    await sleep(4000);
    // A duplicate bounce is a QUESTION panel, not a failure: continue through it.
    const dup = await opsPage.evaluate(() => document.body.textContent.includes('NHẬP TRƯỚC ĐÓ'));
    if (dup) {
      note('ops-form-dup', 'duplicate panel shown → Tiếp tục lưu');
      await shot(opsPage, 'ops-form-duplicate-panel');
      await clickButtonByText(opsPage, 'Tiếp tục lưu');
      await sleep(3000);
    }
    const toastText = await opsPage.evaluate(() => document.body.textContent.includes('Đã ghi nhận') ? 'toast-ok' : 'no-toast');
    const modalGone = await opsPage.evaluate(() => !document.querySelector('.ops-modal'));
    const alertText = await opsPage.evaluate(() => Array.from(document.querySelectorAll('[role="alert"]')).map(a => a.textContent?.slice(0, 80)).join(' | '));
    const toastBox = await opsPage.evaluate(() => document.querySelector('.toast-container')?.textContent?.slice(0, 120) || '');
    note('ops-form-after', `posts=${posts.join(',')} toast=${toastText} modalGone=${modalGone} alerts=${alertText} toastBox=${toastBox}`);
    await shot(opsPage, 'ops-form-saved');
    await opsPage.close();

    // ── 2. phoi-phieu: Tiền đường detail → Thêm dòng drawer ─────────────
    const page = await newPage(browser, TOK('ketoan'));
    await page.goto(`${BASE}/accounting/phoi-phieu`, { waitUntil: 'domcontentloaded' });
    // Polling works where waitForSelector's DOM resolution starves on this
    // heavy page (300-row board under the dev bundle).
    for (let waited = 0; waited < 480000; waited += 5000) {
      const found = await page.evaluate(() => Boolean(document.querySelector('.ppc-board'))).catch(() => false);
      if (found) break;
      await sleep(5000);
    }
    await sleep(4000);
    await shot(page, 'board');
    // Open the first Tiền đường detail (Xem chi tiết in the money column).
    await page.evaluate(() => {
      const cell = document.querySelector('.ppc-col--money');
      const btn = Array.from(cell.querySelectorAll('button')).find(b => b.textContent?.includes('Xem chi tiết'));
      btn?.click();
    });
    await sleep(1000);
    const tienDuongOpen = await page.evaluate(() => Boolean(document.querySelector('.phoi-detail-body')));
    note('tien-duong-dialog', `open=${tienDuongOpen}`);
    // ＋ Thêm dòng opens the drawer with the tabs + sub-table.
    await clickButtonByText(page, 'Thêm dòng');
    await sleep(1500);
    const drawerState = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"], .expense-group-tab')).map(t => t.textContent?.trim());
      const table = document.querySelector('.expense-existing-table');
      const rows = table ? Array.from(table.querySelectorAll('tbody tr')).length : 0;
      const bar = document.querySelector('.expense-existing-bar')?.textContent || '';
      return { tabs, rows, bar: bar.slice(0, 120) };
    });
    note('add-drawer', JSON.stringify(drawerState));
    await shot(page, 'drawer-type-tabs-subtable');
    // Tick the first unconfirmed row and Lưu duyệt (real confirm side effect).
    const ticked = await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('.expense-existing-table input[type="checkbox"]'));
      const row = boxes.find(b => !b.disabled);
      if (row) { row.click(); return true; }
      return false;
    });
    await sleep(300);
    if (ticked) {
      await shot(page, 'drawer-ticked');
      const approve = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('.expense-existing-bar button')).find(b => b.textContent?.includes('Lưu duyệt'));
        if (btn && !btn.disabled) { btn.click(); return 'clicked'; }
        return `disabled`;
      });
      note('drawer-approve', approve);
      await sleep(2000);
      await shot(page, 'drawer-approved');
    } else {
      note('drawer-approve', 'no tickable row in fixture');
    }
    // Close drawer + dialog.
    await clickButtonByText(page, 'Đóng');
    await sleep(500);
    await page.keyboard.press('Escape');
    await sleep(500);

    // ── 3. BÁO CÁO THU / TRẢ PHƠI ────────────────────────────────────────
    await page.evaluate(() => document.querySelector('.ppc-report-controls')?.scrollIntoView({ block: 'start' }));
    await sleep(600);
    const reportState = await page.evaluate(() => ({
      title: Boolean(Array.from(document.querySelectorAll('h2')).find(h => h.textContent === 'BÁO CÁO THU / TRẢ PHƠI')),
      tabs: Array.from(document.querySelectorAll('.ppc-report-tab')).map(t => t.textContent?.trim()),
      partyButtons: Array.from(document.querySelectorAll('.ppc-report__party-link')).length,
    }));
    note('report', JSON.stringify(reportState));
    await shot(page, 'report-section');
    // Drill into the first party.
    await page.evaluate(() => document.querySelector('.ppc-report__party-link')?.click());
    await sleep(2500);
    const drillState = await page.evaluate(() => {
      const drawer = Array.from(document.querySelectorAll('.drawer__title')).find(h => h.textContent?.includes('Lô chưa thanh toán'));
      const table = document.querySelector('.ppc-lots-drawer table');
      const rows = table ? Array.from(table.querySelectorAll('tbody tr')).length : 0;
      const bar = document.querySelector('.ppc-lots-bar')?.textContent || '';
      return { drawer: drawer?.textContent || '', rows, bar: bar.slice(0, 120) };
    });
    note('report-drill', JSON.stringify(drillState));
    await shot(page, 'report-drilldown');
    // Tick all + choose STK + issue the batch phiếu thu.
    const tickAll = await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('.ppc-lots-drawer input[type="checkbox"]'));
      const all = boxes[0];
      if (all && !all.checked) { all.click(); return 'ticked-all'; }
      return boxes.length > 1 ? 'already' : 'no-rows';
    });
    await sleep(400);
    note('report-tickall', tickAll);
    await page.evaluate(() => {
      const bar = document.querySelector('.ppc-lots-bar');
      const trigger = Array.from(bar.querySelectorAll('button')).find(b => (b.getAttribute('aria-label') || '').includes('STK'));
      trigger?.click();
    });
    await sleep(800);
    await page.evaluate(() => {
      const option = Array.from(document.querySelectorAll('[role="option"]')).find(o => o.textContent?.includes(' - ') && !o.textContent.includes('Chọn STK'));
      option?.click();
    });
    await sleep(600);
    await shot(page, 'report-batch-bar');
    const issue = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.ppc-lots-bar button')).find(b => b.textContent?.includes('Lập phiếu thu'));
      if (btn && !btn.disabled) { btn.click(); return 'clicked'; }
      return `disabled:${btn?.getAttribute('title') || ''}`;
    });
    note('report-issue', issue);
    await sleep(3000);
    const issueMsg = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll('p')).find(x => x.textContent?.includes('Đã lập phiếu'));
      return p?.textContent || document.body.textContent.includes('Đã lập phiếu') ? (p?.textContent || 'body-flag') : 'none';
    });
    note('report-issue-msg', issueMsg.slice(0, 120));
    await shot(page, 'report-issued');
    await page.close();

    fs.writeFileSync(path.join(QA_DIR, `${STAMP}_ui-driver.log`), driverLog.join('\n') + '\n');
    log('driver log written');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  fs.writeFileSync(path.join(QA_DIR, `${STAMP}_ui-driver.log`), driverLog.join('\n') + `\nFATAL: ${error}\n`);
  console.error(error);
  process.exit(1);
});
