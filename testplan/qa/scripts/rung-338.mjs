// Rung 338: wrap-render probes on mountable surfaces (tag-manager label, shipment doc-key) + best-effort others.
// mutates: none
import { launch, shot, setViewport } from '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/scripts/lead-qa-lib.mjs';

const base = process.env.QA_BASE || 'http://localhost:7175';
const E = process.env.EVID_DIR;
const { browser, page } = await launch({ width: 1440, height: 1000 });
const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) });
const { token } = await res.json();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

function probeWrap(sel) {
  return page.evaluate((s) => {
    const els = [...document.querySelectorAll(s)];
    const el = els.find((x) => x.getBoundingClientRect().height > 0);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      text: (el.innerText || el.textContent || '').slice(0, 60),
      whiteSpace: cs.whiteSpace,
      overflowWrap: cs.overflowWrap,
      textOverflow: cs.textOverflow,
      hasTitle: !!el.getAttribute('title'),
      fullHeight: Math.round(el.getBoundingClientRect().height),
    };
  }, sel);
}

// A2: dispatch editor → task tag manager popover
await page.goto(`${base}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));
const el = await page.$('button[aria-label^="Sửa ô điều phối"]');
if (el) {
  await el.click();
  await new Promise((r) => setTimeout(r, 1500));
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role=dialog] button')].find((x) => /tag|nhãn|gắn nhãn|thẻ/i.test((x.getAttribute('aria-label') || x.innerText || '').trim()));
    if (!b) return false;
    b.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 1200));
  console.log('TAG_MANAGER_OPEN', opened);
  console.log('WRAP_A2', JSON.stringify(await probeWrap('.dispatch-tag-manager__label')));
  await shot(page, `${E}/wrap-tag-manager-1440.png`, { full: false });
}

// B3: shipment detail drawer → doc-key
await page.goto(`${base}/shipments-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));
const rowBtn = await page.evaluate(() => {
  const b = [...document.querySelectorAll('tbody tr button, [class*=card] button')].find((x) => /Chi tiết|xem/i.test((x.getAttribute('aria-label') || x.innerText || '').trim()));
  if (!b) return false;
  b.click();
  return true;
});
await new Promise((r) => setTimeout(r, 2500));
console.log('DRAWER_OPEN', rowBtn);
console.log('WRAP_B3', JSON.stringify(await probeWrap('.shipment-detail__doc-key')));
await shot(page, `${E}/wrap-doc-key-1440.png`, { full: false });

// generic: any residual ellipsis+title on the mounted docs
const census = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('[title]')) {
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis') out.push({ cls: (el.className || '').toString().slice(0, 40), text: (el.textContent || '').slice(0, 30) });
  }
  return out.slice(0, 10);
});
console.log('REMAINING_ELLIPSIS_TITLE', JSON.stringify(census));
await setViewport(page, 390, 844);
await shot(page, `${E}/wrap-doc-key-390.png`, { full: false });
await browser.close();
