// Lead QA rung — the 09/10 LCL wave on staging build f04497ac:
//   FB-079 (180800): Quy cách đóng gói suggestions + free text
//   FB-078 (180700): LCL schedule hides the FCL container-vessel dates
//   FB-077 (180600): Thêm kho quick-add modal = 3 fields, no ĐVVH chrome
//   FB-080 (180900): post-create lands on the new lot's page
// Real pointer taps; one continuous intake flow at 390 (mobile intake) — the
// cards all live on the same screen, so one drive covers all four.
import { launch, step, evidenceDir, BASE } from './lead-qa-harness.mjs';

const dir = evidenceDir('2026-10-09_lcl-wave-rung');
const log = `${dir}/driver-lcl-wave.log`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `${dir}/${name}.png` });
const out = {};
let failures = 0;
const check = (name, ok, detail) => { out[name] = ok; if (!ok) failures++; step(log, { step: 'assert', name, ok, detail: detail ?? null }); };

const { browser, page } = await launch({ width: 390, height: 844 });

// UUI combobox inputs carry react-aria ids — resolve fields by their linked
// label text instead.
const byLabel = (page, labelText) => page.evaluateHandle((lt) => {
  const els = [...document.querySelectorAll('input[role="combobox"], input')];
  return els.find((el) => {
    const linked = el.getAttribute('aria-labelledby');
    const name = linked ? (document.getElementById(linked)?.textContent || '') : (el.getAttribute('aria-label') || el.placeholder || '');
    return name.includes(lt);
  }) ?? null;
}, labelText);

try {
  await page.goto(`${BASE}/api/health`, { waitUntil: 'networkidle2', timeout: 60000 });
  const buildHash = (await page.evaluate(() => document.body.innerText)).match(/"buildHash":"([^"]+)"/)?.[1];
  check('build-currency', buildHash === 'f04497ac', buildHash);

  const token = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) }).then((r) => r.json()).then((b) => b.token);
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(4000);

  // Customer combobox: open + pick the first option (LONG MINH).
  const customer = (await byLabel(page, 'Khách hàng')).asElement();
  if (customer) {
    await customer.click();
    await sleep(900);
    const opt = await page.evaluateHandle(() => [...document.querySelectorAll('[role="option"]')][0]);
    const optEl = opt.asElement();
    if (optEl) { await optEl.evaluate((n) => n.scrollIntoView({ block: 'center' })); await optEl.click(); await sleep(900); }
  }
  check('customer-picked', Boolean(customer), customer ? 'combobox found' : 'missing');

  // Direction IMPORT, a BL, then switch to Hàng lẻ.
  const bl = (await byLabel(page, 'Số Bill/Booking')).asElement();
  if (bl) { await bl.click(); await page.keyboard.type('FB-WAVE-1', { delay: 20 }); await sleep(300); }
  const importRadio = await page.evaluateHandle(() => { const cands = [...document.querySelectorAll('[role="radio"], input[type="radio"], label, button')]; return cands.find((n) => (n.textContent || '').trim().includes('Nhập khẩu')) ?? null; });
  const impEl = importRadio.asElement();
  if (impEl) { await impEl.click(); await sleep(700); }
  const lclRadio = await page.evaluateHandle(() => { const cands = [...document.querySelectorAll('[role="radio"], input[type="radio"], label, button')]; return cands.find((n) => (n.textContent || '').trim().includes('Hàng lẻ')) ?? null; });
  const lclEl = lclRadio.asElement();
  check('lcl-mode', Boolean(lclEl));
  if (lclEl) { await lclEl.evaluate((n) => n.scrollIntoView({ block: 'center' })); await lclEl.click(); await sleep(1200); }

  // ── FB-079: packaging suggestions ──────────────────────────────────────
  const pkg = (await byLabel(page, 'Quy cách đóng gói')).asElement();
  check('fb079-field', Boolean(pkg));
  if (pkg) {
    await pkg.evaluate((n) => n.scrollIntoView({ block: 'center' }));
    await pkg.click();
    await page.keyboard.type('Pal', { delay: 30 });
    await sleep(900);
    const pallet = await page.evaluateHandle(() => [...document.querySelectorAll('[role="option"]')].find((n) => (n.textContent || '').trim() === 'Pallet'));
    const palletEl = pallet.asElement();
    check('fb079-suggestion', Boolean(palletEl));
    // Atomic in-page tap: find + scroll + click in ONE evaluate so RAC's
    // listbox re-renders can't detach the node between steps.
    const tapped = await page.evaluate(() => {
      const o = [...document.querySelectorAll('[role="option"]')].find((n) => (n.textContent || '').trim() === 'Pallet');
      if (!o) return false;
      o.scrollIntoView({ block: 'center' });
      o.click();
      return true;
    });
    await sleep(800);
    step(log, { step: 'fb079-tap', tapped });
    const pkgVal = await page.evaluate(() => ((document.querySelectorAll('input[role=\"combobox\"]') && [...document.querySelectorAll('input')].find((el) => { const l = el.getAttribute('aria-labelledby'); const n = l ? (document.getElementById(l)?.textContent || '') : ''; return n.includes('Quy cách'); }) || {}).value));
    check('fb079-picked', pkgVal === 'Pallet', pkgVal);
    // free text through the same field (2026-09-06 guarantee)
    await pkg.click({ clickCount: 3 });
    await page.keyboard.type('Thùng nhựa riêng', { delay: 20 });
    await sleep(400);
    const pkgVal2 = await page.evaluate(() => ((document.querySelectorAll('input[role=\"combobox\"]') && [...document.querySelectorAll('input')].find((el) => { const l = el.getAttribute('aria-labelledby'); const n = l ? (document.getElementById(l)?.textContent || '') : ''; return n.includes('Quy cách'); }) || {}).value));
    check('fb079-freetext', String(pkgVal2).includes('Thùng nhựa riêng'), pkgVal2);
    await shot(page, 'wave-fb079');
  }

  // ── FB-078: schedule block field set ───────────────────────────────────
  const sched = await page.evaluate(() => ({
    customs: Boolean([...document.querySelectorAll('label, .field label')].find((n) => (n.textContent || '').includes('Hạn hoàn tất hải quan')) || document.querySelector('input[aria-label*="Hạn hoàn tất"]')),
    dropContainer: document.body.textContent.includes('Hạn hạ container tại cảng'),
    returnContainer: document.body.textContent.includes('Thời điểm trả container'),
    delivery: document.body.textContent.includes('Ngày giao dự kiến'),
  }));
  check('fb078-keeps-customs', sched.customs, JSON.stringify(sched));
  check('fb078-hides-drop', !sched.dropContainer);
  check('fb078-hides-return', !sched.returnContainer);
  check('fb078-keeps-delivery', sched.delivery);
  await shot(page, 'wave-fb078');

  // ── FB-077: quick-add warehouse modal ──────────────────────────────────
  const addKho = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Thêm kho'));
  const addKhoEl = addKho.asElement();
  check('fb077-trigger', Boolean(addKhoEl));
  if (addKhoEl) {
    await addKhoEl.evaluate((n) => n.scrollIntoView({ block: 'center' }));
    await sleep(200);
    await addKhoEl.click();
    await sleep(1300);
    const modal = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return { open: false };
      const t = dlg.textContent || '';
      const lbl = (s) => t.includes(s);
      return {
        open: true,
        title: t.includes('Thêm kho lấy hàng'),
        ten: lbl('Tên đầy đủ'), tenNgan: lbl('Tên ngắn'), diaChi: lbl('Địa chỉ'),
        ma: lbl('Mã điểm vận hành'), loai: lbl('Loại điểm'), lienHe: lbl('Liên hệ'), maps: lbl('Google Maps'),
      };
    });
    check('fb077-modal', modal.open && modal.title, JSON.stringify(modal));
    check('fb077-three-fields', modal.ten && modal.tenNgan && modal.diaChi);
    check('fb077-no-dvvh', !modal.ma && !modal.loai && !modal.lienHe && !modal.maps);
    await shot(page, 'wave-fb077-modal');
    // Fill + submit: creates a real staging warehouse (staging mutates freely).
    const name = await page.evaluateHandle(() => { const dlg = document.querySelector('[role="dialog"]'); return dlg ? [...dlg.querySelectorAll('input')].find((i) => (i.getAttribute('aria-label') || i.placeholder || '').includes('Tên đầy đủ')) : null; });
    const nameEl = name.asElement();
    if (nameEl) {
      await nameEl.click();
      await page.keyboard.type('Kho Rung FB-077', { delay: 15 });
    }
    const addr = await page.evaluateHandle(() => { const dlg = document.querySelector('[role="dialog"]'); return dlg ? [...dlg.querySelectorAll('input')].find((i) => (i.getAttribute('aria-label') || i.placeholder || '').includes('Số, đường') || (i.getAttribute('aria-label') || i.placeholder || '').includes('Địa chỉ')) : null; });
    const addrEl = addr.asElement();
    if (addrEl) { await addrEl.click(); await page.keyboard.type('1 Đường Rung, Dĩ An', { delay: 15 }); }
    await sleep(300);
    const save = await page.evaluateHandle(() => { const dlg = document.querySelector('[role="dialog"]'); return dlg ? [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Thêm kho') : null; });
    const saveEl = save.asElement();
    if (saveEl) { await saveEl.click(); await sleep(2200); }
    const modalGone = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
    check('fb077-created', modalGone);
    await shot(page, 'wave-fb077-after');
  }

  // ── FB-080: post-create landing ────────────────────────────────────────
  const create = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Tạo lô hàng'));
  const createEl = create.asElement();
  if (createEl) { await createEl.evaluate((n) => n.scrollIntoView({ block: 'center' })); await sleep(200); await createEl.click(); }
  await page.waitForFunction(() => /\/shipments\/\d+/.test(location.pathname), { timeout: 45000 }).catch(() => {});
  await sleep(3500);
  const landed = await page.evaluate(() => location.pathname);
  if (!/^\/shipments\/\d+$/.test(landed)) {
    const alert = await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent?.slice(0, 160) ?? null);
    step(log, { step: 'fb080-stuck', alert });
  }
  check('fb080-landing', /^\/shipments\/\d+$/.test(landed), landed);
  await shot(page, 'wave-fb080-landing');

  step(log, { step: 'DONE', verdict: failures === 0 ? 'PASS' : 'FAIL', failures, ...out });
  console.log(failures === 0 ? `PASS — all four cards verified on ${buildHash} (${JSON.stringify(out)})` : `FAIL ${failures}: ${JSON.stringify(out)}`);
  process.exit(failures === 0 ? 0 : 1);
} catch (err) {
  step(log, { step: 'error', error: String(err && err.message || err).slice(0, 220) });
  await shot(page, 'wave-error').catch(() => {});
  console.log('ERROR:', String(err && err.message || err).slice(0, 220));
  process.exit(2);
} finally {
  await browser.close();
}
