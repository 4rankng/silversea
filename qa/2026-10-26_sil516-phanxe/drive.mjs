/**
 * SIL-516 UI drive — Chi tiết lô hàng (ShipmentContainersPage) cột PHÂN XE:
 *   (1) ô chọn "BKS thực" hiển thị full placeholder,
 *   (2) helper "BKS thực là biển số xe chạy thực tế của lô." wrap ngang,
 *   (3) nút "Lưu" nằm gọn trong cell,
 *   (4) cột TRẠNG THÁI không bị cắt ở right edge.
 * Cộng doctrine SIL-515 (card 20260922_37): scan mọi text node trong bảng —
 * không truncate/clip nào còn sót.
 *
 * Login local (testplan/testaccounts.txt), inject JWT BEFORE page load
 * (puppeteer-spa-auth law). READ-ONLY: driver chỉ MỞ editor (client state),
 * không bao giờ bấm Lưu — không mutate DB.
 *
 * Usage: node qa/2026-10-26_sil516-phanxe/drive.mjs <baseUrl> <tag>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:7175';
const TAG = process.argv[3] ?? 'before';
const API = 'http://localhost:3002/api';
const OUT = 'qa/2026-10-26_sil516-phanxe';
const WIDTHS = (process.env.WIDTHS ?? '1440,390').split(',').map(Number);
const BILL = process.env.BILL ?? 'R40B2-LCL03';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function tryLogin(username) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password: 'Abc123' }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.token ?? null;
}

let token = null;
let account = null;
for (const candidate of ['admin', 'phuongnt', 'dungnv', 'ketoan']) {
  token = await tryLogin(candidate);
  if (token) { account = candidate; break; }
}
if (!token) throw new Error('login failed for every candidate account');
console.log(`logged in as ${account}`);

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const report = { base: BASE, tag: TAG, account, bill: BILL, widths: {}, consoleErrors: [] };

try {
  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') report.consoleErrors.push(msg.text().slice(0, 200));
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  for (const width of WIDTHS) {
    const height = width <= 480 ? 844 : 1000;
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.goto(
      `${BASE}/shipments-detail?transportDateFrom=2026-10-01&transportDateTo=2026-10-31&searchSuffix=${encodeURIComponent(BILL)}`,
      { waitUntil: 'networkidle0', timeout: 45000 },
    );
    await page.waitForFunction(
      (bill) => document.body.innerText.includes(bill),
      { timeout: 20000 },
      BILL,
    );
    await new Promise((r) => setTimeout(r, 600));

    // ── closed state: table geometry + status-cell clipping + doctrine scan ──
    const closed = await page.evaluate((bill) => {
      const row = [...document.querySelectorAll('.shipment-container-ledger tbody tr')]
        .find((tr) => tr.textContent.includes(bill));
      const region = document.querySelector('.shipment-container-ledger');
      const table = region?.querySelector('table') ?? null;
      const statusTd = row?.querySelector('td[data-label="Trạng thái"]') ?? null;
      const statusBadge = statusTd?.querySelector('.shipment-container-ledger__dispatch-badge') ?? null;

      // Overlap check (SIL-515: no cell text may spill onto a neighbour):
      // every sort button must sit inside its own th. Card-mode hides the
      // thead as a screen-reader-only layer (1px clip) — not real headers.
      const headerOverflow = [...(region?.querySelectorAll('thead th') ?? [])].flatMap((th) => {
        const tr = th.getBoundingClientRect();
        if (tr.width <= 2 && tr.height <= 2) return [];
        const btn = th.querySelector('.table-sort-button');
        const b = btn ? btn.getBoundingClientRect() : null;
        const spills = (b ? (b.right > tr.right + 0.5 || b.left < tr.left - 0.5) : false)
          || th.scrollWidth > th.clientWidth + 1;
        return spills
          ? [{ label: th.textContent.trim().slice(0, 24), btnRight: b ? +b.right.toFixed(1) : null, thRight: +tr.right.toFixed(1), thScrollW: th.scrollWidth, thClientW: th.clientWidth }]
          : [];
      });

      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: +r.left.toFixed(1), right: +r.right.toFixed(1), top: +r.top.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) };
      };
      const overflowXOf = (el) => (el ? getComputedStyle(el).overflowX : null);

      // Doctrine scan (SIL-515 / card 20260922_37): every text-bearing element
      // inside the ledger table that ELLIPSIZES or CLIPS its own text.
      // Screen-reader-only layers (caption, __edit-purpose, card-mode hidden
      // thead) are clipped BY DESIGN (clip-path inset(50%)) — not data text.
      const clipped = [];
      if (region) {
        for (const el of region.querySelectorAll('table *')) {
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (!own) continue;
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const srOnly = cs.clipPath === 'inset(50%)' || (r.width <= 1 && r.height <= 1);
          if (srOnly) continue;
          const ellipsis = cs.textOverflow === 'ellipsis';
          const hides = (cs.overflowX === 'hidden' || cs.overflowX === 'clip');
          const clipsNow = el.scrollWidth > el.clientWidth + 1 && hides;
          if (ellipsis || clipsNow) {
            clipped.push({
              tag: el.tagName.toLowerCase(),
              cls: String(el.className).slice(0, 70),
              text: el.textContent.trim().slice(0, 50),
              ellipsis,
              clipsNow,
              scrollW: el.scrollWidth,
              clientW: el.clientWidth,
            });
          }
        }
      }

      return {
        rowFound: !!row,
        regionScroll: region ? { scrollW: region.scrollWidth, clientW: region.clientWidth, overflowsX: region.scrollWidth > region.clientWidth + 1 } : null,
        tableScroll: table ? { scrollW: table.scrollWidth, clientW: table.clientWidth, overflowsX: table.scrollWidth > table.clientWidth + 1 } : null,
        docScroll: { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, overflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 },
        status: {
          td: rect(statusTd),
          badge: rect(statusBadge),
          badgeText: statusBadge?.textContent.trim() ?? null,
          badgeOverflowX: overflowXOf(statusBadge),
          badgeClipsOwnText: statusBadge ? (statusBadge.scrollWidth > statusBadge.clientWidth + 1) : null,
          cutAtViewportEdge: statusBadge ? (statusBadge.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5) : null,
          cutAtRegionEdge: statusBadge && region
            ? (statusBadge.getBoundingClientRect().right > region.getBoundingClientRect().right + 0.5)
            : null,
        },
        doctrineClipped: clipped,
        headerOverflow,
      };
    }, BILL);

    // ── open the BKS thực plate editor (client-side only — never saves) ──
    const actionClicked = await page.evaluate((bill) => {
      const row = [...document.querySelectorAll('.shipment-container-ledger tbody tr')]
        .find((tr) => tr.textContent.includes(bill));
      const btn = row?.querySelector('button[aria-label*="BKS thực"]');
      if (!btn) return null;
      btn.scrollIntoView({ block: 'center', behavior: 'instant' });
      const label = btn.getAttribute('aria-label');
      btn.click();
      return label;
    }, BILL);
    if (!actionClicked) throw new Error(`no BKS thực action button on row ${BILL} @${width}`);
    await page.waitForFunction(
      (bill) => {
        const row = [...document.querySelectorAll('.shipment-container-ledger tbody tr')]
          .find((tr) => tr.textContent.includes(bill));
        return !!row?.querySelector('.shipment-container-ledger__inline-editor');
      },
      { timeout: 15000 },
      BILL,
    );
    await new Promise((r) => setTimeout(r, 400));

    const editor = await page.evaluate((bill) => {
      const row = [...document.querySelectorAll('.shipment-container-ledger tbody tr')]
        .find((tr) => tr.textContent.includes(bill));
      const vehicleTd = row?.querySelector('td[data-label="Phân xe"]') ?? null;
      const card = row?.querySelector('.shipment-container-ledger__inline-editor') ?? null;
      const trigger = card?.querySelector('.uui-combobox') ?? card?.querySelector('.searchable-select__trigger') ?? null;
      const saveBtn = card?.querySelector('button[aria-label^="Lưu"]') ?? null;
      const cancelBtn = card?.querySelector('button[aria-label^="Hủy"]') ?? null;

      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: +r.left.toFixed(1), right: +r.right.toFixed(1), top: +r.top.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) };
      };

      const phFits = (() => {
        // The plate editor's selector is the UUI combobox (uui-combobox) —
        // its visible placeholder is the overlay input's placeholder text,
        // clipped by the input box when the cell is too narrow.
        const input = card?.querySelector('.uui-combobox input') ?? card?.querySelector('input') ?? null;
        if (!input) return null;
        const cs = getComputedStyle(input);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = cs.font || `${cs.fontSize} ${cs.fontFamily}`;
        const textW = ctx.measureText(input.placeholder || '').width;
        const avail = input.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
        return {
          text: input.placeholder,
          textWidthPx: +textW.toFixed(1),
          inputClientW: input.clientWidth,
          availablePx: +avail.toFixed(1),
          truncated: textW > avail + 0.5,
          rect: rect(input),
        };
      })();

      const helperInfo = (() => {
        const helper = card?.querySelector('.shipment-container-ledger__editor-grid small')
          ?? card?.querySelector('.shipment-container-ledger__editor-footer small')
          ?? null;
        if (!helper) return null;
        const cs = getComputedStyle(helper);
        const lh = parseFloat(cs.lineHeight) || 16;
        const r = helper.getBoundingClientRect();
        return {
          text: helper.textContent.trim(),
          rect: rect(helper),
          lineHeight: +lh.toFixed(1),
          approxLines: Math.round(r.height / lh),
          verticalCharWrap: r.width < 32 || (r.height / lh) > 8,
          overflowWrap: cs.overflowWrap,
          wordBreak: cs.wordBreak,
          whiteSpace: cs.whiteSpace,
        };
      })();

      const tdRect = rect(vehicleTd);
      const saveRect = rect(saveBtn);
      const insideCell = tdRect && saveRect
        ? (saveRect.right <= tdRect.right + 0.5 && saveRect.left >= tdRect.left - 0.5)
        : null;

      return {
        action: null,
        td: tdRect,
        card: rect(card),
        trigger: rect(trigger),
        placeholder: phFits,
        helper: helperInfo,
        save: {
          rect: saveRect,
          text: saveBtn?.textContent.trim() ?? null,
          insideCell,
          overflowRightPx: tdRect && saveRect ? +(saveRect.right - tdRect.right).toFixed(1) : null,
          overflowLeftPx: tdRect && saveRect ? +(tdRect.left - saveRect.left).toFixed(1) : null,
        },
        cancelText: cancelBtn?.textContent.trim() ?? null,
      };
    }, BILL);
    editor.action = actionClicked;

    report.widths[width] = { closed, editor };

    // screenshots: closed row + editor open
    await page.screenshot({ path: `${OUT}/sil516_${TAG}_${width}_ui-phanxe-editor.png`, fullPage: false });
    await page.evaluate((bill) => {
      const row = [...document.querySelectorAll('.shipment-container-ledger tbody tr')]
        .find((tr) => tr.textContent.includes(bill));
      row?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, BILL);
    await new Promise((r) => setTimeout(r, 250));
    await page.screenshot({ path: `${OUT}/sil516_${TAG}_${width}_ui-phanxe-editor-centered.png`, fullPage: false });

    // close the editor again (Hủy — client state only) before the next width
    await page.evaluate((bill) => {
      const row = [...document.querySelectorAll('.shipment-container-ledger tbody tr')]
        .find((tr) => tr.textContent.includes(bill));
      const cancel = row?.querySelector('.shipment-container-ledger__inline-editor button[aria-label^="Hủy"]');
      cancel?.click();
    }, BILL);
    await new Promise((r) => setTimeout(r, 350));
    await page.screenshot({ path: `${OUT}/sil516_${TAG}_${width}_ui-phanxe-closed.png`, fullPage: false });
  }

  writeFileSync(`${OUT}/sil516_${TAG}_report.json`, JSON.stringify(report, null, 2));
  console.log(`report written: ${OUT}/sil516_${TAG}_report.json`);

  // console verdict for the driver log
  for (const width of WIDTHS) {
    const w = report.widths[width];
    console.log(`\n== ${width}px (${TAG}) ==`);
    console.log('  placeholder:', JSON.stringify(w.editor.placeholder));
    console.log('  helper     :', w.editor.helper ? `w=${w.editor.helper.rect.width} lines=${w.editor.helper.approxLines} verticalCharWrap=${w.editor.helper.verticalCharWrap}` : null);
    console.log('  save       :', w.editor.save ? `insideCell=${w.editor.save.insideCell} overflowRightPx=${w.editor.save.overflowRightPx}` : null);
    console.log('  status     :', `cutAtViewportEdge=${w.closed.status.cutAtViewportEdge} cutAtRegionEdge=${w.closed.status.cutAtRegionEdge} badgeClipsOwnText=${w.closed.status.badgeClipsOwnText}`);
    console.log('  overflow   :', `doc=${w.closed.docScroll.overflowsX} region=${w.closed.regionScroll?.overflowsX} table=${w.closed.tableScroll?.overflowsX}`);
    console.log('  doctrineClipped:', w.closed.doctrineClipped.length, w.closed.doctrineClipped.map((c) => `${c.cls || c.tag}:${c.text.slice(0, 24)}`).join(' | '));
    console.log('  headerOverflow :', w.closed.headerOverflow.length, JSON.stringify(w.closed.headerOverflow));
  }
} finally {
  await browser.close();
}
