// v14 — network truth for the VAT card read failure.
import { launch, login, step, evidenceDir, BASE } from './lead-qa-harness.mjs';
const dir = evidenceDir('20261008-leadqa-final');
const log = `${dir}/driver-v14.log`;
const { browser, page } = await launch();
page.on('response', (r) => { if (r.url().match(/vat|config/i) || r.status() >= 400) step(log, { step: 'resp', status: r.status(), url: r.url().slice(-70) }); });
page.on('console', (m) => { if (m.type() === 'error') step(log, { step: 'console', text: m.text().slice(0, 200) }); });
await login(page, 'admin');
await page.goto(`${BASE}/admin-center`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));
const state = await page.evaluate(() => ({
  err: document.body.innerText.includes('Không đọc được thuế suất'),
  hasSelect: Boolean(document.querySelector('select')),
}));
step(log, { step: 'state', ...state });
await browser.close();
step(log, { step: 'DONE' });
