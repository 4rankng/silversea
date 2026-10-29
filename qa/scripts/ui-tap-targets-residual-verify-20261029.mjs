// SIL-583 residual verify (QA fail 29/10) — re-scan the audited clusters at
// 390/768/1440 after the 24px-floor residuals landed:
//   - every .date-seg / combobox typing overlay / .detailed-plan-grid__sort
//     bounding box ≥24px (WCAG 2.5.8 floor),
//   - the "Xem thêm" note-detail-trigger rule computes a real 28px min-height
//     (the bare-var bug voided it → QA measured 55×13).
// Baseline (pre-fix) inventory: qa/2026-10-29_sil583_sub24-baseline.log.
import puppeteer from 'puppeteer';
const FE = process.env.QA_BASE_URL || 'http://localhost:7202';
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 120000 });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
await page.type('input[name="username"]', 'dungnv');
await page.type('input[name="password"]', 'Abc123');
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
await new Promise((r) => setTimeout(r, 1500));

let fails = 0, checks = 0;
for (const width of [390, 768, 1440]) {
  await page.setViewport({ width, height: 1000 });
  for (const route of ['/dispatch-detail', '/shipments/new']) {
    await page.goto(`${FE}${route}`, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    const rows = await page.evaluate(() => {
      const out = [];
      const push = (el, kind) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || el.offsetParent == null) return;
        out.push({ kind, w: +r.width.toFixed(1), h: +r.height.toFixed(1) });
      };
      for (const el of document.querySelectorAll('.date-seg')) push(el, 'seg');
      for (const el of document.querySelectorAll("input[role='combobox']")) push(el, 'combo');
      for (const el of document.querySelectorAll('.detailed-plan-grid__sort')) push(el, 'sort');
      return out;
    });
    const bad = rows.filter((r) => r.w < 24 || r.h < 24);
    checks += rows.length; fails += bad.length;
    console.log(`@${width} ${route}: ${rows.length} measured, ${bad.length} under 24`, bad.slice(0, 6));
  }
}

await page.goto(`${FE}/dispatch`, { waitUntil: 'networkidle2' });
const computed = await page.evaluate(() => {
  const b = document.createElement('button');
  b.className = 'group relative inline-flex h-max cursor-pointer select-none items-center justify-center whitespace-nowrap master-plan-grid__note-detail-trigger';
  b.textContent = 'Xem thêm';
  document.body.appendChild(b);
  const cs = getComputedStyle(b);
  const r = b.getBoundingClientRect();
  const res = { minHeight: cs.minHeight, w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  b.remove();
  return res;
});
checks += 1;
const ok = computed.minHeight !== 'auto' && computed.h >= 24;
if (!ok) fails += 1;
console.log('note-detail-trigger computed:', JSON.stringify(computed), ok ? 'PASS' : 'FAIL');
await browser.close();
console.log(`TOTAL ${checks - fails}/${checks} PASS`);
if (fails) process.exit(1);
