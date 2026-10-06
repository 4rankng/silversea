// Card 386 rework — READ-ONLY staging probe: what does the PROD build actually
// compute on the invoice-tracking money cells? No writes, no uploads.
import puppeteer from 'puppeteer';
const BASE = 'https://vantai.tingting.vip';
const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await r.json()).token;
console.log('login ok:', Boolean(token));
const health = await fetch(`${BASE}/api/health`).then((x) => x.json());
console.log('buildHash:', health.buildHash);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/accounting/invoice-tracking`, { waitUntil: 'networkidle2', timeout: 90000 });
await new Promise((res) => setTimeout(res, 6000));
const probe = await page.evaluate(() => {
  const sheets = [...document.styleSheets].map((s) => (s.href || 'inline').split('/').pop());
  const table = document.querySelector('table.record-table');
  const nums = [...document.querySelectorAll('td.num')].slice(0, 4).map((td) => {
    const cs = getComputedStyle(td);
    return {
      dataLabel: td.getAttribute('data-label'),
      text: (td.textContent || '').trim().slice(0, 30),
      cls: td.className,
      whiteSpace: cs.whiteSpace,
      overflowWrap: cs.overflowWrap,
      textAlign: cs.textAlign,
      display: cs.display,
      lineWidths: td.getClientRects().length,
    };
  });
  const subs = [...document.querySelectorAll('.ivt-stack__sub')].slice(0, 3).map((el) => {
    const cs = getComputedStyle(el);
    return { text: (el.textContent || '').trim().slice(0, 40), whiteSpace: cs.whiteSpace, overflowWrap: cs.overflowWrap, html: el.innerHTML.slice(0, 160) };
  });
  const stacks = [...document.querySelectorAll('.ivt-stack')].slice(0, 2).map((el) => el.outerHTML.slice(0, 300));
  // any rule for .record-table .num present in loaded sheets?
  let numRuleFound = false;
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText && rule.selectorText.includes('.num') && rule.style && rule.style.whiteSpace === 'nowrap') numRuleFound = true;
      }
    } catch {}
  }
  return { sheets, hasTable: Boolean(table), nums, subs, stacks, numRuleFound };
});
console.log(JSON.stringify(probe, null, 1));
await page.screenshot({ path: 'testplan/qa/evidence/2026-10-06_card386-rework/staging-probe-1440.png', fullPage: true });
await browser.close();
