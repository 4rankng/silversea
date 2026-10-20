// FB-066 card 201026101600 — dispatch detailed-plan editor rung:
// open /dispatch-detail as DISPATCHER → click a row's "Sửa" → in the
// "Chỉnh sửa điều phối" modal pick Nhà xe = "Xe nhà" (OWN) → the
// "+ Thêm nhanh" quick-add (opens "Thêm nhanh biển số xe") must render next
// to "Xe / biển số". Then also pick an EXTERNAL carrier and re-assert.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-regressions');
fs.mkdirSync(OUT, { recursive: true });
const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  const body = await res.json();
  if (!res.ok) throw new Error(`login: ${res.status}`);
  return body.token;
};

const stateOfDialog = (page) => page.evaluate(() => {
  const dlg = document.querySelector('[role=dialog]');
  if (!dlg) return { dialogOpen: false };
  const head = dlg.querySelector('.dispatch-assignment-dialog__vehicle-head');
  const quickAdd = head?.querySelector('.dispatch-assignment-dialog__quick-add');
  return {
    dialogOpen: true,
    title: dlg.querySelector('[class*=title], h2, h3')?.textContent?.trim()?.slice(0, 60) ?? null,
    headText: head?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    quickAddRendered: !!quickAdd,
    quickAddVisible: !!quickAdd && quickAdd.offsetParent !== null,
    quickAddText: quickAdd?.textContent?.trim() ?? null,
  };
});

const pickCarrierOption = async (page, match) => {
  const box = await page.$('[role=dialog] .dispatch-assignment-dialog__carrier [role=combobox], [role=dialog] .dispatch-assignment-dialog__carrier button');
  if (!box) { log('carrier-box-missing'); return null; }
  await box.click();
  await sleep(800);
  const opt = await page.evaluateHandle((m) => {
    const opts = [...document.querySelectorAll('[role=option]')];
    return opts.find((o) => o.textContent.includes(m)) || null;
  }, match);
  const el = opt.asElement();
  if (!el) { log('carrier-option-missing', { match }); return null; }
  const txt = await el.evaluate((n) => n.textContent.trim());
  await el.click();
  await sleep(1200);
  return txt;
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const token = await login('dieuvan');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(9000);

  const editButtons = await page.$$('[aria-label^="Sửa ô điều phối"], .dispatch-assignment-cell__trigger');
  log('grid-ready', { editButtons: editButtons.length });
  if (editButtons.length === 0) throw new Error('no Sửa trigger rendered');

  await editButtons[0].click();
  await sleep(1200);
  log('dialog-opened', await stateOfDialog(page));
  await page.screenshot({ path: path.join(OUT, 'fb066-before-dialog-initial.png') });

  // Pick OWN carrier "Xe nhà".
  const picked = await pickCarrierOption(page, 'Xe nhà');
  if (picked) {
    log('after-own-pick', { picked, ...(await stateOfDialog(page)) });
    await page.screenshot({ path: path.join(OUT, 'fb066-before-dialog-own.png') });

    // If the quick-add exists, click it — the QuickAddVehicleDialog must open
    // ("Thêm nhanh biển số xe").
    const clicked = await page.evaluate(() => {
      const b = document.querySelector('[role=dialog] .dispatch-assignment-dialog__quick-add');
      if (!b) return false;
      b.click();
      return true;
    });
    await sleep(1000);
    if (clicked) {
      const second = await page.evaluate(() => {
        const dlgs = [...document.querySelectorAll('[role=dialog]')];
        return dlgs.map((d) => d.textContent?.replace(/\s+/g, ' ').trim().slice(0, 90));
      });
      log('quick-add-clicked', { dialogs: second });
      await page.screenshot({ path: path.join(OUT, 'fb066-before-quickadd-dialog.png') });
    }
  }
  log('run-complete');
} catch (err) {
  log('driver-error', { message: err.message });
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'fb066-dispatch-rung.log'), LOG.map((l) => JSON.stringify(l)).join('\n') + '\n');
  await browser.close();
}
