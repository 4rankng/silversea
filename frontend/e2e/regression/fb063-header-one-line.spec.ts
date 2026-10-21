/**
 * FB-063 — header bảng container của form lô hàng (/shipments/new) luôn 1 dòng.
 *
 * Luật R17 (card 181026021137; regression TC-201026101500): `.csc-container-table
 * thead th` phải `white-space: nowrap` + bề rộng cột đủ cho nhãn 1 dòng ("Loại
 * container", "Trọng lượng (kg)"…). Regression 20/10: `white-space: normal`
 * (b6e49f27) làm nhãn wrap 2 dòng ở mọi width desktop.
 */
import { test, expect } from '@playwright/test';
import { appReady, authedPage, shot } from './helpers';

async function measureHeaders(page: import('@playwright/test').Page) {
  return page.locator('.csc-container-table thead th').evaluateAll((ths) => ths.map((th) => {
    // Đo văn bản THẬT của label (bỏ sort icon/button inline-box).
    const walker = document.createTreeWalker(th, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    let node = walker.nextNode();
    while (node) { texts.push(node as Text); node = walker.nextNode(); }
    const lines = texts.map((t) => {
      const range = document.createRange();
      range.selectNodeContents(t);
      const rects = [...range.getClientRects()]; return rects.filter((r) => r.height > 2).length;
    }).reduce((a, b) => a + b, 0);
    return {
      label: (th.textContent ?? '').trim(),
      lines,
      nowrap: getComputedStyle(th).whiteSpace === 'nowrap',
    };
  }));
}

test('FB-063: nhãn cột bảng container /shipments/new 1 dòng + nowrap @1024 & @1440', async ({ browser }) => {
  const cus = await authedPage(browser, 'cus', { storage: { 'cus-lots-hidden-cols': '["notes"]' } });
  try {
    for (const width of [1024, 1440] as const) {
      await cus.page.setViewportSize({ width, height: 900 });
      await appReady(cus.page, '/shipments/new');
      const table = cus.page.locator('.csc-container-table').first();
      await expect(table).toBeVisible({ timeout: 25_000 });
      // Thêm 1 dòng nữa để header ở trạng thái nhiều dòng dữ liệu (như repro QA).
      const addBtn = cus.page.getByRole('button', { name: /^Thêm container$/ }).first();
      if (await addBtn.count()) {
        await addBtn.scrollIntoViewIfNeeded();
        await addBtn.click();
        await cus.page.waitForTimeout(300);
      }

      const measured = await measureHeaders(cus.page);
      expect(measured.length, `w${width}: bảng có nhãn cột để đo`).toBeGreaterThan(5);
      const wrapped = measured.filter((c) => c.lines > 1);
      expect(wrapped, `w${width}: không nhãn nào wrap 2 dòng — ${JSON.stringify(wrapped)}`).toEqual([]);
      const notNowrap = measured.filter((c) => !c.nowrap);
      expect(notNowrap, `w${width}: luật nowrap phải đang bật — ${JSON.stringify(notNowrap)}`).toEqual([]);
      await shot(cus.page, `fb063-csc-container-header-w${width}`, { fullPage: false });
    }
  } finally {
    await cus.close();
  }
});
