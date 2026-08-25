import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DISPATCH_ISSUE_STATUS_LABELS,
  DispatchIssueStatusChip,
  DispatchIssueStatusSummaryChip,
  deriveDispatchIssueStatus,
} from './DispatchIssueStatus';

describe('deriveDispatchIssueStatus', () => {
  it('plates alone never read as issued — issuance is the only issued signal', () => {
    expect(deriveDispatchIssueStatus({ vehicleAssigned: true, issued: false })).toBe('PLATED_NOT_ISSUED');
    expect(DISPATCH_ISSUE_STATUS_LABELS.PLATED_NOT_ISSUED).toBe('Đã xếp xe — chưa phát lệnh');
  });

  it('a live trip outranks the plate, and nothing renders before either', () => {
    expect(deriveDispatchIssueStatus({ vehicleAssigned: true, issued: true })).toBe('ISSUED');
    expect(deriveDispatchIssueStatus({ vehicleAssigned: false, issued: false })).toBe('UNASSIGNED');
  });
});

describe('DispatchIssueStatusChip', () => {
  it('renders the three states with their labels', () => {
    render(<DispatchIssueStatusChip status="PLATED_NOT_ISSUED" />);
    expect(screen.getByText('Đã xếp xe — chưa phát lệnh')).toBeTruthy();
  });
});

describe('DispatchIssueStatusSummaryChip', () => {
  it('stays hidden until something is plated, then distinguishes partial issuance', () => {
    const { container, rerender } = render(
      <DispatchIssueStatusSummaryChip plated={0} issued={0} total={2} />,
    );
    expect(container.textContent).toBe('');

    rerender(<DispatchIssueStatusSummaryChip plated={2} issued={0} total={2} />);
    expect(container.textContent).toBe('Đã xếp xe — chưa phát lệnh');

    rerender(<DispatchIssueStatusSummaryChip plated={2} issued={1} total={2} />);
    expect(container.textContent).toBe('Đã phát lệnh 1/2 cont');

    rerender(<DispatchIssueStatusSummaryChip plated={2} issued={2} total={2} />);
    expect(container.textContent).toBe('Đã phát lệnh cho tài xế');
  });
});
