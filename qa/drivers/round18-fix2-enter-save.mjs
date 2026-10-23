// Round-18 FIX 2 rung: drive Enter-to-save in the CUS quick-edit modal (FB-002).
// Artifacts: screenshot after Enter, DOM toast assertion, DB/API side-effect proof.
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} failed ${res.status}`);
  return (await res.json()).token;
};

const apiGet = async (token, path) => {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
};

const run = async () => {
  const token = await login('cus');
  const browser = await puppeteer.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('table tbody tr', { timeout: 30000 });

  // Seeded lots may lack trade direction (documents editor shows guidance
  // only). Set Nhập through the classification quick-edit first — a real
  // user path — then the documents editor owns a Bill input.
  const clickQuickEdit = async (needle) => {
    for (const el of await page.$$('button')) {
      const name = await el.evaluate((node) => node.getAttribute('aria-label') || '');
      if (name.includes(needle)) {
        await el.evaluate((node) => { node.scrollIntoView({ block: 'center' }); node.click(); });
        return;
      }
    }
    throw new Error(`trigger not found: ${needle}`);
  };
  let opened = false;
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const name = await b.evaluate((el) => el.getAttribute('aria-label') || el.textContent || '');
    if (!name.includes('Sửa ô chứng từ')) continue;
    const lotName = name.replace('Sửa ô chứng từ ', '').trim();
    await b.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
    await page.waitForSelector('[role="dialog"]', { timeout: 2500 }).catch(() => {});
    const hasBill = await page.evaluate(() => Boolean([...document.querySelectorAll('[role="dialog"] label')].find((l) => l.textContent.includes('Số Bill'))?.querySelector('input')));
    if (hasBill) { opened = true; break; }
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 500));
    // Direction absent: set Nhập via the classification editor on THIS lot.
    await clickQuickEdit(`Sửa ô phân loại và hãng tàu ${lotName}`);
    await page.waitForSelector('[role="dialog"] select', { timeout: 2500 });
    await page.select('[role="dialog"] select', 'IMPORT').catch(async () => {
      // UuiSelectField may render a native select; if select() missed, drive via change.
      await page.evaluate(() => {
        const select = document.querySelector('[role="dialog"] select');
        if (select) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          setter.call(select, 'IMPORT');
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
    await page.screenshot({ path: 'qa/2026-10-14_round18_fix2_ui-classification.png' });
    // Save the classification through the footer button.
    const saveBtn = await page.evaluateHandle(() => [...document.querySelectorAll('[role="dialog"] button')].find((el) => el.textContent.includes('Lưu thay đổi')));
    await saveBtn.asElement().evaluate((el) => el.click());
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 8000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    // Reopen documents on the same lot — the Bill input now exists.
    await clickQuickEdit(`Sửa ô chứng từ ${lotName}`);
    await page.waitForSelector('[role="dialog"] input', { timeout: 2500 });
    opened = true;
    break;
  }
  if (!opened) throw new Error('no editable documents quick-edit row with a Bill input found');
  await page.waitForSelector('[role="dialog"] input', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 600));

  const before = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const billLabel = [...dialog.querySelectorAll('label')].find((l) => l.textContent.includes('Số Bill'));
    const input = billLabel?.querySelector('input');
    return { billValue: input?.value ?? null, found: Boolean(input) };
  });
  if (!before.found) throw new Error('Số Bill input not present (direction unset on this lot)');
  const tokenSuffix = `ENT${Date.now().toString().slice(-6)}`;
  console.log('before Bill =', before.billValue);

  // Type a new Bill value and press Enter in the field.
  await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const billLabel = [...dialog.querySelectorAll('label')].find((l) => l.textContent.includes('Số Bill'));
    billLabel.querySelector('input').focus();
  });
  await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const input = [...dialog.querySelectorAll('label')].find((l) => l.textContent.includes('Số Bill')).querySelector('input');
    input.select();
  });
  await page.keyboard.type(`BILL-${tokenSuffix}`, { delay: 5 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 2500));

  const after = await page.evaluate(() => ({
    toast: document.body.textContent?.includes('Đã lưu ô dữ liệu lô hàng'),
    dialogOpen: Boolean(document.querySelector('[role="dialog"]')),
  }));
  console.log('after Enter: toastseen=', after.toast, 'dialogOpen=', after.dialogOpen);
  await page.screenshot({ path: 'qa/2026-10-14_round18_fix2_ui-enter-save.png', fullPage: false });

  // DB/API side-effect proof: the saved Bill must survive a reload.
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('table tbody tr', { timeout: 30000 });
  const rowText = await page.evaluate(() => document.querySelector('table')?.textContent ?? '');
  const persisted = rowText.includes(`BILL-${tokenSuffix}`);
  console.log('persisted after reload =', persisted, '(needle BILL-' + tokenSuffix + ')');
  console.log('exit: enter-save ' + (after.toast && persisted ? 'PASS' : 'FAIL'));
  await browser.close();
  process.exit(after.toast && persisted ? 0 : 1);
};

run().catch((e) => { console.error(e); process.exit(1); });
