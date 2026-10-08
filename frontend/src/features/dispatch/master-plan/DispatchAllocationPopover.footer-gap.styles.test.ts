import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20261004_322 — operator report on the "Phân bổ nhà xe" dialog (KẾ HOẠCH
// TỔNG QUÁT): "có khoảng trống đáng kể giữa hộp xanh 'Đã phân bổ đủ số container
// của lô hàng.' và footer chứa nút Huỷ / 'Lưu phân bổ'. Dialog nhìn chung đã dày
// đặc, chỉ còn điểm này."
//
// Contract (AC1): the footer follows the content directly — the green status box
// and the footer never carry dead white between them. The footer's `border-top`
// hairline IS the separator (house precedent: design-system/Modal.css
// `.modal__foot`, components/shipment/CarrierAllocationDialog.css
// `.carrier-allocation-dialog__footer` — divider + padding, no top margin), so
// the seam above the divider is a small deliberate margin (≤4px) and the buttons
// sit right under it (padding-top ≤8px, the `.modal__foot` rhythm). Nothing may
// fill or stretch the panel to push the footer away from the content
// (no min-height/flex-grow/auto margins — that was the suspected gap class).
//
// Contract (AC2): the narrow-width footer keeps its reachable shape — 2-column
// grid of full-height touch targets under 680px, and the panel keeps its
// max-height + overflow scroll so nothing is clipped at 1280 or 390.
//
// Pre-fix history: 7fc3afe5^ carried `margin-top: 18px; padding-top: 14px`
// (32px stacked seam — the QA screenshot); untested 7fc3afe5 halved it to
// 8px/10px; this card pins the glued seam. Declarations are pinned here, the
// browser matrix is the lead's render rung.

const css = readFileSync(
  resolve(process.cwd(), 'src/features/dispatch/master-plan/DispatchAllocationPopover.css'),
  'utf8'
);

const ruleBodies = (source: string): Array<{ selector: string; body: string }> =>
  [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().split('\n').pop()!.trim(),
    body: m[2],
  }));

// Parsed declaration map: keys are the property names the rule actually
// declares (exact match, so `height` never shadows `max-height`).
function decls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split(';')) {
    const [prop, ...rest] = part.split(':');
    if (rest.length === 0) continue;
    out[prop.trim().toLowerCase()] = rest.join(':').trim();
  }
  return out;
}

function px(value: string | undefined): number {
  const matched = value?.match(/^(\d+(?:\.\d+)?)px$/);
  expect(matched, `expected a px length, got ${value ?? '<absent>'}`).toBeTruthy();
  return Number(matched![1]);
}

const rules = ruleBodies(css);

// The base footer rule: the one carrying the border-top separator.
const footerRule = rules.find(
  (rule) => rule.selector === '.dispatch-allocation-popover__actions' && /border-top/.test(rule.body)
);
// The phone footer rule: the grid variant inside the ≤680px band.
const mobileFooterRule = rules.find(
  (rule) => rule.selector === '.dispatch-allocation-popover__actions' && /grid-template-columns/.test(rule.body)
);
const rootRule = rules.find((rule) => rule.selector === '.dispatch-allocation-popover');

describe('allocation popover footer follows the content (card 20261004_322)', () => {
  describe('AC1 — no gap between the green status box and the footer', () => {
    it('keeps the border-top hairline as the footer separator', () => {
      expect(footerRule).toBeTruthy();
      expect(decls(footerRule!.body)['border-top']).toBe('1px solid var(--border-1)');
    });

    it('glues the footer seam to the content: margin-top ≤ 4px, padding-top ≤ 8px', () => {
      expect(footerRule).toBeTruthy();
      const seam = decls(footerRule!.body);
      expect(px(seam['margin-top'])).toBeLessThanOrEqual(4);
      expect(px(seam['padding-top'])).toBeLessThanOrEqual(8);
    });

    it('never detaches the footer with an auto margin or a fill/stretcher', () => {
      expect(css).not.toMatch(/margin-top:\s*auto/);
      expect(footerRule).toBeTruthy();
      expect(rootRule).toBeTruthy();
      for (const rule of [footerRule!, rootRule!]) {
        const seam = decls(rule.body);
        for (const forbidden of ['height', 'min-height', 'flex', 'flex-grow', 'flex-basis']) {
          expect(seam[forbidden], `${rule.selector} must not declare ${forbidden}`).toBeUndefined();
        }
        expect(seam['margin-top']).not.toBe('auto');
      }
    });
  });

  describe('AC2 — narrow-width footer stays reachable, nothing clips', () => {
    it('keeps the ≤680px footer as a full-width 2-column button grid', () => {
      expect(mobileFooterRule).toBeTruthy();
      const mobile = decls(mobileFooterRule!.body);
      expect(mobile['display']).toBe('grid');
      expect(mobile['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
    });

    it('keeps the touch floor on the ≤680px footer buttons', () => {
      const floor = rules.find(
        (rule) => rule.selector === '.dispatch-allocation-popover__actions > *' && /min-height/.test(rule.body)
      );
      expect(floor).toBeTruthy();
      expect(decls(floor!.body)['min-height']).toBe('var(--control-max-h)');
    });

    it('keeps the panel capped and scrollable so content is never clipped', () => {
      expect(rootRule).toBeTruthy();
      const panel = decls(rootRule!.body);
      expect(panel['max-height']).toBe('calc(100dvh - 48px)');
      expect(panel['overflow-y']).toBe('auto');
    });
  });
});
