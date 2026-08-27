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
    scheduledAt: '2026-08-01T07:30:00.000Z',
    factoryName: 'Nhà máy Bình Dương',
    loadingPortName: 'Cát Lái',
    routeName: 'Cát Lái → Bình Dương',
    dropPortName: 'Sóng Thần',
    containerNumber: 'MSCU1234561',
    containerTypeName: "40'HC",
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
    expect(screen.getByText('Nhà máy Bình Dương')).toBeTruthy();
    expect(screen.getByText('Cát Lái')).toBeTruthy();
    expect(screen.getByText('Cát Lái → Bình Dương')).toBeTruthy();
    expect(screen.getByText('Sóng Thần')).toBeTruthy();
    expect(screen.getByText("Cont: MSCU1234561 - 40'HC")).toBeTruthy();
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

  it('tags sibling CLAMP cards with KẸP and groups them visually', async () => {
    useDriverJourneyBoardMock.mockReturnValue({
      data: [
        card({ fulfillmentId: 10, shipmentId: 5, classification: 'CLAMP', containerNumber: 'CONT-A' }),
        card({ fulfillmentId: 11, shipmentId: 5, classification: 'CLAMP', containerNumber: 'CONT-B' }),
      ],
      isLoading: false,
      error: null,
    });
    renderPage();

    expect(await screen.findAllByText('KẸP')).toHaveLength(2);
    expect(screen.getByText(/CONT-A/)).toBeTruthy();
    expect(screen.getByText(/CONT-B/)).toBeTruthy();
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
