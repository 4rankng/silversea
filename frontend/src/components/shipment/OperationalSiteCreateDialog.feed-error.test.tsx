import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OperationalSiteCreateDialog } from './OperationalSiteCreateDialog';

describe('OperationalSiteCreateDialog feed error states (card 20261004_337 Group 1)', () => {
  it('renders an explicit Alert with retry button and disables the select when customers feed fails', () => {
    const onRetry = vi.fn();
    render(
      <OperationalSiteCreateDialog
        isOpen
        customers={[]}
        customersError={true}
        onRetryCustomers={onRetry}
        routes={[{ id: 1, name: 'Tuyến Hải Phòng - Bắc Ninh' }]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh sách khách hàng.');
    const retryBtn = screen.getByRole('button', { name: 'Thử lại' });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);

    const customerSelect = screen.getByRole('button', { name: /Khách hàng/i });
    expect(customerSelect).toBeDisabled();
  });

  it('renders an explicit Alert with retry button and disables the route select when routes feed fails', () => {
    const onRetry = vi.fn();
    render(
      <OperationalSiteCreateDialog
        isOpen
        customerId={10}
        routes={[]}
        routesError={true}
        onRetryRoutes={onRetry}
        defaultSiteType="FACTORY"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh sách tuyến đường.');
    const retryBtn = screen.getByRole('button', { name: 'Thử lại' });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);

    const routeSelect = screen.getByRole('button', { name: /Lỗi tải danh sách tuyến đường/i });
    expect(routeSelect).toBeDisabled();
  });

  it('keeps the plain picker render when both feeds are healthy', () => {
    render(
      <OperationalSiteCreateDialog
        isOpen
        customers={[{ id: 9, name: 'Công ty Biển Bạc' }]}
        routes={[{ id: 11, name: 'Tuyến Kiểm thử' }]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
