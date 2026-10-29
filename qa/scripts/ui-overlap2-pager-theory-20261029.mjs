// SIL-572 theory test — reproduce QA's kebab-vs-pager geometry by simulating
// a pane whose max-height applies but whose overflow clipping fails.
import puppeteer from 'puppeteer';

const FE = process.env.QA_BASE_URL || 'http://localhost:7291';
const browser = await puppeteer.launch({ headless: 'new' });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 768, height: 800 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'dieuvan');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1200));
  await page.goto(`${FE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1800));

  const measure = () => page.evaluate(() => {
    const pager = [...document.querySelectorAll('.ds-pagination__btn')].find((b) => b.getAttribute('aria-label') === 'Trang sau');
    const pr = pager?.getBoundingClientRect();
    const hits = [];
    for (const t of document.querySelectorAll('.detailed-plan-grid .dispatch-row-menu__trigger')) {
      const r = t.getBoundingClientRect();
      const ix = Math.min(r.right, pr?.right ?? -1) - Math.max(r.left, pr?.left ?? -1);
      const iy = Math.min(r.bottom, pr?.bottom ?? -1) - Math.max(r.top, pr?.top ?? -1);
      if (pr && ix > 0.5 && iy > 0.5) {
        const row = t.closest('tr');
        hits.push({ ix: +ix.toFixed(1), iy: +iy.toFixed(1), row: row?.cells[1]?.textContent.trim().slice(0, 20) });
      }
    }
    return hits;
  });

  // Break ONLY the clipping while keeping max-height (QA-environment theory).
  await page.evaluate(() => {
    const w = document.querySelector('.detailed-plan-grid__wrapper');
    w.style.overflow = 'visible';
    w.scrollTop = 0;
  });
  await new Promise((r) => setTimeout(r, 400));
  console.log('overflow-broken @rest page1:', JSON.stringify(await measure()));
  // scroll the PAGE (window) like QA ("cuộn hết" the page, not the pane)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise((r) => setTimeout(r, 400));
  console.log('overflow-broken @page-bottom:', JSON.stringify(await measure()));
  await page.evaluate(() => window.scrollTo(0, 600));
  await new Promise((r) => setTimeout(r, 400));
  console.log('overflow-broken @page-mid:', JSON.stringify(await measure()));
} finally { await browser.close(); }
