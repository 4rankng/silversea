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
    expect(DISPATCH_ISSUE_STATUS_LABELS.PLATED_NOT_ISSUED).toBe('Đã điều xe');
  });

  it('a live trip outranks the plate, and nothing renders before either', () => {
    expect(deriveDispatchIssueStatus({ vehicleAssigned: true, issued: true })).toBe('ISSUED');
    expect(deriveDispatchIssueStatus({ vehicleAssigned: false, issued: false })).toBe('UNASSIGNED');
    expect(DISPATCH_ISSUE_STATUS_LABELS.UNASSIGNED).toBe('Chưa điều xe');
    expect(deriveDispatchIssueStatus({ vehicleAssigned: true, issued: true, completed: true })).toBe('COMPLETED');
    expect(DISPATCH_ISSUE_STATUS_LABELS.COMPLETED).toBe('Đã hoàn thành');
  });

  it('driver acceptance refines ISSUED into ACCEPTED — no signal keeps the plain ISSUED reading', () => {
    expect(deriveDispatchIssueStatus({ vehicleAssigned: true, issued: true, driverAccepted: true })).toBe('ACCEPTED');
    expect(deriveDispatchIssueStatus({ vehicleAssigned: true, issued: true, driverAccepted: false })).toBe('ISSUED');
    expect(DISPATCH_ISSUE_STATUS_LABELS.ACCEPTED).toBe('Đã nhận lệnh');
  });
});

describe('DispatchIssueStatusChip', () => {
  it('renders the states with their labels', () => {
    const { rerender } = render(<DispatchIssueStatusChip status="PLATED_NOT_ISSUED" />);
    expect(screen.getByText('Đã điều xe')).toBeTruthy();
    rerender(<DispatchIssueStatusChip status="COMPLETED" />);
    expect(screen.getByText('Đã hoàn thành')).toBeTruthy();
  });
});

describe('DispatchIssueStatusSummaryChip', () => {
  it('stays hidden until something is plated, then distinguishes partial issuance', () => {
    const { container, rerender } = render(
      <DispatchIssueStatusSummaryChip plated={0} issued={0} total={2} />,
    );
    expect(container.textContent).toBe('');

    rerender(<DispatchIssueStatusSummaryChip plated={2} issued={0} total={2} />);
    expect(container.textContent).toBe('Đã điều xe');

    rerender(<DispatchIssueStatusSummaryChip plated={2} issued={1} total={2} />);
    expect(container.textContent).toBe('Đã phát lệnh 1/2 cont');

    rerender(<DispatchIssueStatusSummaryChip plated={2} issued={2} total={2} />);
    expect(container.textContent).toBe('Đã phát lệnh cho tài xế');
  });
});
