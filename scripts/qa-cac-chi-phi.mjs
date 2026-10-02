#!/usr/bin/env node
import { withSession } from "./lib/ui-driver.mjs";
import { login } from "./lib/http.mjs";
import { mkdirSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickButtonByText(page, text) {
  const handles = await page.$$("button, a, input[type='button'], input[type='submit']");
  for (const h of handles) {
    const val = await page.evaluate(el => (el.innerText || el.value || el.textContent || "").trim(), h);
    if (val.includes(text)) {
      await h.click();
      return true;
    }
  }
  return false;
}

async function main() {
  const dir = "qa/2026-09-22_cac-chi-phi-audit";
  mkdirSync(dir, { recursive: true });

  const tokenKetoan = await login("ketoan", { backend: "http://localhost:3002/api" });

  await withSession(tokenKetoan, async (page) => {
    // 1. Phoi phieu: open Chi ho modal
    console.log("=== STEP 1: Kiểm soát phơi phiếu - Xem chi tiết Chi hộ ===");
    await page.goto("http://localhost:7175/accounting/phoi-phieu", { waitUntil: "networkidle2" });
    await sleep(1000);

    const chiHoButtons = await page.$$("table tbody tr td:nth-child(7) button");
    console.log("Found Chi ho buttons:", chiHoButtons.length);
    if (chiHoButtons.length > 0) {
      await chiHoButtons[0].click();
      await sleep(1000);
      await page.screenshot({ path: `${dir}/step1-chi-ho-dialog.png` });

      const dialogData = await page.evaluate(() => {
        const dialog = document.querySelector("[role='dialog'], .modal-box, div[class*='modal']");
        const labels = Array.from(dialog?.querySelectorAll("label") || []);
        const equalLabel = labels.find(l => l.innerText.includes("Thu và Trả"));
        return {
          title: dialog?.querySelector("h2, h3, .modal-title, .title")?.innerText,
          hasEqualCheckbox: !!equalLabel,
          allText: dialog?.innerText
        };
      });
      console.log("Dialog data:", dialogData);

      const closed = await clickButtonByText(page, "Đóng") || await clickButtonByText(page, "Hủy");
      if (!closed) await page.keyboard.press("Escape");
      await sleep(500);
    }

    // 2. Phoi phieu: open Tien duong modal
    console.log("=== STEP 2: Kiểm soát phơi phiếu - Xem chi tiết Tiền đường ===");
    const tdButtons = await page.$$("table tbody tr td:nth-child(8) button");
    console.log("Found Tien duong buttons:", tdButtons.length);
    if (tdButtons.length > 0) {
      await tdButtons[0].click();
      await sleep(1000);
      await page.screenshot({ path: `${dir}/step2-tien-duong-dialog.png` });

      const tdData = await page.evaluate(() => {
        const dialog = document.querySelector("[role='dialog'], .modal-box, div[class*='modal']");
        return {
          title: dialog?.querySelector("h2, h3, .modal-title, .title")?.innerText,
          allText: dialog?.innerText
        };
      });
      console.log("Tien duong dialog data:", tdData);

      const closed = await clickButtonByText(page, "Đóng") || await clickButtonByText(page, "Hủy");
      if (!closed) await page.keyboard.press("Escape");
      await sleep(500);
    }

    // 3. Kế toán chốt debit: Click "Debit" / "Xác nhận đối soát"
    console.log("=== STEP 3: Kế toán chốt debit ===");
    await page.goto("http://localhost:7175/accounting/chot-debit", { waitUntil: "networkidle2" });
    await sleep(1000);

    const rowCheckboxes = await page.$$("table tbody tr td:first-child input[type='checkbox']");
    console.log("Found debit row checkboxes:", rowCheckboxes.length);
    if (rowCheckboxes.length > 0) {
      await rowCheckboxes[0].click();
      await sleep(500);
      await page.screenshot({ path: `${dir}/step3a-debit-row-checked.png` });

      const clicked = await clickButtonByText(page, "Xác nhận đối soát") || await clickButtonByText(page, "Debit");
      console.log("Clicked debit button:", clicked);
      await sleep(1000);
      await page.screenshot({ path: `${dir}/step3b-debit-popup.png` });

      const popupData = await page.evaluate(() => {
        const dialog = document.querySelector("[role='dialog'], .modal-box, div[class*='modal']");
        return {
          title: dialog?.querySelector("h2, h3, .modal-title")?.innerText,
          text: dialog?.innerText
        };
      });
      console.log("Debit Popup Data:", popupData);

      const closed = await clickButtonByText(page, "Đóng") || await clickButtonByText(page, "Hủy");
      if (!closed) await page.keyboard.press("Escape");
      await sleep(500);
    }

    // 4. Invoice tracking: "+ Thêm chi phí lô hàng"
    console.log("=== STEP 4: Theo dõi hóa đơn kết hợp ===");
    await page.goto("http://localhost:7175/accounting/invoice-tracking", { waitUntil: "networkidle2" });
    await sleep(1000);
    const clickedAddInv = await clickButtonByText(page, "Thêm chi phí lô hàng");
    console.log("Clicked Thêm chi phí lô hàng:", clickedAddInv);
    await sleep(1000);
    await page.screenshot({ path: `${dir}/step4-invoice-dialog.png` });

    const invDialogData = await page.evaluate(() => {
      const dialog = document.querySelector("[role='dialog'], .modal-box, div[class*='modal']");
      return {
        title: dialog?.querySelector("h2, h3, .modal-title")?.innerText,
        text: dialog?.innerText
      };
    });
    console.log("Invoice Dialog Data:", invDialogData);

    const closedInv = await clickButtonByText(page, "Đóng") || await clickButtonByText(page, "Hủy");
    if (!closedInv) await page.keyboard.press("Escape");
    await sleep(500);

    // 5. Deposit tracker: "+ Thêm dòng" and "Ngày CV / số tiền"
    console.log("=== STEP 5: Theo dõi hoàn cược container ===");
    await page.goto("http://localhost:7175/accounting/deposit-tracker", { waitUntil: "networkidle2" });
    await sleep(1000);
    const clickedAddDep = await clickButtonByText(page, "Thêm dòng");
    console.log("Clicked Thêm dòng cược:", clickedAddDep);
    await sleep(1000);
    await page.screenshot({ path: `${dir}/step5a-deposit-add-dialog.png` });

    const depDialogData = await page.evaluate(() => {
      const dialog = document.querySelector("[role='dialog'], .modal-box, div[class*='modal']");
      return {
        title: dialog?.querySelector("h2, h3, .modal-title")?.innerText,
        text: dialog?.innerText
      };
    });
    console.log("Deposit Add Dialog Data:", depDialogData);

    const closedDep = await clickButtonByText(page, "Đóng") || await clickButtonByText(page, "Hủy");
    if (!closedDep) await page.keyboard.press("Escape");
    await sleep(500);

    const clickedCV = await clickButtonByText(page, "Ngày CV");
    console.log("Clicked Ngày CV / số tiền:", clickedCV);
    await sleep(1000);
    await page.screenshot({ path: `${dir}/step5b-deposit-cv-dialog.png` });

    const cvDialogData = await page.evaluate(() => {
      const dialog = document.querySelector("[role='dialog'], .modal-box, div[class*='modal']");
      return {
        title: dialog?.querySelector("h2, h3, .modal-title")?.innerText,
        text: dialog?.innerText
      };
    });
    console.log("CV Dialog Data:", cvDialogData);

    const closedCV = await clickButtonByText(page, "Đóng") || await clickButtonByText(page, "Hủy");
    if (!closedCV) await page.keyboard.press("Escape");
    await sleep(500);

  }, { name: "2026-09-22_cac-chi-phi-audit" });
}

main().catch(console.error);
