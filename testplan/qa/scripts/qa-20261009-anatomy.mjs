import { launch, login, step, evidenceDir, BASE } from './lead-qa-harness.mjs';
const dir = evidenceDir('2026-10-09_round8-leadqa');
const log = `${dir}/driver-anatomy.log`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page } = await launch({ width: 1440, height: 900 });
await login(page, 'dungnv');
await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2500);
const anatomy = await page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.trim() === 'TEST-LCL-362');
  if (!el) return { found: false };
  const chain = [];
  let n = el;
  for (let i = 0; i < 6 && n; i++) { chain.push(`${n.tagName}.${(n.className || '').toString().slice(0, 40)}`); n = n.parentElement; }
  const row = el.closest('[role="row"], tr, [data-row]') || el.parentElement.parentElement;
  const links = [...row.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim().slice(0, 20) }));
  const buttons = [...row.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim().slice(0, 20), cls: (b.className || '').toString().slice(0, 30) }));
  return { found: true, chain, links, buttons };
});
step(log, { step: 'anatomy', ...anatomy });
console.log(JSON.stringify(anatomy, null, 1));
await browser.close();
