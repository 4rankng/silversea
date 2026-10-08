// Rung 328: multi-declaration rows on /shipments/new (real taps/typing, draft-only — no submit).
// mutates: none
import { launch, probe, shot, setViewport } from './lead-qa-lib.mjs';

const base = process.env.QA_BASE || 'http://localhost:7175';
const E = process.env.EVID_DIR;
const { browser, page } = await launch({ width: 1440, height: 1000 });
const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const { token } = await res.json();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${base}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));

const state = await page.evaluate(() => ({
  declInputs: document.querySelectorAll('input[aria-label="Số tờ khai"], input[aria-label*="Số tờ khai"]').length,
  addBtn: [...document.querySelectorAll('button')].filter((b) => /Thêm tờ khai/i.test(b.innerText || b.getAttribute('aria-label') || '')).length,
  head: document.body.innerText.slice(60, 240).replace(/\n/g, ' | '),
}));
console.log('INITIAL', JSON.stringify(state));

// tap "+ Thêm tờ khai" twice → 3 rows
for (let k = 0; k < 2; k++) {
  const added = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Thêm tờ khai/i.test(x.innerText || x.getAttribute('aria-label') || ''));
    if (!b) return false;
    b.click();
    return true;
  });
  console.log('ADD_ROW', k, added);
  await new Promise((r) => setTimeout(r, 700));
}

const after = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input')].filter((i) => /Số tờ khai/.test(i.getAttribute('aria-label') || ''));
  return { declInputs: inputs.length, labels: inputs.map((i) => i.getAttribute('aria-label')) };
});
console.log('AFTER_ADDS', JSON.stringify(after));

// type three declaration numbers (real keys)
const inputs = await page.$$('input[aria-label*="Số tờ khai"]');
const nums = ['TK-2026-001', 'TK-2026-002', 'TK-2026-003'];
for (let i = 0; i < Math.min(inputs.length, 3); i++) {
  await inputs[i].click();
  await page.keyboard.type(nums[i], { delay: 25 });
}
await new Promise((r) => setTimeout(r, 600));
const filled = await page.evaluate(() => [...document.querySelectorAll('input')].filter((i) => /Số tờ khai/.test(i.getAttribute('aria-label') || '')).map((i) => i.value));
console.log('FILLED', JSON.stringify(filled));
console.log('PROBE', JSON.stringify(await probe(page)));

for (const [w, h] of [[1280, 900], [1440, 900], [1920, 1080], [2560, 1400]]) {
  await setViewport(page, w, h);
  await shot(page, `${E}/createform-${w}.png`, { full: true });
}
await setViewport(page, 1440, 900);
const cropState = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input')].filter((i) => {
    const aria = i.getAttribute('aria-label') || '';
    const lbl = (i.labels && i.labels[0] ? i.labels[0].innerText : '') || '';
    return /Số tờ khai/.test(aria) || /Số tờ khai/.test(lbl);
  });
  if (!inputs.length) return null;
  const first = inputs[0].getBoundingClientRect();
  const last = inputs[inputs.length - 1].getBoundingClientRect();
  return { x: first.x - 220, y: first.y - 40, width: first.width + 420, height: (last.bottom - first.y) + 80, count: inputs.length };
});
if (cropState) {
  console.log('CROP_STATE', JSON.stringify(cropState));
  await page.screenshot({ path: `${E}/decl-rows-crop.png`, clip: { x: Math.max(0, cropState.x), y: Math.max(0, cropState.y), width: cropState.width, height: cropState.height } });
} else {
  console.log('WARN: declaration inputs gone at crop time (re-render?) — skipping crop');
}
await setViewport(page, 390, 844);
await shot(page, `${E}/createform-390.png`, { full: true });
console.log('SHOTS done');
await browser.close();
