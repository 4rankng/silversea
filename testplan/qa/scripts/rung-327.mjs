// Rung 327: mobile bottom-fill on /shipments at 390x844 / 414x896 / 375x667 — real dataset, bottom-strip color probe.
// mutates: none
import { launch, shot, setViewport } from './lead-qa-lib.mjs';

const base = process.env.QA_BASE || 'http://localhost:7175';
const E = process.env.EVID_DIR;
const user = process.env.QA_USER || 'thanhdc';
const { browser, page } = await launch({ width: 390, height: 844 });
const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: user, password: 'Abc123' }),
});
const { token } = await res.json();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

for (const [w, h, tag] of [[390, 844, '390x844'], [414, 896, '414x896'], [375, 667, '375x667']]) {
  await setViewport(page, w, h);
  await page.goto(`${base}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3500));
  const state = await page.evaluate(() => {
    const body = document.querySelector('main.app-body') || document.body;
    const cs = getComputedStyle(document.documentElement);
    return {
      path: location.pathname,
      cards: document.querySelectorAll('[class*=card], [class*=record]').length,
      textHead: document.body.innerText.slice(60, 200).replace(/\n/g, ' | '),
      bg: cs.getPropertyValue('--bg').trim(),
      scrollH: body.scrollHeight,
      innerH: window.innerHeight,
    };
  });
  console.log('STATE', tag, JSON.stringify(state));
  await shot(page, `${E}/shipments-${tag}.png`, { full: true });
}
console.log('SHOTS done');
await browser.close();
