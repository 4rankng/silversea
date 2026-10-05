import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { OpsQueryFeedback } from './OpsQueryFeedback';

/**
 * Card 051026230609 (VISUAL) — loading text rendered as "Đang tảikế hoạch
 * làm hàng…" (missing space) to the E2E/AT extract path. The message was built
 * from separate JSX text children ("Đang tải ", label, "…"); name-from-contents
 * extraction (accessibility snapshots, QA probes) trims each text node and
 * joins without separators, eating the boundary space. The component must
 * render the message as ONE text node so every extraction path sees the space.
 */

/** Mimics name-from-contents extraction: per TEXT-NODE trim, join with no
 *  separator — the path that produced "Đang tảikế hoạch làm hàng…" in the E2E. */
function extractedText(el: HTMLElement): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push((walker.currentNode.textContent ?? '').trim());
  return parts.join('');
}

describe('OpsQueryFeedback loading text (card 051026230609)', () => {
  it('keeps the space between "Đang tải" and the label under node-boundary extraction', () => {
    const { getByRole } = render(
      <OpsQueryFeedback loading label="kế hoạch làm hàng" onRetry={() => {}} />,
    );
    expect(extractedText(getByRole('status'))).toBe('Đang tải kế hoạch làm hàng…');
  });

  it('keeps the space for the fleet label too', () => {
    const { getByRole } = render(
      <OpsQueryFeedback loading label="phương tiện" onRetry={() => {}} />,
    );
    expect(extractedText(getByRole('status'))).toBe('Đang tải phương tiện…');
  });

  it('keeps the error copy as one extractable phrase', () => {
    const { getByRole } = render(
      <OpsQueryFeedback error label="phương tiện" onRetry={() => {}} />,
    );
    const text = getByRole('alert').textContent ?? '';
    expect(text).toContain('Không tải được phương tiện');
  });
});
