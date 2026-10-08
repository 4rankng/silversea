// Card 071026141600 — % cells wrap mid-number ("66.\n67%", "100\n%") and the
// last header clips ("…% NĂNG SUẤT C..") on /fleet/productivity monthly tab.
//
// Renders the REAL monthly table markup + the REAL stylesheet in a browser and
// measures, per cell, whether the value occupies more than one line box.
// exit 0 = pass, exit 1 = fail (wrapping reproduced).
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const css = readFileSync('frontend/src/pages/FleetProductivityPage.css', 'utf8');

// The real MonthlyProductivityView monthly table, with the worst values the
// card reported (66.67 / 33.33 / 100) plus a short one for contrast.
const rows = [
  { plate: '51A-11111', kep: 66.67, kethop: 33.33, layle: 100, don: 0 },
  { plate: '51A-22222', kep: 50, kethop: 0, layle: 12.5, don: 37.5 },
];
const pct = (v) => `${v}%`;
const table = `
<table class="fleet-productivity-table">
  <thead><tr>
    <th>STT</th><th>Biển số xe</th><th>Lái xe chính</th><th>Tổng số chuyến</th>
    <th>Kẹp ghép (2×20')</th><th>% Kẹp</th><th>Kết hợp (2 chiều)</th><th>% Kết hợp</th>
    <th>Lấy lẻ chuyển kho</th><th>% Lấy lẻ</th><th>Chuyến đơn</th><th>% Đơn</th>
    <th>% Năng suất cao</th>
  </tr></thead>
  <tbody>
  ${rows.map((r, i) => `<tr>
    <td>${i + 1}</td><td>${r.plate}</td><td>Chưa gán</td><td>6</td>
    <td>4</td><td><span class="fleet-badge fleet-badge--kep">${pct(r.kep)}</span></td>
    <td>2</td><td><span class="fleet-badge fleet-badge--kethop">${pct(r.kethop)}</span></td>
    <td>0</td><td><span class="fleet-badge fleet-badge--layle">${pct(r.layle)}</span></td>
    <td>0</td><td><span class="fleet-badge fleet-badge--don">${pct(r.don)}</span></td>
    <td class="fleet-pct" style="font-weight:700">${pct(r.kep)}</td>
  </tr>`).join('')}
  </tbody>
</table>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root { --text-sm: 13px; --bg-muted:#f4f4f5; --border-subtle:#e4e4e7;
          --color-base-100:#fff; --color-base-200:#fafafa; --color-base-300:#eee;
          --text-primary:#18181b; --text-secondary:#52525b; --text-muted:#a1a1aa;
          --color-primary:#059669; --color-info:#0284c7; --color-success:#16a34a;
          --color-warning:#d97706; --font-data: ui-monospace, monospace; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, sans-serif; background:#fafafa; }
  ${css}
</style></head><body>
<div class="fleet-productivity-table-wrap" id="tw" style="width: 1180px">${table}</div>
</body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(0);
const { port } = server.address();

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

const measure = async (w) => {
await page.setViewport({ width: w, height: 900 });
await page.reload({ waitUntil: 'load' });
return page.evaluate(() => {
  const out = { badges: [], plainPct: null, header: null, wrapScroll: null };
  // A mid-number break is detected from the TEXT node's own client rects, not
  // the cell box: the cell box carries 10px vertical padding on each side, so a
  // naive height / line-height division reports 2 lines for every single-line
  // cell. Range rects count the actual laid-out line boxes of the text.
  const textLineCount = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    return { lines: new Set(rects.map((r) => Math.round(r.top))).size, rects: rects.map((r) => ({ top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) })) };
  };
  for (const badge of document.querySelectorAll('.fleet-badge')) {
    const { lines, rects } = textLineCount(badge);
    out.badges.push({ text: badge.textContent.trim(), lines, wrapped: lines > 1, rects });
  }
  // The bold, un-badged final cell ("% Năng suất cao") is the wrap site the
  // card reported: "66." / "67%", "100" / "%".
  const lastCell = [...document.querySelectorAll('tbody td')].filter((td) => td.textContent.trim().endsWith('%') && !td.querySelector('.fleet-badge'))[0];
  if (lastCell) {
    const { lines, rects } = textLineCount(lastCell);
    out.plainPct = { text: lastCell.textContent.trim(), lines, wrapped: lines > 1, whiteSpace: getComputedStyle(lastCell).whiteSpace, rects };
  }
  const ths = [...document.querySelectorAll('thead th')];
  const lastTh = ths[ths.length - 1];
  const wrap = document.querySelector('.fleet-productivity-table-wrap');
  out.header = { text: lastTh.textContent.trim(), scrollW: lastTh.scrollWidth, clientW: lastTh.clientWidth, clipped: lastTh.scrollWidth > lastTh.clientWidth };
  out.wrapScroll = { scrollWidth: wrap.scrollWidth, clientWidth: wrap.clientWidth, overflows: wrap.scrollWidth > wrap.clientWidth };
  return out;
});
};
const results = {};
for (const w of [1440, 1280, 1180, 1024, 900, 820, 768]) results[w] = await measure(w);
const report = results[1440];

await browser.close();
server.close();

const wrapped = report.badges.filter((b) => b.wrapped);
const plainWrapped = report.plainPct && report.plainPct.wrapped;
console.log(JSON.stringify(report, null, 2));
console.log('\n=== VERDICT ===');
console.log(`badges measured: ${report.badges.length}, wrapped: ${wrapped.length}`);
if (wrapped.length) console.log('WRAPPED BADGES:', JSON.stringify(wrapped));
console.log(`plain % cell: ${plainWrapped ? 'WRAPPED' : 'ok'} ${JSON.stringify(report.plainPct)}`);
console.log(`header clipped within its own box: ${report.header.clipped}`);
console.log(`table horizontally overflows its wrap (=> header is off-screen, not clipped): ${report.wrapScroll.overflows} (${report.wrapScroll.scrollWidth} > ${report.wrapScroll.clientWidth})`);
console.log('\n=== PER-VIEWPORT ===');
for (const [w, r] of Object.entries(results)) {
  const wrappedBadges = r.badges.filter((b) => b.lines > 1);
  console.log(`${w}px -> pctTextLines=${r.plainPct?.lines} pctWrapped=${r.plainPct?.wrapped} whiteSpace=${r.plainPct?.whiteSpace} wrappedBadges=${wrappedBadges.length} headerClipped=${r.header.clipped}`);
}

if (wrapped.length || plainWrapped) { console.log('\nRESULT: FAIL — percentage cells wrap across lines'); process.exit(1); }
console.log('\nRESULT: PASS — no percentage cell wraps');