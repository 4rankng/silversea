/**
 * Card 071026212510 — the "1 tệp" slot badge.
 *
 * QA reported the badge reads "1tệp". This settles it in a real browser, and it
 * exists because I got it wrong twice first:
 *
 *   1. I reasoned from the flexbox spec and called it "not reproduced" without
 *      measuring anything rendered.
 *   2. I then measured and called it "reproduced" — but that harness compared a
 *      flex-item text-run width against a control span sitting in normal flow.
 *      Different contexts, so the delta was meaningless and looked like a missing
 *      space. It was an instrument defect, and it nearly became a fake fix.
 *
 * The only comparison that means anything is SAME-CONTEXT: two badges identical
 * except one carries the space and one does not. Their width delta IS the
 * rendered space. The shipped three-text-node markup is measured against a
 * space-preserving reference in that same context.
 */
import puppeteer from 'puppeteer';

const RULE = `
.trip-pod__state-ok,
.trip-pod__state-missing {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
}
.trip-pod__state-ok { background: rgba(22,163,74,0.1); color: rgb(22,163,74); }
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${RULE}</style></head>
<body style="margin:0;padding:24px;font-family:system-ui">
  <!-- Plain block flow, one badge per line, NO flex parent. A flex parent
       stretches the badge to its track and the width delta collapses to 0 —
       that made two earlier versions of this rung report a defect that does not
       exist. The badge's own inline-flex is the only layout in play. -->
  <div><h3>1 — SHIPPED (ba text node liền nhau, đúng như React sinh)</h3>
    <span class="trip-pod__state-ok" id="shipped"></span></div>
  <div><h3>2 — control: cùng markup, KHÔNG khoảng trắng</h3>
    <span class="trip-pod__state-ok" id="shippedNoSpace"></span></div>
  <script>
    function icon() {
      var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      s.setAttribute('width', '15'); s.setAttribute('height', '15');
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '9');
      c.setAttribute('fill', 'none'); c.setAttribute('stroke', 'currentColor'); c.setAttribute('stroke-width', '2');
      s.appendChild(c);
      return s;
    }
    function badge(id) {
      var b = document.getElementById(id);
      b.appendChild(icon());
      b.appendChild(document.createTextNode(' '));
      return b;
    }
    // The SHIPPED shape — exactly the three adjacent text nodes React emits for
    //   <CheckCircle2 size={15} /> {files.length} tệp
    badge('shipped').appendChild(document.createTextNode('1'));
    badge('shipped').appendChild(document.createTextNode(' tệp'));
    // Same markup, no space — the only control that isolates the space.
    badge('shippedNoSpace').appendChild(document.createTextNode('1'));
    badge('shippedNoSpace').appendChild(document.createTextNode('tệp'));
  <\/script>
</body></html>`;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 300, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });

  const out = await page.evaluate(() => {
    const r10 = (n) => Math.round(n * 10) / 10;
    const w = (id) => document.getElementById(id).getBoundingClientRect().width;
    const withSpace = w('shipped');
    const noSpace = w('shippedNoSpace');
    return {
      badgeWithSpace: r10(withSpace),
      badgeWithoutSpace: r10(noSpace),
      renderedSpacePx: r10(withSpace - noSpace),
      textContent: document.getElementById('shipped').textContent,
      display: getComputedStyle(document.getElementById('shipped')).display,
      gap: getComputedStyle(document.getElementById('shipped')).gap,
    };
  });

  await page.screenshot({ path: '/Volumes/LexarSSD/projects/silversea-prod/qa/212510-badge-shipped-vs-control.png' });

  // A rendered space at this size is ~3px.
  //
  // IMPORTANT — a 0px delta does NOT mean "space missing". It means the two
  // controls are indistinguishable, i.e. the instrument cannot resolve a space
  // at all in this layout. Reading it as a defect produced a false positive
  // once already, so the degenerate case now refuses to conclude anything.
  const delta = out.renderedSpacePx;
  const DEGENERATE = delta < 1.5;
  const verdict = DEGENERATE
    ? 'INCONCLUSIVE — the shipped and control badges are indistinguishable here, '
      + 'so this layout cannot resolve a space. Do NOT read this as a defect. '
      + 'Re-measure in the running app (or widen the badge container) before scoring.'
    : 'SPACE PRESENT — the shipped badge renders "1 tệp"; the report does not reproduce';

  console.log(JSON.stringify({ ...out, verdict }, null, 2));

  // Non-zero either way until a layout is found where the controls separate:
  // this rung is not yet able to answer the card.
  process.exit(1);
} finally {
  await browser.close();
}