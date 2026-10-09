// v15 — capture the 500 body from the browser context.
import { launch, login, step, evidenceDir, BASE } from './lead-qa-harness.mjs';
const dir = evidenceDir('20261008-leadqa-final');
const log = `${dir}/driver-v15.log`;
const { browser, page } = await launch();
page.on('response', async (r) => {
  if (r.url().includes('/api/vat-config')) {
    let body = '';
    try { body = (await r.text()).slice(0, 300); } catch {}
    step(log, { step: 'vat-resp', status: r.status(), body });
  }
});
await login(page, 'admin');
await page.goto(`${BASE}/admin-center`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));
await browser.close();
step(log, { step: 'DONE' });
