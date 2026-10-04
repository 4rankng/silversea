// Rung 322 phase 1: open allocation dialog with REAL input, dump structure.
import { launch, login, tap, probe, shot, domText } from './lead-qa-lib.mjs';

const E = process.env.EVID_DIR;
const { browser, page, base } = await launch({ width: 1440, height: 900 });
await login(page, base, 'dungnv');
await page.goto(`${base}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));

const trig = '.master-plan-grid tbody tr:nth-child(2) .master-plan-grid__allocation-trigger';
const tapResult = await tap(page, trig); // throws if no trusted events (rot)
console.log('TAP', JSON.stringify(tapResult));
await new Promise((r) => setTimeout(r, 1500));

const state = await page.evaluate(() => ({
  pop: !!document.querySelector('.dispatch-allocation-popover'),
  modals: [...document.querySelectorAll('[role=dialog],[role=popover]')].map((m) => m.className.toString().slice(0, 60)),
  dialogText: (document.querySelector('[role=dialog],[role=popover],.dispatch-allocation-popover') || {}).innerText?.slice(0, 600),
}));
console.log('STATE', JSON.stringify(state, null, 1));
if (state.pop || state.modals.length) {
  await shot(page, `${E}/dialog-1440-probe.png`, { full: false });
  console.log('SHOT saved');
}
console.log('PROBE', JSON.stringify(await probe(page)));
await browser.close();
