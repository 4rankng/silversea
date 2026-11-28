import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1300 (QA build 61999831, 1280×720 sidebar mở) — cột GHI CHÚ nằm ngoài
// mép phải, không có dấu hiệu cuộn nào: document overflow-x hidden, thanh
// cuộn của rail nằm dưới fold. Luật: áp dụng scroll-hint (P2) cho rail
// edge-to-edge của master-plan — fade + chip 'Kéo ngang' kéo ra mép rail thật
// qua --scroll-hint-inset, chip neo cạnh đầu rail (rail ~1300px cao hơn
// viewport 720px — top 50% của shared rule nằm dưới fold), fallback tĩnh
// ≤1417.98px = mọi canvas mà bảng floor 1170px còn tràn.
const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');

function ruleBody(selector: string): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const match = css.match(pattern);
  expect(match, `expected a rule for ${selector}`).toBeTruthy();
  return match![1];
}

describe('MasterPlanGrid — scroll-hint rail adoption (SIL-1300)', () => {
  it('host kéo overlay ra mép rail thật: --scroll-hint-inset = −pad', () => {
    const hint = ruleBody('.master-plan-grid__hint');
    expect(hint).toMatch(/--scroll-hint-inset:\s*calc\(-1 \* var\(--app-body-pad-x, 24px\)\)/);
  });

  it('chip neo cạnh đầu rail, không phải giữa rail (top 50% nằm dưới fold)', () => {
    const chip = ruleBody('.scroll-hint.master-plan-grid__hint::after');
    expect(chip).toMatch(/top:\s*96px/);
    expect(chip).not.toMatch(/top:\s*50%/);
  });

  it('fallback tĩnh ≤1417.98px cho engine không có scroll-timeline', () => {
    expect(css).toMatch(
      /@supports not \(animation-timeline: scroll\(\)\) \{\s*@media \(max-width: 1417\.98px\) \{[\s\S]*?\.scroll-hint\.master-plan-grid__hint::before,/,
    );
  });
});
