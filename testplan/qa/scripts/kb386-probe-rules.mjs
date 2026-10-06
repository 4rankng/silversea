// Card 386 rework — list EVERY loaded rule matching the money cells.
import puppeteer from 'puppeteer';
const BASE = 'https://vantai.tingting.vip';
const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await r.json()).token;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/accounting/invoice-tracking`, { waitUntil: 'networkidle2', timeout: 90000 });
await new Promise((res) => setTimeout(res, 6000));
const out = await page.evaluate(() => {
  const sheets = [...document.styleSheets].map((s) => (s.href || 'inline').split('/').pop());
  const cells = [...document.querySelectorAll('td.num')].slice(0, 3);
  const result = cells.map((td) => {
    const matches = [];
    for (const sheet of document.styleSheets) {
      const href = (sheet.href || 'inline').split('/').pop();
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (!rule.selectorText || !rule.style) continue;
        let m = false;
        try { m = td.matches(rule.selectorText); } catch { continue; }
        if (m && (rule.style.whiteSpace || rule.style.overflowWrap || rule.style.getPropertyValue('white-space'))) {
          matches.push({ sel: rule.selectorText, ws: rule.style.whiteSpace, ow: rule.style.overflowWrap, from: href });
        }
      }
    }
    return { label: td.getAttribute('data-label'), text: (td.textContent || '').trim().slice(0, 20), ws: getComputedStyle(td).whiteSpace, rules: matches };
  });
  return { sheets, cells: result };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
