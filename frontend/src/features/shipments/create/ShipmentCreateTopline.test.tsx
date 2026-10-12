import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ShipmentCreateTopline } from './ShipmentCreateTopline';
import { requiredCompletion } from './ShipmentCreateTopline.progress';

// Card 121026084623 (QA1-007): the header chip counted ONLY the three
// `*`-marked identity fields (requiredTotal was hardcoded 3) while the summary
// panel counted every blocking issue — so "Bắt buộc: 3/3" sat next to "Cần bổ
// sung 6 thông tin" and read as "you are done".
describe('required completion — one denominator for chip and panel', () => {
  it('counts identity fields still open as part of the issue list', () => {
    // All three identity fields filled; six further items block submission.
    expect(requiredCompletion(3, 6)).toEqual({ done: 3, total: 9 });
  });

  it('does not double-count the identity fields the issue list already names', () => {
    // Nothing filled; the issue list already contains the missing identity items.
    expect(requiredCompletion(0, 6)).toEqual({ done: 0, total: 6 });
  });

  it('reports the identity fields alone once nothing else blocks', () => {
    expect(requiredCompletion(3, 0)).toEqual({ done: 3, total: 3 });
  });

  it('never reports a total below the number already done', () => {
    for (const done of [0, 1, 2, 3]) {
      expect(requiredCompletion(done, 0).total).toBeGreaterThanOrEqual(done);
    }
  });

  // The issue list only fills in once the operator submits, so a pristine form
  // must not collapse the chip to "0/0".
  it('keeps the identity denominator before anything has been submitted', () => {
    expect(requiredCompletion(0, 0)).toEqual({ done: 0, total: 3 });
    expect(requiredCompletion(3, 0)).toEqual({ done: 3, total: 3 });
  });

  it('renders the shared denominator in the chip', () => {
    render(
      <ShipmentCreateTopline
        saving={null}
        requiredDone={3}
        requiredTotal={9}
        onCancel={vi.fn()}
        onSaveDraft={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByText('3/9')).toBeTruthy();
  });
});