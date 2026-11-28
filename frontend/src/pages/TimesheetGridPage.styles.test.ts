import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1299 (staging 61999831, 1440x900) — dải tóm tắt 9 mục của /timesheet:
// nhãn dài "Nghỉ tai nạn / nghỉ việc gia đình có phép" quấn 4 dòng trong dt
// 73px (một hàng 9 mục chia mỗi mục ~120px), và số bị đẩy cao hơn nhãn ~2px
// (dd 16px/1.25 căn baseline khác dt 13px/1.35 — QA đo số y699, nhãn y701).
// Luật sau: grid 3 cột × 3 hàng cho mỗi mục nhãn 1–2 dòng; số và nhãn thẳng
// cạnh trên lẫn baseline; hàng 2–3 nối bằng border-top.
const css = readFileSync(resolve(process.cwd(), 'src/pages/TimesheetGridPage.css'), 'utf8');

function ruleBody(selector: string): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const match = css.match(pattern);
  expect(match, `expected a rule for ${selector}`).toBeTruthy();
  return match![1];
}

describe('TimesheetGridPage — dải tóm tắt 3×3, số thẳng cạnh nhãn (SIL-1299)', () => {
  it('9 mục chia 3 cột trong media ≥641px — nhãn dài chỉ còn 1–2 dòng', () => {
    expect(css).toMatch(/@media \(min-width: 641px\) \{\s*\n\s*\.ts-page \.summary-rail dl \{/);
    const dl = ruleBody('.ts-page .summary-rail dl');
    expect(dl).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  });

  it('số thẳng cạnh trên nhãn: item align-items flex-start (không phải baseline)', () => {
    const item = ruleBody('.ts-page .summary-rail__item');
    expect(item).toMatch(/align-items:\s*flex-start/);
    expect(item).not.toMatch(/align-items:\s*baseline/);
  });

  it('baseline số/nhãn khớp ~0.3px: dd line-height 1 (đầu cao ~2px trước đây)', () => {
    const dd = ruleBody('.ts-page .summary-rail dd');
    expect(dd).toMatch(/line-height:\s*1[;\s]/);
  });

  it('hàng 2–3 tách bằng border-top như luật pairing mobile của rail', () => {
    const rows = ruleBody('.ts-page .summary-rail__item:nth-child(n + 4)');
    expect(rows).toMatch(/border-top:\s*1px solid var\(--line\)/);
  });
});

describe('TimesheetGridPage — legend nguyên mảnh, tách dòng thoáng (SIL-1299)', () => {
  const sheet = readFileSync(resolve(process.cwd(), 'src/pages/TimesheetGridPage.css'), 'utf8');

  it('mục legend không quấn giữa câu từ 769px (white-space nowrap)', () => {
    expect(sheet).toMatch(/@media \(min-width: 769px\) \{\s*\n\s*\.ts-legend span \{ white-space: nowrap; \}\s*\n\}/);
  });

  it('dòng legend quấn nhau cách 8px, không dính thành khối chữ', () => {
    const legend = sheet.match(/\.ts-legend \{([^}]*)\}/)![1];
    expect(legend).toMatch(/gap:\s*8px 16px/);
  });
});
