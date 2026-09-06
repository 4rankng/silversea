import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverJourneyCard } from '../api/driverClient';

const { useDriverJourneyBoardMock, navigateMock } = vi.hoisted(() => ({
  useDriverJourneyBoardMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../hooks/useDriverQueries', () => ({
  useDriverJourneyBoard: useDriverJourneyBoardMock,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

import DriverTripsPage from './DriverTripsPage';

function card(overrides: Partial<DriverJourneyCard> = {}): DriverJourneyCard {
  return {
    fulfillmentId: 88,
    tripId: 55,
    shipmentId: 1,
    tripCode: 'TRIP-55',
    shipmentCode: 'SHP-1',
    bucket: 'NEW',
    classification: 'SINGLE',
    linked: false,
    scheduledAt: '2026-08-01T07:30:00.000Z',
    factoryName: 'Nhà máy Bình Dương',
    loadingPortName: 'Cát Lái',
    routeName: 'Cát Lái → Bình Dương',
    dropPortName: 'Sóng Thần',
    containerNumber: 'MSCU1234561',
    containerTypeName: "40'HC",
    sealNumber: 'SL001',
    contactName: 'Nguyễn Văn A',
    contactPhone: '0901234567',
    truckPlate: '51C-12345',
    trailerPlate: '51R-67890',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<DriverTripsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DriverTripsPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  it('shows the New Orders tab by default with tab counts', async () => {
    useDriverJourneyBoardMock.mockReturnValue({
      data: [card({ fulfillmentId: 1, bucket: 'NEW' }), card({ fulfillmentId: 2, bucket: 'RUNNING' }), card({ fulfillmentId: 3, bucket: 'HISTORY' })],
      isLoading: false,
      error: null,
    });
    renderPage();

    expect(await screen.findByText('Nhà máy Bình Dương')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Lệnh mới/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders each Layer-1 card field per the spec layout', async () => {
    useDriverJourneyBoardMock.mockReturnValue({
      data: [card()],
      isLoading: false,
      error: null,
    });
    renderPage();

    const scheduled = new Date('2026-08-01T07:30:00.000Z');
    const expectedTime = `${String(scheduled.getHours()).padStart(2, '0')}:${String(scheduled.getMinutes()).padStart(2, '0')}`
      + ` - ${String(scheduled.getDate()).padStart(2, '0')}/${String(scheduled.getMonth() + 1).padStart(2, '0')}`;

    expect(await screen.findByText('ĐƠN')).toBeTruthy();
    expect(screen.getByText(expectedTime)).toBeTruthy();
    expect(screen.getByText(/Nhà máy Bình Dương/)).toBeTruthy();
    expect(screen.getByText(/Cát Lái → Bình Dương/)).toBeTruthy();
    expect(screen.getByText(/Nguyễn Văn A/)).toBeTruthy();
    expect(screen.getByText(/0901234567/)).toBeTruthy();
    expect(screen.getByText(/MSCU1234561/)).toBeTruthy();
    expect(screen.getByText(/Seal SL001/)).toBeTruthy();
    expect(screen.getByText(/51C-12345/)).toBeTruthy();
    expect(screen.getByText(/51R-67890/)).toBeTruthy();
  });

  it('navigates to the fulfillment detail page when a card footer is pressed', async () => {
    useDriverJourneyBoardMock.mockReturnValue({
      data: [card({ fulfillmentId: 42 })],
      isLoading: false,
      error: null,
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Xem chi tiết & Nhận lệnh/ }));
    expect(navigateMock).toHaveBeenCalledWith('/my-trips/42');
  });

  it('tags sibling linked cards with KẸP and groups them visually', async () => {
    useDriverJourneyBoardMock.mockReturnValue({
      data: [
        card({ fulfillmentId: 10, shipmentId: 5, linked: true, containerNumber: 'CONT-A' }),
        card({ fulfillmentId: 11, shipmentId: 5, linked: true, containerNumber: 'CONT-B' }),
      ],
      isLoading: false,
      error: null,
    });
    renderPage();

    expect(await screen.findAllByText('KẸP')).toHaveLength(2);
    expect(screen.getByText(/CONT-A/)).toBeTruthy();
    expect(screen.getByText(/CONT-B/)).toBeTruthy();
  });

  it('tags COMBINED classifications as KẾT HỢP and LCL as LẺ', async () => {
    useDriverJourneyBoardMock.mockReturnValue({
      data: [
        card({ fulfillmentId: 20, classification: 'COMBINED' }),
        card({ fulfillmentId: 21, classification: 'LCL' }),
      ],
      isLoading: false,
      error: null,
    });
    renderPage();

    expect(await screen.findByText('KẾT HỢP')).toBeTruthy();
    expect(screen.getByText('LẺ')).toBeTruthy();
  });

  it('shows "Xem chi tiết & Nhận lệnh" footer on all cards per spec', async () => {
    useDriverJourneyBoardMock.mockReturnValue({
      data: [card({ fulfillmentId: 30, bucket: 'RUNNING' }), card({ fulfillmentId: 31, bucket: 'HISTORY' })],
      isLoading: false,
      error: null,
    });
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: /Đã nhận/ }));
    expect(await screen.findByRole('button', { name: /Xem chi tiết & Nhận lệnh/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Lịch sử/ }));
    expect(await screen.findByRole('button', { name: /Xem chi tiết & Nhận lệnh/ })).toBeTruthy();
  });

  it('shows the empty-state message when a tab has no cards', async () => {
    useDriverJourneyBoardMock.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });
    renderPage();

    expect(await screen.findByText(/Chưa có lệnh mới nào được giao\./)).toBeTruthy();
  });

  it('switches tabs and shows the Running bucket', async () => {
    useDriverJourneyBoardMock.mockReturnValue({
      data: [card({ fulfillmentId: 1, bucket: 'NEW', factoryName: 'Nhà máy A' }), card({ fulfillmentId: 2, bucket: 'RUNNING', factoryName: 'Nhà máy B' })],
      isLoading: false,
      error: null,
    });
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: /Đã nhận/ }));
    expect(await screen.findByText('Nhà máy B')).toBeTruthy();
    expect(screen.queryByText('Nhà máy A')).toBeNull();
  });
});
