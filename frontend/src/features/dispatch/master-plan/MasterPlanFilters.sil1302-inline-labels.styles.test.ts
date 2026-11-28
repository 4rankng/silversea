import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1302 (QA build 61999831, /dispatch 'Bộ lọc') — nhãn trộn 2 kiểu: hàng 1
// các ô chọn mang nhãn inline trong nút ('Xuất / Nhập: Tất cả'), ô thứ 5 lại
// có nhãn 'Nhà xe' nổi riêng phía trên trong khi nút cũng chỉ hiện 'Nhà xe' —
// cùng một trường 2 lần với 2 kiểu nhãn. Luật: MỌI nhãn inline như
// InlineLabelSelect ('Label: value' trong nút, không span nhãn nổi), nhãn
// hiển thị = tên truy cập (Label in Name); nút 'Áp dụng' dùng màu chuẩn
// btn--primary (brand), không nền đen var(--ink).
const tsx = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanFilters.tsx'), 'utf8');
const filterCss = readFileSync(resolve(process.cwd(), 'src/components/FilterDropdown.css'), 'utf8');
const gridCss = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');

describe('MasterPlanFilters — nhãn inline đồng nhất + nút Áp dụng màu chuẩn (SIL-1302)', () => {
  it('không còn span nhãn nổi trong các ô chọn facet', () => {
    expect(tsx).not.toContain('master-plan-filters__label');
    // rule CSS của nhãn nổi cũng đi theo (dead code).
    expect(gridCss).not.toContain('.master-plan-filters__label');
  });

  it('placeholder facet mang nhãn inline "Label: value" như InlineLabelSelect', () => {
    expect(tsx).toContain('placeholder={`${label}: Tất cả`}');
    expect(tsx).toContain('placeholder="Nhà xe: Tất cả"');
  });

  it("nút 'Áp dụng' dùng brand/brand-hover như .btn--primary, không var(--ink)", () => {
    // .filter-dropdown__apply khai báo 2 lần (sizing chung + paint) — lấy
    // block chứa background.
    const apply = [...filterCss.matchAll(/\.filter-dropdown__apply \{([^}]*)\}/g)]
      .map((match) => match[1]).find((body) => /^\s*background:/m.test(body)) ?? '';
    const applyHover = filterCss.match(/\.filter-dropdown__apply:hover \{([^}]*)\}/)?.[1] ?? '';
    expect(apply).toMatch(/background:\s*var\(--brand\)/);
    expect(apply).not.toMatch(/var\(--ink\)/);
    expect(applyHover).toMatch(/background:\s*var\(--brand-hover\)/);
    expect(applyHover).not.toMatch(/var\(--accent\)/);
  });
});
