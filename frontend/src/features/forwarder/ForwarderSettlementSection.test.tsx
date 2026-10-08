import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ForwarderSettlementSection } from './ForwarderSettlementSection';

/**
 * Card 061026043646 sweep — the step-panel loading announcement was built from
 * separate JSX text children (icon, " Đang tải ", label, "…"); node-boundary
 * extraction trims each node and joins with no separator. One <span> text
 * node, like OpsQueryFeedback (card 051026230609).
 */
function extractedText(el: Element): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push((walker.currentNode.textContent ?? '').trim());
  return parts.join('');
}

const pendingQuery = {
  data: undefined,
  isPending: true,
  isFetching: false,
  error: null,
  refetch: () => Promise.resolve(),
};

describe('ForwarderSettlementSection loading announcement (card 061026043646)', () => {
  it('keeps the space between "Đang tải" and the step label under node-boundary extraction', () => {
    const { getByRole } = render(
      <ForwarderSettlementSection step={1} title="Chọn tạm ứng chưa quyết toán" icon={() => null} query={pendingQuery}>
        <p>body</p>
      </ForwarderSettlementSection>,
    );
    expect(extractedText(getByRole('status'))).toBe('Đang tải tạm ứng chưa quyết toán…');
  });
});
