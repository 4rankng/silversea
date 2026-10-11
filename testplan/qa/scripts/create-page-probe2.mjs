// Probe v2 — reproduce the two owner screenshots on staging /shipments/new.
// (1) MOBILE font census at 390 and 375 (DPR 3): find the ballooned font.
// (2) Drive the duplicate-reference warning: type a REAL existing Bill
//     number into the Số Bill field, capture the inline warning that appears
//     (the "message not data dense" surface). READ-ONLY — no submit.
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = '/Volumes/LexarSSD/projects/silversea-prod/qa/probe-create';
mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/probe2-driver.log`;
writeFileSync(LOG, '');
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(LOG, line + '\n');
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const token = (await login.json()).token;

// A real existing lot to duplicate against.
const list = await fetch(`${API}/shipments?limit=5`, { headers: { Authorization: `Bearer ${token}` } });
const lots = (await list.json()).items ?? (await list.json()).data ?? [];
const lot = lots.find((l) => l.billNumber || l.billNo || l.bill);
const existingRef = lot?.billNumber ?? lot?.billNo ?? lot?.bill;
step('existing-lot', { id: lot?.id, ref: existingRef });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  const census = () => page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = walker.nextNode())) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const ownText = [...n.childNodes]
        .filter((c) => c.nodeType === 3 && c.textContent.trim())
        .map((c) => c.textContent.trim()).join(' ').slice(0, 48);
      if (!ownText) continue;
      out.push({
        fs: parseFloat(cs.fontSize),
        sel: `${n.tagName.toLowerCase()}.${[...n.classList].slice(0, 2).join('.')}`,
        text: ownText,
      });
    }
    return out.sort((a, b) => b.fs - a.fs).slice(0, 24);
  });

  for (const [w, h, name] of [[390, 844, '390'], [375, 667, '375']]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 3 });
    await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 90000 })
      .catch(() => step('goto', { note: 'timeout — continue' }));
    await sleep(2000);
    const top = await census();
    step(`font-census-${name}`, { top: top.slice(0, 16) });
    await page.screenshot({ path: `${OUT}/10-create-${name}.png`, fullPage: true });
  }

  // Back to 390; find the Số Bill input and type the existing reference.
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
  const billInput = await page.evaluateHandle(() => {
    const inputs = [...document.querySelectorAll('input')];
    return inputs.find((i) => /số bill/i.test(i.closest('label, div, [class*="field"]')?.innerText || '')
      || /bill/i.test(i.name || i.id || i.placeholder || ''));
  });
  const bi = billInput?.asElement();
  step('bill-input-found', { found: Boolean(bi) });
  if (bi && existingRef) {
    await bi.scrollIntoView({ block: 'center' });
    await bi.click({ clickCount: 3 });
    await bi.type(String(existingRef), { delay: 40 });
    await sleep(3500); // duplicate guard debounce
    const warn = await page.evaluate(() => {
      const w = document.querySelector('.csc-field-warning, [class*="conflict"], [class*="warning"]');
      if (!w) return null;
      const r = w.getBoundingClientRect();
      return { text: w.innerText.slice(0, 400), w: r.width, h: r.height, html: w.outerHTML.slice(0, 600) };
    });
    step('duplicate-warning', warn ?? { found: false });
    await page.screenshot({ path: `${OUT}/11-duplicate-warning-390.png`, fullPage: true });
  }

  // Desktop duplicate-warning capture too (owner image was wide).
  await page.setViewport({ width: 1000, height: 450, deviceScaleFactor: 2 });
  await sleep(800);
  await page.screenshot({ path: `${OUT}/12-duplicate-warning-1000.png` });
  step('PROBE2', { verdict: 'DONE' });
} finally {
  await browser.close();
}
