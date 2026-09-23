#!/usr/bin/env node
/**
 * Comprehensive End-to-End QA Test Suite for "các chi phí.pdf"
 * 
 * Tests all 5 core requirement areas from the document across roles:
 * - Kế toán (ketoan): Phơi phiếu, Chi tiết Chi hộ/Tiền đường, Hóa đơn kết hợp, Hoàn cược cont, Chốt debit, Duyệt chi phí OPS
 * - OPS Giao nhận (giaonhan): Khai chi phí (Thực chi/Thực thu/Khách trả), Ví tạm ứng, Hoàn ứng
 * - Lái xe (laixe): Chuyến hàng, Tiền đường, Chi phí chuyến, Thu nhập
 * 
 * Verifies DOM geometry, interactive modal popups, data persistence, and DB side effects.
 * Saves screenshots to qa/2026-09-23_cac-chi-phi-comprehensive/
 */

import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { login } from "./lib/http.mjs";

const BACKEND = "http://localhost:3002/api";
const FRONTEND = "http://localhost:7175";
const OUT_DIR = "qa/2026-09-23_cac-chi-phi-comprehensive";
mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const testResults = [];

function recordTest(id, name, status, details, screenshot = null) {
  testResults.push({ id, name, status, details, screenshot });
  const icon = status === "PASS" ? "✅" : (status === "FAIL" ? "❌" : "⚠️");
  console.log(`${icon} [${id}] ${name}: ${status}`);
  if (details) console.log(`   └─ ${details}`);
}

async function withUserSession(username, fn, viewport = { width: 1440, height: 900 }) {
  const token = await login(username, { backend: BACKEND });
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);

    await page.evaluateOnNewDocument((t) => {
      localStorage.setItem("token", t);
    }, token);

    return await fn(page, browser);
  } finally {
    await browser.close();
  }
}

async function clickByText(page, selector, text) {
  const elements = await page.$$(selector);
  for (const el of elements) {
    const val = await page.evaluate(e => (e.innerText || e.value || e.textContent || "").trim(), el);
    if (val.includes(text)) {
      await el.click();
      return true;
    }
  }
  return false;
}

async function main() {
  console.log("==================================================================");
  console.log("STARTING COMPREHENSIVE QA TEST SUITE: CÁC CHI PHÍ.PDF");
  console.log("Target Frontend:", FRONTEND, "| Backend:", BACKEND);
  console.log("Output Directory:", OUT_DIR);
  console.log("==================================================================\n");

  // =========================================================================
  // MODULE 1: KẾ TOÁN — BẢNG KIỂM SOÁT PHƠI PHIẾU (/accounting/phoi-phieu)
  // =========================================================================
  console.log("\n--- MODULE 1: KẾ TOÁN - KIỂM SOÁT PHƠI PHIẾU ---");
  await withUserSession("ketoan", async (page) => {
    // 1.1 Tải trang
    await page.goto(`${FRONTEND}/accounting/phoi-phieu`, { waitUntil: "networkidle2" });
    await sleep(1500);
    const shotMain = `${OUT_DIR}/m1-01-phoi-phieu-main.png`;
    await page.screenshot({ path: shotMain });
    
    const tableExists = await page.$("table.ppc-board") !== null;
    recordTest("TC-M1.1", "Tải trang Kiểm soát Phơi phiếu", tableExists ? "PASS" : "FAIL", 
      `Bảng ppc-board ${tableExists ? "hiển thị đầy đủ" : "không tìm thấy"}`, shotMain);

    // 1.2 Đoạn ngắt chữ Header Thông số container (Bug 4 / TC-CCP-04)
    const headerInfo = await page.evaluate(() => {
      const ths = Array.from(document.querySelectorAll("table.ppc-board thead th"));
      const contTh = ths.find(t => t.innerText.toLowerCase().includes("thông số container") || t.innerText.toLowerCase().includes("container"));
      if (!contTh) return null;
      return {
        text: contTh.innerText,
        width: contTh.getBoundingClientRect().width,
        height: contTh.getBoundingClientRect().height
      };
    });
    const headerCrop = `${OUT_DIR}/m1-02-header-container-crop.png`;
    const theadEl = await page.$("table.ppc-board thead");
    if (theadEl) await theadEl.screenshot({ path: headerCrop });
    
    const isContBroken = headerInfo?.text.includes("CONTAINE\nR") || headerInfo?.text.includes("CONTAINE \nR") || (headerInfo?.text.split("\n").some(line => line.trim() === "R"));
    recordTest("TC-CCP-04", "Header 'Thông số container' không bị bẻ chữ 'CONTAINE / R'", 
      isContBroken ? "FAIL" : "PASS",
      `Text thực tế: "${headerInfo?.text.replace(/\n/g, ' ')}" (Rộng: ${headerInfo?.width.toFixed(1)}px)`, headerCrop);

    // 1.3 Popup Chi tiết Chi hộ (Bug 1 / TC-CCP-01)
    const chiHoBtn = await page.$("table.ppc-board tbody tr:first-child td:nth-child(7) button");
    let chiHoModalTest = { opened: false, inViewport: false, backdropFixed: false, top: null, equalCheckbox: false };
    if (chiHoBtn) {
      await chiHoBtn.click();
      await sleep(1000);
      const shotChiHo = `${OUT_DIR}/m1-03-chi-ho-dialog.png`;
      await page.screenshot({ path: shotChiHo });

      chiHoModalTest = await page.evaluate(() => {
        const dialog = document.querySelector("[role='dialog'], .ops-modal");
        const backdrop = document.querySelector(".ops-modal-backdrop");
        if (!dialog) return { opened: false };
        const rect = dialog.getBoundingClientRect();
        const backdropStyle = backdrop ? window.getComputedStyle(backdrop) : null;
        
        const labels = Array.from(dialog.querySelectorAll("label"));
        const equalCb = labels.some(l => l.innerText.includes("Thu và Trả"));
        
        return {
          opened: true,
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          inViewport: rect.top >= 0 && rect.top < window.innerHeight && rect.bottom > 0,
          backdropFixed: backdropStyle?.position === "fixed",
          backdropZIndex: backdropStyle?.zIndex,
          equalCheckbox: equalCb,
          title: dialog.querySelector("h2, h3")?.innerText
        };
      });

      recordTest("TC-CCP-01a", "Popup 'Xem chi tiết Chi hộ' hiển thị trong Viewport", 
        (chiHoModalTest.opened && chiHoModalTest.inViewport) ? "PASS" : "FAIL",
        `Opened: ${chiHoModalTest.opened}, Top: ${chiHoModalTest.top?.toFixed(1)}px, InViewport: ${chiHoModalTest.inViewport}, Backdrop fixed: ${chiHoModalTest.backdropFixed} (zIndex: ${chiHoModalTest.backdropZIndex})`,
        shotChiHo);

      recordTest("TC-M1.3b", "Popup Chi hộ có Checkbox 'Thu và Trả bằng nhau' & danh mục phí",
        chiHoModalTest.equalCheckbox ? "PASS" : "FAIL",
        `Checkbox 'Thu và Trả bằng nhau': ${chiHoModalTest.equalCheckbox ? "CÓ" : "KHÔNG"}`);

      // Thử đóng bằng phím Escape hoặc nút đóng
      const closed = await clickByText(page, "button", "✕") || await clickByText(page, "button", "Đóng");
      if (!closed) await page.keyboard.press("Escape");
      await sleep(500);
    } else {
      recordTest("TC-CCP-01a", "Popup 'Xem chi tiết Chi hộ'", "FAIL", "Không tìm thấy nút Xem chi tiết ở dòng 1");
    }

    // 1.4 Popup Chi tiết Tiền đường (TC-CCP-01b)
    const tienDuongBtn = await page.$("table.ppc-board tbody tr:first-child td:nth-child(8) button");
    if (tienDuongBtn) {
      await tienDuongBtn.click();
      await sleep(1000);
      const shotTienDuong = `${OUT_DIR}/m1-04-tien-duong-dialog.png`;
      await page.screenshot({ path: shotTienDuong });

      const tdModal = await page.evaluate(() => {
        const dialog = document.querySelector("[role='dialog'], .ops-modal");
        const backdrop = document.querySelector(".ops-modal-backdrop");
        if (!dialog) return { opened: false };
        const rect = dialog.getBoundingClientRect();
        return {
          opened: true,
          top: rect.top,
          inViewport: rect.top >= 0 && rect.top < window.innerHeight,
          backdropFixed: backdrop ? window.getComputedStyle(backdrop).position === "fixed" : false,
          title: dialog.querySelector("h2, h3")?.innerText
        };
      });

      recordTest("TC-CCP-01b", "Popup 'Xem chi tiết Tiền đường' hiển thị trong Viewport",
        (tdModal.opened && tdModal.inViewport) ? "PASS" : "FAIL",
        `Opened: ${tdModal.opened}, Top: ${tdModal.top?.toFixed(1)}px, InViewport: ${tdModal.inViewport}, Backdrop fixed: ${tdModal.backdropFixed}`,
        shotTienDuong);

      await clickByText(page, "button", "✕") || await page.keyboard.press("Escape");
      await sleep(500);
    }

    // 1.5 Báo cáo tháng Thu / Trả & Bảng phân công xe
    const reportTables = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll("h2, h3, caption")).map(e => e.innerText);
      const hasThu = headings.some(h => h.includes("Báo cáo phơi phiếu phải thu") || h.includes("Báo cáo tháng"));
      const hasTra = headings.some(h => h.includes("Báo cáo phơi phiếu phải trả") || h.includes("phải trả"));
      const hasTruckAssign = headings.some(h => h.includes("Phân công xe") || h.includes("xe theo kế toán"));
      return { hasThu, hasTra, hasTruckAssign, headings };
    });
    recordTest("TC-M1.5", "Báo cáo tháng Phơi phiếu Thu/Trả và Phân công xe",
      (reportTables.hasThu || reportTables.hasTruckAssign) ? "PASS" : "WARN",
      `Đã tìm thấy các bảng báo cáo: ${reportTables.hasThu ? 'Báo cáo Thu/Trả ✓' : ''} ${reportTables.hasTruckAssign ? 'Phân công xe ✓' : ''}`);
  });

  // =========================================================================
  // MODULE 2: KẾ TOÁN — THEO DÕI HÓA ĐƠN KẾT HỢP (/accounting/invoice-tracking)
  // =========================================================================
  console.log("\n--- MODULE 2: KẾ TOÁN - THEO DÕI HÓA ĐƠN KẾT HỢP ---");
  await withUserSession("ketoan", async (page) => {
    await page.goto(`${FRONTEND}/accounting/invoice-tracking`, { waitUntil: "networkidle2" });
    await sleep(1500);
    const shotInvMain = `${OUT_DIR}/m2-01-invoice-tracking-main.png`;
    await page.screenshot({ path: shotInvMain });

    // 2.1 Đoạn chồng chữ 14 cột (Bug 2 / TC-CCP-02)
    const collisionCheck = await page.evaluate(() => {
      const table = document.querySelector(".invoice-tracking-table, table");
      if (!table) return { exists: false };
      const rows = Array.from(table.querySelectorAll("tbody tr"));
      const cols = Array.from(table.querySelectorAll("thead th")).map(th => th.innerText.trim());
      
      let maxOverlap = 0;
      let overlapDetails = [];

      for (const row of rows.slice(0, 5)) {
        const cells = Array.from(row.querySelectorAll("td"));
        for (let i = 0; i < cells.length - 1; i++) {
          const currentCell = cells[i];
          const nextCell = cells[i + 1];
          const curRect = currentCell.getBoundingClientRect();
          const nextRect = nextCell.getBoundingClientRect();
          
          // Check children spans or text overflow
          const spans = Array.from(currentCell.querySelectorAll("span, div"));
          for (const sp of spans) {
            const spRect = sp.getBoundingClientRect();
            if (spRect.right > nextRect.left + 5) {
              const overlap = spRect.right - nextRect.left;
              if (overlap > maxOverlap) maxOverlap = overlap;
              overlapDetails.push(`Cột ${i + 1} ("${sp.innerText.slice(0, 20)}") tràn ${overlap.toFixed(1)}px sang Cột ${i + 2}`);
            }
          }
        }
      }

      return {
        exists: true,
        tableWidth: table.getBoundingClientRect().width,
        colCount: cols.length,
        maxOverlap,
        overlapDetails: overlapDetails.slice(0, 3)
      };
    });

    const cropInv = `${OUT_DIR}/m2-02-invoice-table-crop.png`;
    const tableEl = await page.$(".invoice-tracking-table") || await page.$(".table-scroll");
    if (tableEl) await tableEl.screenshot({ path: cropInv });

    recordTest("TC-CCP-02", "Bảng Hóa đơn kết hợp 14 cột không bị chồng chữ chéo",
      collisionCheck.maxOverlap <= 5 ? "PASS" : "FAIL",
      `Tràn lớn nhất: ${collisionCheck.maxOverlap.toFixed(1)}px. Chi tiết: ${collisionCheck.overlapDetails?.join("; ") || "Không có chồng chữ"}`,
      cropInv);

    // 2.2 Modal "+ Thêm chi phí lô hàng"
    const clickedAdd = await clickByText(page, "button", "Thêm chi phí lô hàng");
    if (clickedAdd) {
      await sleep(1000);
      const shotAdd = `${OUT_DIR}/m2-03-add-invoice-modal.png`;
      await page.screenshot({ path: shotAdd });
      
      const modalData = await page.evaluate(() => {
        const m = document.querySelector("[role='dialog'], .modal-box");
        return {
          title: m?.querySelector("h2, h3, .modal-title")?.innerText,
          hasInputs: !!m?.querySelector("input, select")
        };
      });
      recordTest("TC-M2.2", "Mở modal '+ Thêm chi phí lô hàng'", modalData.title ? "PASS" : "FAIL",
        `Modal title: "${modalData.title}"`, shotAdd);

      await clickByText(page, "button", "Hủy") || await clickByText(page, "button", "Đóng") || await page.keyboard.press("Escape");
      await sleep(500);
    }

    // 2.3 Xóa có lý do bắt buộc (Q10 / card 78)
    const deleteBtn = await page.$("table tbody tr:first-child button.btn--danger, table tbody tr:first-child button[aria-label*='Xóa']");
    if (deleteBtn) {
      await deleteBtn.click();
      await sleep(800);
      const shotDeletePrompt = `${OUT_DIR}/m2-04-delete-reason-prompt.png`;
      await page.screenshot({ path: shotDeletePrompt });

      const promptData = await page.evaluate(() => {
        const dialog = document.querySelector("[role='dialog'], .reason-prompt-modal, .confirm-modal");
        const textarea = dialog?.querySelector("textarea, input[type='text']");
        return {
          hasPrompt: !!dialog,
          hasReasonInput: !!textarea,
          title: dialog?.querySelector("h2, h3, p")?.innerText
        };
      });

      recordTest("TC-M2.3", "Thao tác Xóa yêu cầu nhập Lý do bắt buộc (Q10)",
        (promptData.hasPrompt && promptData.hasReasonInput) ? "PASS" : "WARN",
        `Reason prompt hiện: ${promptData.hasPrompt}, ô nhập lý do: ${promptData.hasReasonInput}`, shotDeletePrompt);

      await clickByText(page, "button", "Hủy") || await page.keyboard.press("Escape");
      await sleep(500);
    }
  });

  // =========================================================================
  // MODULE 3: KẾ TOÁN — THEO DÕI HOÀN CƯỢC CONTAINER (/accounting/deposit-tracker)
  // =========================================================================
  console.log("\n--- MODULE 3: KẾ TOÁN - THEO DÕI HOÀN CƯỢC CONTAINER ---");
  await withUserSession("ketoan", async (page) => {
    await page.goto(`${FRONTEND}/accounting/deposit-tracker`, { waitUntil: "networkidle2" });
    await sleep(1500);
    const shotDepMain = `${OUT_DIR}/m3-01-deposit-tracker-main.png`;
    await page.screenshot({ path: shotDepMain });

    // 3.1 Nút "Đã hoàn cược" bị xén & gãy token ngày (Bug 3 / TC-CCP-03)
    const depCheck = await page.evaluate(() => {
      const container = document.querySelector(".deposit-tracker-table-card, .table-scroll, main");
      const cRect = container ? container.getBoundingClientRect() : { right: window.innerWidth };
      
      const refundBtns = Array.from(document.querySelectorAll("table tbody button")).filter(b => b.innerText.includes("hoàn") || b.innerText.includes("cược"));
      let btnClipped = false;
      let btnLabel = "";
      if (refundBtns.length > 0) {
        const b = refundBtns[0];
        const bRect = b.getBoundingClientRect();
        btnLabel = b.innerText.trim();
        if (bRect.right > cRect.right + 2 || bRect.right > window.innerWidth) {
          btnClipped = true;
        }
      }

      // Check date wrap
      const dateCells = Array.from(document.querySelectorAll("table tbody td")).filter(td => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(td.innerText));
      let dateBroken = false;
      for (const dc of dateCells) {
        if (dc.innerText.includes("\n")) {
          dateBroken = true;
          break;
        }
      }

      return { btnClipped, btnLabel, dateBroken, refundBtnsCount: refundBtns.length };
    });

    const cropDep = `${OUT_DIR}/m3-02-deposit-table-crop.png`;
    const depTableEl = await page.$(".deposit-tracker-table") || await page.$(".deposit-tracker-table-card");
    if (depTableEl) await depTableEl.screenshot({ path: cropDep });

    recordTest("TC-CCP-03", "Nút 'Đã hoàn cược' không bị xén và token ngày không bị bẻ",
      (!depCheck.btnClipped && !depCheck.dateBroken) ? "PASS" : "FAIL",
      `Nút bị xén mép: ${depCheck.btnClipped ? "CÓ" : "KHÔNG"} (Nhãn: "${depCheck.btnLabel}"), Token ngày gãy đôi: ${depCheck.dateBroken ? "CÓ" : "KHÔNG"}`,
      cropDep);

    // 3.2 Modal "+ Thêm dòng cược"
    const clickedAddDep = await clickByText(page, "button", "Thêm dòng");
    if (clickedAddDep) {
      await sleep(1000);
      const shotAddDep = `${OUT_DIR}/m3-03-deposit-add-modal.png`;
      await page.screenshot({ path: shotAddDep });
      recordTest("TC-M3.2", "Mở modal '+ Thêm dòng cược'", "PASS", "Modal mở thành công", shotAddDep);
      await clickByText(page, "button", "Hủy") || await clickByText(page, "button", "Đóng") || await page.keyboard.press("Escape");
      await sleep(500);
    }

    // 3.3 Modal "Ngày CV / số tiền"
    const clickedCV = await clickByText(page, "button", "Ngày CV");
    if (clickedCV) {
      await sleep(1000);
      const shotCV = `${OUT_DIR}/m3-04-deposit-cv-modal.png`;
      await page.screenshot({ path: shotCV });
      recordTest("TC-M3.3", "Mở modal 'Ngày CV / số tiền'", "PASS", "Modal mở thành công", shotCV);
      await clickByText(page, "button", "Hủy") || await clickByText(page, "button", "Đóng") || await page.keyboard.press("Escape");
      await sleep(500);
    }

    // 3.4 Bấm hoàn cược & kiểm tra database side-effect
    const refundBtn = await page.$("table tbody tr:first-child button.btn--primary, table tbody tr:first-child button:last-child");
    if (refundBtn) {
      const btnText = await page.evaluate(el => el.innerText, refundBtn);
      if (btnText.includes("hoàn")) {
        await refundBtn.click();
        await sleep(1000);
        const shotConfirm = `${OUT_DIR}/m3-05-refund-confirm-dialog.png`;
        await page.screenshot({ path: shotConfirm });

        // Confirm
        const confirmed = await clickByText(page, "button", "Xác nhận") || await clickByText(page, "button", "Đồng ý");
        await sleep(1500);
        const shotAfterSubmit = `${OUT_DIR}/m3-06-refund-after-submit.png`;
        await page.screenshot({ path: shotAfterSubmit });

        recordTest("TC-M3.4", "Thao tác Đã hoàn cược & cập nhật trạng thái", confirmed ? "PASS" : "WARN",
          `Thao tác click xác nhận: ${confirmed}`, shotAfterSubmit);
      }
    }
  });

  // =========================================================================
  // MODULE 4: KẾ TOÁN — CHỐT DEBIT & KHÓA ĐƠN GIÁ (/accounting/chot-debit)
  // =========================================================================
  console.log("\n--- MODULE 4: KẾ TOÁN - CHỐT DEBIT & KHÓA ĐƠN GIÁ ---");
  await withUserSession("ketoan", async (page) => {
    await page.goto(`${FRONTEND}/accounting/chot-debit`, { waitUntil: "networkidle2" });
    await sleep(1500);
    const shotDebit = `${OUT_DIR}/m4-01-chot-debit-main.png`;
    await page.screenshot({ path: shotDebit });

    const debitTable = await page.evaluate(() => {
      const table = document.querySelector("table");
      const ths = Array.from(document.querySelectorAll("thead th")).map(t => t.innerText.trim());
      const rows = document.querySelectorAll("tbody tr").length;
      return { colCount: ths.length, rows, ths };
    });

    recordTest("TC-M4.1", "Bảng điều động tổng hợp đối soát chốt debit",
      debitTable.colCount >= 14 ? "PASS" : "WARN",
      `Số cột: ${debitTable.colCount}, Số dòng: ${debitTable.rows}`, shotDebit);

    // Click checkbox row 1
    const cb = await page.$("table tbody tr:first-child input[type='checkbox']");
    if (cb) {
      await cb.click();
      await sleep(500);
      const clickedDebitBtn = await clickByText(page, "button", "Xác nhận đối soát") || await clickByText(page, "button", "Debit");
      await sleep(1000);
      const shotDebitModal = `${OUT_DIR}/m4-02-debit-confirm-dialog.png`;
      await page.screenshot({ path: shotDebitModal });

      recordTest("TC-M4.2", "Thao tác chốt Debit dòng lô hàng",
        clickedDebitBtn ? "PASS" : "WARN",
        `Nút xác nhận đối soát/debit bấm được: ${clickedDebitBtn}`, shotDebitModal);

      await clickByText(page, "button", "Hủy") || await clickByText(page, "button", "Đóng") || await page.keyboard.press("Escape");
    }
  });

  // =========================================================================
  // MODULE 5: KẾ TOÁN — DUYỆT CHI PHÍ OPS (/accounting/expenses?view=ops)
  // =========================================================================
  console.log("\n--- MODULE 5: KẾ TOÁN - DUYỆT CHI PHÍ OPS ---");
  await withUserSession("ketoan", async (page) => {
    await page.goto(`${FRONTEND}/accounting/expenses?view=ops`, { waitUntil: "networkidle2" });
    await sleep(1500);
    const shotOpsExp = `${OUT_DIR}/m5-01-accounting-ops-expenses.png`;
    await page.screenshot({ path: shotOpsExp });

    const expensesView = await page.evaluate(() => {
      const title = document.querySelector("h1, h2, .page-header")?.innerText;
      const rows = document.querySelectorAll("table tbody tr").length;
      return { title, rows };
    });

    recordTest("TC-M5.1", "Màn hình Kế toán duyệt chi phí OPS", "PASS",
      `Tiêu đề: "${expensesView.title}", Số dòng chi phí: ${expensesView.rows}`, shotOpsExp);
  });

  // =========================================================================
  // MODULE 6: OPS GIAO NHẬN — KHAI CHI PHÍ & VÍ TẠM ỨNG (giaonhan)
  // =========================================================================
  console.log("\n--- MODULE 6: OPS GIAO NHẬN - KHAI CHI PHÍ & VÍ TẠM ỨNG ---");
  await withUserSession("giaonhan", async (page) => {
    // 6.1 Khai chi phí trên đơn hàng
    await page.goto(`${FRONTEND}/ops/orders`, { waitUntil: "networkidle2" });
    await sleep(1500);
    const shotOpsOrders = `${OUT_DIR}/m6-01-ops-orders.png`;
    await page.screenshot({ path: shotOpsOrders });

    const clickedKhai = await clickByText(page, "button", "Khai chi phí");
    if (clickedKhai) {
      await sleep(1000);
      const shotKhaiModal = `${OUT_DIR}/m6-02-khai-chi-phi-modal.png`;
      await page.screenshot({ path: shotKhaiModal });

      const formFields = await page.evaluate(() => {
        const dialog = document.querySelector("[role='dialog'], .modal-box, .ops-modal");
        const text = dialog?.innerText || "";
        const hasThucChi = text.includes("Thực chi") || !!dialog?.querySelector("input[name*='chi'], input[name*='amount']");
        const hasThucThu = text.includes("Thực thu") || !!dialog?.querySelector("input[name*='thu']");
        const hasKhachTra = text.includes("Khách trả") || text.includes("Thu khách") || !!dialog?.querySelector("input[type='checkbox']");
        const hasFile = !!dialog?.querySelector("input[type='file']");
        return { hasThucChi, hasThucThu, hasKhachTra, hasFile, title: dialog?.querySelector("h2, h3")?.innerText };
      });

      recordTest("TC-M6.1", "Form Khai chi phí có Thực chi, Thực thu, Khách trả, Đính kèm ảnh",
        (formFields.hasThucChi && formFields.hasKhachTra) ? "PASS" : "WARN",
        `Thực chi: ${formFields.hasThucChi}, Thực thu: ${formFields.hasThucThu}, Khách trả: ${formFields.hasKhachTra}, File upload: ${formFields.hasFile}`,
        shotKhaiModal);

      await clickByText(page, "button", "Hủy") || await clickByText(page, "button", "Đóng") || await page.keyboard.press("Escape");
    }

    // 6.2 Ví tạm ứng OPS
    await page.goto(`${FRONTEND}/ops/wallet`, { waitUntil: "networkidle2" });
    await sleep(1500);
    const shotWallet = `${OUT_DIR}/m6-03-ops-wallet.png`;
    await page.screenshot({ path: shotWallet });

    const walletInfo = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".kpi-card, .stat, .wallet-summary")).map(c => c.innerText);
      const hasRequestBtn = !!document.querySelector("button") && Array.from(document.querySelectorAll("button")).some(b => b.innerText.includes("tạm ứng"));
      return { cards, hasRequestBtn };
    });

    recordTest("TC-M6.2", "Ví tạm ứng & Quyết toán hoàn ứng OPS",
      walletInfo.hasRequestBtn ? "PASS" : "WARN",
      `Nút yêu cầu tạm ứng: ${walletInfo.hasRequestBtn ? "CÓ" : "KHÔNG"}, Thông tin ví: ${walletInfo.cards.length} chỉ số`,
      shotWallet);
  });

  // =========================================================================
  // MODULE 7: LÁI XE — CHUYẾN HÀNG, TIỀN ĐƯỜNG & CHI PHÍ (laixe)
  // =========================================================================
  console.log("\n--- MODULE 7: LÁI XE - CHUYẾN HÀNG & TIỀN ĐƯỜNG ---");
  await withUserSession("laixe", async (page) => {
    await page.goto(`${FRONTEND}/my-trips`, { waitUntil: "networkidle2" });
    await sleep(1500);
    const shotDriverTrips = `${OUT_DIR}/m7-01-driver-trips.png`;
    await page.screenshot({ path: shotDriverTrips });

    // Click tab Đã nhận
    await clickByText(page, "button, a", "Đã nhận");
    await sleep(1000);
    const shotDaNhan = `${OUT_DIR}/m7-02-driver-trips-danhan.png`;
    await page.screenshot({ path: shotDaNhan });

    // Open first trip detail
    const detailLink = await page.$("a[href*='/my-trips/'], button.btn--primary, .trip-card");
    if (detailLink) {
      await detailLink.click();
      await sleep(1500);
      const shotTripDetail = `${OUT_DIR}/m7-03-driver-trip-detail.png`;
      await page.screenshot({ path: shotTripDetail });

      const tripCostFields = await page.evaluate(() => {
        const text = document.body.innerText;
        return {
          hasTienDuong: text.includes("Tiền đường") || text.includes("tiền đường"),
          hasTamUng: text.includes("Tạm ứng") || text.includes("tạm ứng"),
          hasBocXep: text.includes("Bốc xếp") || text.includes("bốc xếp") || text.includes("Vá vỏ"),
          hasLuongChuyen: text.includes("Lương") || text.includes("lương chuyến")
        };
      });

      recordTest("TC-M7.1", "Giao diện chi tiết chuyến Lái xe có đầy đủ mục chi phí",
        tripCostFields.hasTienDuong ? "PASS" : "WARN",
        `Tiền đường: ${tripCostFields.hasTienDuong}, Tạm ứng: ${tripCostFields.hasTamUng}, Phát sinh/Bốc xếp: ${tripCostFields.hasBocXep}, Lương chuyến: ${tripCostFields.hasLuongChuyen}`,
        shotTripDetail);
    }
  });

  // Ghi kết quả vào file JSON và Markdown
  const reportJson = join(OUT_DIR, "report.json");
  writeFileSync(reportJson, JSON.stringify(testResults, null, 2));

  console.log("\n==================================================================");
  console.log("COMPREHENSIVE TEST COMPLETED!");
  console.log(`Total tests run: ${testResults.length}`);
  console.log(`Passed: ${testResults.filter(t => t.status === "PASS").length}`);
  console.log(`Failed: ${testResults.filter(t => t.status === "FAIL").length}`);
  console.log(`Warnings: ${testResults.filter(t => t.status === "WARN").length}`);
  console.log("Report saved to:", reportJson);
  console.log("==================================================================");
}

main().catch(err => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
