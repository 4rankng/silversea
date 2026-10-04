// Rung 333: fetch-failure error branch on /config/factories — abort the list API in one run, expect Alert + Thử lại.
// mutates: none
import { launch, probe, shot, setViewport, withAborted } from './lead-qa-lib.mjs';

const base = process.env.QA_BASE || 'http://localhost:7175';
const E = process.env.EVID_DIR;
const { browser, page } = await launch({ width: 1440, height: 1000 });
const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
const { token } = await res.json();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

// failure state: abort the list fetch THROUGH the settle window (React Query retries included)
await withAborted(page, 'operational-sites/admin', async () => {
  await page.goto(`${base}/config/factories`, { waitUntil: 'networkidle2', timeout: 60000 });
}, { settleMs: 11000 });

const failState = await page.evaluate(() => ({
  hasErrorAlert: /Không thể tải danh sách nhà máy \/ kho/.test(document.body.innerText),
  hasRetry: /Thử lại/.test(document.body.innerText),
  zeroMuc: /0 mục/.test(document.body.innerText),
  trueEmptyCopy: /Chưa có nhà máy \/ kho nào/.test(document.body.innerText),
  head: document.body.innerText.slice(60, 260).replace(/\n/g, ' | '),
}));
console.log('FAIL_STATE', JSON.stringify(failState));

for (const [w, h] of [[1280, 900], [1440, 900], [1920, 1080], [2560, 1400]]) {
  await setViewport(page, w, h);
  await shot(page, `${E}/factories-error-${w}.png`, { full: true });
}
await setViewport(page, 390, 844);
await shot(page, `${E}/factories-error-390.png`, { full: true });
await setViewport(page, 1440, 900);

// retry tap (REAL pointer sequence at the hit-tested button center) → recovers once the abort is gone
const retryBox = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Thử lại');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
});
let retryClicked = false;
if (retryBox) {
  const hit = await page.evaluate((x, y) => {
    const e = document.elementFromPoint(x, y);
    return (e?.closest('button')?.innerText || '').trim();
  }, retryBox.cx, retryBox.cy);
  const before = await probe(page);
  await page.mouse.move(retryBox.cx, retryBox.cy);
  await page.mouse.down();
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 500));
  const after = await probe(page);
  retryClicked = after.any > before.any;
  console.log('RETRY_TAP', JSON.stringify({ hit, before, after }));
}
console.log('RETRY_CLICKED', retryClicked);
await new Promise((r) => setTimeout(r, 3500));
const recovered = await page.evaluate(() => ({
  hasErrorAlert: /Không thể tải danh sách nhà máy \/ kho/.test(document.body.innerText),
  muc: (document.body.innerText.match(/(\d+) mục/) || [])[0] || '',
}));
console.log('RECOVERED', JSON.stringify(recovered));
console.log('PROBE', JSON.stringify(await probe(page)));
await browser.close();
