#!/usr/bin/node
/** SIL-846 — edit-form UI driver: prefill shows the persisted Trọng tải and a
 *  re-pick survives the save. Run: node testplan/qa/scripts/2026-11-16-sil846-ui-verify.mjs */
import { login, DEFAULT_FRONTEND, DEFAULT_BACKEND } from '../../../scripts/lib/http.mjs';
import { withSession, STANDARD_BROWSER_ARGS } from '../../../scripts/lib/ui-driver.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const DIR = 'qa/2026-11-16_sil846';
mkdirSync(DIR, { recursive: true });

const token = await login('admin', { backend: DEFAULT_BACKEND, frontend: DEFAULT_FRONTEND });
await withSession(token, async (page, ctx) => {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${DEFAULT_FRONTEND}/shipments/285/edit`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 2500));

  // 1. prefill: the Trọng tải trigger shows the persisted class (was empty pre-fix)
  const prefill = await page.evaluate(() => {
    const wrap = document.querySelector('[data-field-id="shipment-rev-vehicle-class"]');
    return { present: !!wrap, text: wrap?.textContent?.trim().slice(0, 60) ?? null, hasEmptyPlaceholder: (wrap?.textContent || '').includes('Chọn loại xe') };
  });
  console.log('prefill:', JSON.stringify(prefill));

  // 2. pick 'Xe 5T' in the SearchableField combobox
  await page.evaluate(() => {
    const wrap = document.querySelector('[data-field-id="shipment-rev-vehicle-class"]');
    const trigger = wrap?.querySelector('button, input, [role="combobox"], [class*="trigger"]');
    (trigger || wrap)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    (trigger || wrap)?.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  const picked = await page.evaluate(() => {
    const options = [...document.querySelectorAll('[role="option"], li, [class*="option"]')];
    const target = options.find((o) => (o.textContent || '').trim().startsWith('Xe 5 tấn'));
    if (target) { target.click(); return true; }
    return false;
  });
  await new Promise((r) => setTimeout(r, 400));
  console.log('picked Xe 5T:', picked);
  await page.screenshot({ path: `${DIR}/sil846-edit-picked.png` });

  // 3. save
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Lưu thay đổi'));
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 3500));
  const after = await page.evaluate(() => ({
    url: location.pathname,
    toast: (document.body.textContent.match(/Đã lưu[^.]*|Cập nhật[^.]*/) || [null])[0],
    bodyHas5T: (document.body.textContent || '').includes('Xe 5 tấn'),
  }));
  console.log('after save:', JSON.stringify(after));
  await page.screenshot({ path: `${DIR}/sil846-after-save.png` });

  const pass = prefill.present && !prefill.hasEmptyPlaceholder && picked && after.bodyHas5T;
  console.log(pass ? 'SIL-846 UI DRIVER PASS' : 'SIL-846 UI DRIVER FAIL');
  writeFileSync(`${DIR}/driver.log`, JSON.stringify({ prefill, picked, after }, null, 1));
  if (!pass) process.exitCode = 1;
  ctx.log.push(JSON.stringify({ prefill, picked, after }));
}, { viewport: { width: 1440, height: 900 }, args: STANDARD_BROWSER_ARGS, artifactDir: 'qa', name: '2026-11-16_sil846-edit' });
