import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShipmentCreateSummary } from './ShipmentCreateSummary';
import type { ShipmentCreateIssue } from './shipment-create-model';

describe('ShipmentCreateSummary (card 181026180300)', () => {
  const issues: ShipmentCreateIssue[] = [
    { fieldId: 'shipment-customer', message: 'Chọn khách hàng.', sectionId: 'identity' },
    { fieldId: 'shipment-container-0-type', message: 'Container 1: chọn loại container.', sectionId: 'cargo' },
  ];

  it('renders completely hidden (null) on initial page open before save attempt', () => {
    const { container } = render(
      <ShipmentCreateSummary
        outstandingIssues={issues}
        showIssues={false}
        submitError={null}
        onFocusIssue={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Cần bổ sung/)).toBeNull();
  });

  it('renders completely hidden when showIssues is true but issue list is empty', () => {
    const { container } = render(
      <ShipmentCreateSummary
        outstandingIssues={[]}
        showIssues={true}
        submitError={null}
        onFocusIssue={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/Cần bổ sung/)).toBeNull();
  });

  it('renders compact neutral card when showIssues is true with issues', () => {
    const onFocusIssue = vi.fn();
    render(
      <ShipmentCreateSummary
        outstandingIssues={issues}
        showIssues={true}
        submitError={null}
        onFocusIssue={onFocusIssue}
      />
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('csc-validation-summary');
    expect(screen.getByText('Cần bổ sung 2 thông tin')).toBeInTheDocument();
    expect(screen.getByText('Chọn từng mục để chuyển đến trường cần sửa.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chọn khách hàng.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Container 1: chọn loại container.' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Chọn khách hàng.' }));
    expect(onFocusIssue).toHaveBeenCalledWith('shipment-customer');
  });

  it('renders submitError when present even if showIssues is false', () => {
    render(
      <ShipmentCreateSummary
        outstandingIssues={issues}
        showIssues={false}
        submitError="Lỗi kết nối máy chủ"
        onFocusIssue={vi.fn()}
      />
    );

    expect(screen.getByText('Lỗi kết nối máy chủ')).toBeInTheDocument();
    expect(screen.queryByText(/Cần bổ sung/)).toBeNull();
  });
});
