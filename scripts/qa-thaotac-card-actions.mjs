#!/usr/bin/env node
/**
 * UI driver — Thao tác card actions share one 50/50 row (case
 * testplan/cases/case-2026-10-16-thaotac-card-action-row.md).
 *
 * Drives /shipments-detail as admin at 390 / 768 (card mode) and 1440
 * (desktop table) and, for every rendered add/remove pair:
 *   - card mode: both buttons on one row (tops equal), equal widths, each
 *     track = 50% of the wrapper (computed grid-template-columns is captured
 *     as direct evidence the @container rule won in the browser);
 *   - desktop: the pair stays stacked (tops differ) — the 7% column ladder
 *     is untouched.
 * Screenshots + measurements land under qa/ per AGENTS §7/§9.
 *
 * Usage: node scripts/qa-thaotac-card-actions.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { login } from "./lib/http.mjs";
import { withSession } from "./lib/ui-driver.mjs";

const FRONTEND = process.env.FRONTEND ?? "http://localhost:7175";
const USERNAME = process.env.DRIVER_USER ?? "admin";
const DATE_TAG = "2026-10-16_thaotac-card-actions";
const WIDTHS = [390, 768, 1440];
// The page defaults to today's transport window; local data lives on
// 2026-10-01 (7 container rows — verified by psql before the drive).
const PAGE_URL = `${FRONTEND}/shipments-detail?transportDateFrom=2026-10-01&transportDateTo=2026-10-01`;

const log = [];
const note = (s) => { console.log(s); log.push(s); };
let failures = 0;
const check = (ok, label) => {
  note(`  ${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) failures += 1;
};

mkdirSync("qa", { recursive: true });

const token = await login(USERNAME);
note(`login ${USERNAME}: ok (jwt ${token ? token.slice(0, 12) + "…" : "MISSING"})`);

await withSession(token, async (page) => {
  const apiStatuses = [];

  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 844 });
    const responses = [];
    const onResponse = (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) responses.push(`${r.status()} ${u.pathname}${u.search}`); };
    page.on("response", onResponse);
    await page.goto(PAGE_URL, { waitUntil: "networkidle2", timeout: 45000 });

    const pair = await page.waitForSelector(".shipment-container-ledger__row-actions", { timeout: 20000 })
      .then((h) => h.asElement())
      .catch(() => null);
    if (!pair) {
      note(`${width}px: no .shipment-container-ledger__row-actions rendered (role lacks mutate grant or no rows)`);
      for (const s of responses.slice(0, 10)) note(`    api: ${s}`);
      failures += 1;
      page.off("response", onResponse);
      continue;
    }
    apiStatuses.push(...responses.filter((r) => r.includes("shipment")).slice(0, 6));

    const measures = await page.evaluate(() => {
      const wrappers = [...document.querySelectorAll(".shipment-container-ledger__row-actions")].slice(0, 3);
      return wrappers.map((w) => {
        const wr = w.getBoundingClientRect();
        const buttons = [...w.querySelectorAll("button.btn")].map((b) => {
          const r = b.getBoundingClientRect();
          return { text: b.textContent.trim(), top: r.top, left: r.left, width: r.width, height: r.height };
        });
        const cs = getComputedStyle(w);
        return {
          wrapperWidth: wr.width,
          display: cs.display,
          gridTracks: cs.gridTemplateColumns,
          columnGap: parseFloat(cs.columnGap) || 0,
          buttons,
        };
      });
    });

    note(`${width}px: ${measures.length} pair wrapper(s) measured`);
    for (const [i, m] of measures.entries()) {
      note(`  wrapper#${i}: width=${m.wrapperWidth.toFixed(1)} display=${m.display} tracks=[${m.gridTracks}]`);
      const [a, b] = m.buttons;
      if (!a || !b) { check(false, `wrapper#${i} expected 2 buttons, got ${m.buttons.length}`); continue; }
      note(`  wrapper#${i}: [${a.text}] top=${a.top.toFixed(1)} w=${a.width.toFixed(1)} | [${b.text}] top=${b.top.toFixed(1)} w=${b.width.toFixed(1)}`);
      if (width < 1440) {
        const tracks = m.gridTracks.split(" ").map(parseFloat).filter((n) => !Number.isNaN(n));
        const trackOk = tracks.length === 2 && Math.abs(tracks[0] - tracks[1]) <= 1.5;
        check(trackOk, `wrapper#${i} two equal tracks (tracks=[${m.gridTracks}])`);
        check(Math.abs(a.top - b.top) <= 1.5, `wrapper#${i} same row (|Δtop|=${Math.abs(a.top - b.top).toFixed(2)})`);
        check(Math.abs(a.width - b.width) <= 1.5, `wrapper#${i} equal widths (|Δw|=${Math.abs(a.width - b.width).toFixed(2)})`);
        check(Math.abs(a.width - tracks[0]) <= 1.5 && Math.abs(tracks[0] + m.columnGap + tracks[1] - m.wrapperWidth) <= 2,
          `wrapper#${i} buttons fill 50/50 tracks (w=${a.width.toFixed(1)} track=${tracks[0]} gap=${m.columnGap} wrapper=${m.wrapperWidth.toFixed(1)})`);
      } else {
        check(a.top !== b.top, `wrapper#${i} desktop stays stacked (tops ${a.top.toFixed(1)} vs ${b.top.toFixed(1)})`);
      }
    }

    await page.screenshot({ path: `qa/${DATE_TAG}_ui-${width}.png`, fullPage: true });
    note(`${width}px: screenshot qa/${DATE_TAG}_ui-${width}.png`);

    if (width === 390) {
      // Real-control drive: the pair's primary action still opens the
      // add-container row form from its new 50/50 seat, and toggles closed.
      const [addBtn] = await page.$$(".shipment-container-ledger__row-actions button.btn");
      await addBtn.click();
      const form = await page.waitForSelector('[data-testid="add-container-form"]', { timeout: 10000 })
        .then((h) => h.asElement())
        .catch(() => null);
      check(form != null, "＋ Thêm click opens the add-container row form");
      const formText = form ? await page.evaluate((el) => el.textContent.slice(0, 120), form) : "";
      note(`  add-form text: ${formText.replace(/\s+/g, " ").slice(0, 100)}`);
      await page.screenshot({ path: `qa/${DATE_TAG}_ui-390-addform.png` });
      const [addBtn2] = await page.$$(".shipment-container-ledger__row-actions button.btn");
      await addBtn2.click();
      const closed = await page.waitForSelector('[data-testid="add-container-form"]', { hidden: true, timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      check(closed, "＋ Thêm click again closes the form (toggle intact)");
    }
    page.off("response", onResponse);
  }

  // The owner's capture shows no Ghi chú band — the empty-notes auto-hide
  // (column-visibility.ts) was active in their session, which spans the Thao
  // tác cell across the FULL card width. Reproduce that exact variant.
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("cus-containers-hidden-cols", JSON.stringify(["notes"]));
  });
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(PAGE_URL, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector(".shipment-container-ledger__row-actions", { timeout: 20000 });
  const wideCell = await page.evaluate(() => {
    const wrappers = [...document.querySelectorAll(".shipment-container-ledger__row-actions")].slice(0, 3);
    return wrappers.map((w) => {
      const wr = w.getBoundingClientRect();
      const cs = getComputedStyle(w);
      const buttons = [...w.querySelectorAll("button.btn")].map((b) => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent.trim(), top: r.top, width: r.width };
      });
      return { wrapperWidth: wr.width, gridTracks: cs.gridTemplateColumns, columnGap: parseFloat(cs.columnGap) || 0, buttons, cellLabel: w.closest("td")?.getAttribute("data-label") };
    });
  });
  note(`390px notes-hidden (owner's variant): ${wideCell.length} pair wrapper(s)`);
  for (const [i, m] of wideCell.entries()) {
    const [a, b] = m.buttons;
    if (!a || !b) { check(false, `notes-hidden wrapper#${i} expected 2 buttons`); continue; }
    const tracks = m.gridTracks.split(" ").map(parseFloat).filter((n) => !Number.isNaN(n));
    note(`  wrapper#${i}: cell=${m.cellLabel} width=${m.wrapperWidth.toFixed(1)} tracks=[${m.gridTracks}] [${a.text}] w=${a.width.toFixed(1)} | [${b.text}] w=${b.width.toFixed(1)}`);
    check(Math.abs(a.top - b.top) <= 1.5, `notes-hidden wrapper#${i} same row`);
    check(tracks.length === 2 && Math.abs(tracks[0] - tracks[1]) <= 1.5, `notes-hidden wrapper#${i} 50/50 tracks (tracks=[${m.gridTracks}])`);
  }
  await page.screenshot({ path: `qa/${DATE_TAG}_ui-390-notes-hidden.png`, fullPage: true });
  note(`390px notes-hidden: screenshot qa/${DATE_TAG}_ui-390-notes-hidden.png`);

  note("shipment API responses seen during drive:");
  for (const s of [...new Set(apiStatuses)].slice(0, 8)) note(`    ${s}`);

  // Data identity for the §9 DB cross-check: the bill/booking code + container
  // number of the first data row, so the psql before/after can name its rows.
  const identity = await page.evaluate(() => {
    const row = document.querySelector(".shipment-container-ledger tbody tr");
    return {
      bill: row?.querySelector(".shipment-container-ledger__code")?.textContent?.trim() ?? null,
      container: row?.querySelector('td[data-label="Thông số container"] strong')?.textContent?.trim() ?? null,
    };
  });
  note(`first row identity: bill=${identity.bill} container=${identity.container}`);
  writeFileSync(`qa/${DATE_TAG}_identity.json`, JSON.stringify(identity, null, 2));
}, { viewport: { width: 390, height: 844 }, name: `${DATE_TAG}_session` });

note(failures === 0 ? "RESULT: ALL CHECKS PASSED" : `RESULT: ${failures} CHECK(S) FAILED`);
writeFileSync(`qa/${DATE_TAG}_ui-driver.log`, log.join("\n") + "\n");
process.exit(failures === 0 ? 0 : 1);
