import { render, screen } from '@testing-library/react';
import type { NavigateFunction } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalQueueCard } from './ApprovalQueueCard';
import type { ApprovalQueueResponse } from '../hooks/useApprovalQueue';

const emptyQueue: ApprovalQueueResponse = {
  total: 0,
  byType: {
    ancillaryFees: 0,
    debtOffsets: 0,
    advances: 0,
    advanceSettlementsCheck: 0,
    advanceSettlementsApprove: 0,
  },
  items: [],
};

const navigate = vi.fn() as unknown as NavigateFunction;

describe('ApprovalQueueCard', () => {
  it('shows a distinct loading state without claiming the queue is cleared', () => {
    render(<ApprovalQueueCard data={emptyQueue} loading navigate={navigate} />);

    expect(screen.getByRole('status').textContent).toContain('Đang tải danh sách cần duyệt');
    expect(screen.queryByText('Không có gì cần duyệt')).toBeNull();
  });

  it('shows the cleared illustration only after an empty response resolves', () => {
    const { container } = render(
      <ApprovalQueueCard data={emptyQueue} loading={false} navigate={navigate} />,
    );

    expect(screen.getByText('Không có gì cần duyệt')).toBeTruthy();
    const illustration = container.querySelector<HTMLImageElement>('.approval-queue__empty-art');
    expect(illustration?.getAttribute('src')).toBe('/assets/illustrations/empty-approvals-cleared.webp');
    expect(illustration?.getAttribute('alt')).toBe('');
    expect(illustration?.getAttribute('aria-hidden')).toBe('true');
  });
});
