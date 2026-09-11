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

/** The board wire shape: cards + the embedded tag pool (ticket 53a536f9). */
function board(cards: DriverJourneyCard[], knownTagLabels: string[] = []) {
  return { data: { items: cards, knownTagLabels }, isLoading: false, error: null };
}

function card(overrides: Partial<DriverJourneyCard> = {}): DriverJourneyCard {
  return {
    fulfillmentId: 88,
    tripId: 55,
    shipmentId: 1,
    tripCode: 'TRIP-55',
    shipmentCode: 'SHP-1',
    isAdHoc: false,
    bucket: 'NEW',
    classification: 'SINGLE',
    pairId: null,
    pairKind: null,
    pairOrder: null,
    pairLocked: false,
    linked: false,
    scheduledAt: '2026-08-01T07:30:00.000Z',
    factoryName: 'Nhà máy Bình Dương',
    factoryShortName: null,
    factoryAddress: null,
    loadingPortName: 'Cát Lái',
    routeName: 'Cát Lái → Bình Dương',
    dropPortName: 'Sóng Thần',
    containerNumber: 'MSCU1234561',
    containerTypeName: "40'HC",
    sealNumber: 'SL001',
    loadingType: null,
    contactName: 'Nguyễn Văn A',
    contactPhone: '0901234567',
    truckPlate: '51C-12345',
    trailerPlate: '51R-67890',
    operationalNotes: null,
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
    useDriverJourneyBoardMock.mockReturnValue(board([card({ fulfillmentId: 1, bucket: 'NEW' }), card({ fulfillmentId: 2, bucket: 'RUNNING' }), card({ fulfillmentId: 3, bucket: 'HISTORY' })]));
    renderPage();

    expect(await screen.findByText('Nhà máy Bình Dương')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Lệnh mới/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders each Layer-1 card field per the spec layout', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([card()]));
    renderPage();

    const scheduled = new Date('2026-08-01T07:30:00.000Z');
    const expectedTime = `${String(scheduled.getHours()).padStart(2, '0')}:${String(scheduled.getMinutes()).padStart(2, '0')}`
      + ` - ${String(scheduled.getDate()).padStart(2, '0')}/${String(scheduled.getMonth() + 1).padStart(2, '0')}`;

    expect(await screen.findByText('ĐƠN')).toBeTruthy();
    expect(screen.getByText('Giờ đóng / trả:')).toBeTruthy();
    expect(screen.getByText(expectedTime)).toBeTruthy();
    expect(screen.getByText(/Nhà máy Bình Dương/)).toBeTruthy();
    expect(screen.getByText(/Cát Lái → Bình Dương/)).toBeTruthy();
    // Compact card per mockup: contact + Đầu kéo/Mooc live on the detail
    // page, not the Layer-1 card.
    expect(screen.queryByText(/Nguyễn Văn A/)).toBeNull();
    expect(screen.queryByText(/0901234567/)).toBeNull();
    expect(screen.queryByText(/51C-12345/)).toBeNull();
    expect(screen.queryByText(/51R-67890/)).toBeNull();
    expect(screen.getByText(/MSCU1234561/)).toBeTruthy();
    expect(screen.getByText(/Seal SL001/)).toBeTruthy();
  });

  it('navigates to the fulfillment detail page when a card footer is pressed', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([card({ fulfillmentId: 42 })]));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Xem chi tiết & Nhận lệnh/ }));
    expect(navigateMock).toHaveBeenCalledWith('/my-trips/42');
  });

  it('tags sibling linked cards with KẸP and groups them visually', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([
      card({ fulfillmentId: 10, shipmentId: 5, linked: true, containerNumber: 'CONT-A' }),
      card({ fulfillmentId: 11, shipmentId: 5, linked: true, containerNumber: 'CONT-B' }),
    ]));
    renderPage();

    expect(await screen.findAllByText('KẸP')).toHaveLength(2);
    expect(screen.getByText(/CONT-A/)).toBeTruthy();
    expect(screen.getByText(/CONT-B/)).toBeTruthy();
  });

  it('tags COMBINED classifications as KẾT HỢP and LCL as LẺ', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([
      card({ fulfillmentId: 20, classification: 'COMBINED' }),
      card({ fulfillmentId: 21, classification: 'LCL' }),
    ]));
    renderPage();

    expect(await screen.findByText('KẾT HỢP')).toBeTruthy();
    expect(screen.getByText('LẺ')).toBeTruthy();
  });

  it('shows the KẾT HỢP sequencing lock note on the second card until Lệnh 1 completes', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([
      card({ fulfillmentId: 60, pairId: 7, pairKind: 'KET_HOP', pairOrder: 1, pairLocked: false }),
      card({ fulfillmentId: 61, pairId: 7, pairKind: 'KET_HOP', pairOrder: 2, pairLocked: true }),
    ]));
    renderPage();

    expect(await screen.findAllByText('KẾT HỢP')).toHaveLength(2);
    expect(screen.getByText('Đang chờ Lệnh 1 hoàn thành trả hàng')).toBeTruthy();
  });

  it('labels ad-hoc lots "Chạy ngoài" next to the tag and leaves regular lots unlabeled', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([
      card({ fulfillmentId: 30, isAdHoc: true }),
      card({ fulfillmentId: 31, isAdHoc: false }),
    ]));
    renderPage();

    expect(await screen.findByText('Chạy ngoài')).toBeTruthy();
    expect(screen.getAllByText('Chạy ngoài')).toHaveLength(1);
  });

  it('footer CTA follows the card bucket per the prod mockup (8d8e224a)', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([card({ fulfillmentId: 30, bucket: 'RUNNING' }), card({ fulfillmentId: 31, bucket: 'HISTORY' }), card({ fulfillmentId: 32, bucket: 'NEW' })]));
    renderPage();

    // NEW cards carry the accept CTA; accepted/history cards show plain detail.
    expect(await screen.findByRole('button', { name: /Xem chi tiết & Nhận lệnh/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Đã nhận/ }));
    expect(await screen.findByRole('button', { name: /^Xem chi tiết$/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Lịch sử/ }));
    expect(await screen.findByRole('button', { name: /^Xem chi tiết$/ })).toBeTruthy();
  });

  it('renders operation task chips from the board-embedded tag pool', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board(
      [card({ operationalNotes: 'ĐẶT ĐẦU; ĐẢO VỎ; ghi chú thêm' })],
      ['ĐẶT ĐẦU', 'ĐẢO VỎ'],
    ));
    renderPage();

    expect(await screen.findByText('ĐẶT ĐẦU')).toBeTruthy();
    expect(screen.getByText('ĐẢO VỎ')).toBeTruthy();
    // Free text renders as a separate line, not a chip
    expect(screen.getByText('ghi chú thêm')).toBeTruthy();
  });

  it('renders v2 two-line notes as chips + free text (851e8f7d)', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board(
      [card({ operationalNotes: 'ĐẶT ĐẦU; ĐẢO VỎ\nvào kho mang mũ bảo hộ, cân tại cầu 3' })],
      ['ĐẶT ĐẦU', 'ĐẢO VỎ'],
    ));
    renderPage();

    expect(await screen.findByText('ĐẶT ĐẦU')).toBeTruthy();
    expect(screen.getByText('ĐẢO VỎ')).toBeTruthy();
    // The free-text line renders without the tag line glued to it.
    expect(screen.getByText('vào kho mang mũ bảo hộ, cân tại cầu 3')).toBeTruthy();
    expect(screen.queryByText(/ĐẶT ĐẦU; ĐẢO VỖ/)).toBeNull();
  });

  it('hides operation tasks section when operationalNotes is null', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([card({ operationalNotes: null })]));
    renderPage();

    await screen.findByText('Nhà máy Bình Dương');
    expect(screen.queryByText('ĐẶT ĐẦU')).toBeNull();
  });

  it('prefers factoryShortName over factoryName when present', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([card({ factoryName: 'Nhà máy Rất Dài Hà Nội', factoryShortName: 'Hà Nội' })]));
    renderPage();

    expect(await screen.findByText('Hà Nội')).toBeTruthy();
    expect(screen.queryByText('Nhà máy Rất Dài Hà Nội')).toBeNull();
  });

  it('shows the empty-state message when a tab has no cards', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([]));
    renderPage();

    expect(await screen.findByText(/Chưa có lệnh mới nào được giao\./)).toBeTruthy();
  });

  it('switches tabs and shows the Running bucket', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([card({ fulfillmentId: 1, bucket: 'NEW', factoryName: 'Nhà máy A' }), card({ fulfillmentId: 2, bucket: 'RUNNING', factoryName: 'Nhà máy B' })]));
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: /Đã nhận/ }));
    expect(await screen.findByText('Nhà máy B')).toBeTruthy();
    expect(screen.queryByText('Nhà máy A')).toBeNull();
  });

  // 3a0bd5af: the HÀNG ĐÓNG/TRẢ pill rides the cont row (mockup col 3).
  it('3a0bd5af: renders the Hàng đóng / Hàng trả pill from loadingType', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([
      card({ fulfillmentId: 1, loadingType: 'HANG' }),
      card({ fulfillmentId: 2, loadingType: 'VO' }),
      card({ fulfillmentId: 3, loadingType: null }),
    ]));
    renderPage();

    expect(await screen.findByText('Hàng đóng')).toBeTruthy();
    expect(screen.getByText('Hàng trả')).toBeTruthy();
    const pills = screen.getAllByTestId('load-type');
    expect(pills).toHaveLength(2);
  });

  // 3a0bd5af: the badge also surfaces on the Đã nhận tab (same card component,
  // mockup: loại hình on the accepted card) — and stands alone without a cont.
  it('3a0bd5af: shows the Hàng trả pill on an accepted cont-less card', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([
      card({ fulfillmentId: 7, bucket: 'RUNNING', loadingType: 'VO', containerNumber: null, sealNumber: null }),
    ]));
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: /Đã nhận/ }));
    expect(await screen.findByText('Hàng trả')).toBeTruthy();
    expect(screen.getAllByTestId('load-type')).toHaveLength(1);
  });
});
