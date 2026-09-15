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
    returnDepotName: null,
    containerNumber: 'MSCU1234561',
    containerTypeName: "40'HC",
    sealNumber: 'SL001',
    loadingType: null,
    tradeDirection: null,
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

  it('POLISH-DRV-02 keeps journey tabs keyboard reachable and labels the visible panel', () => {
    useDriverJourneyBoardMock.mockReturnValue(board([
      card({ fulfillmentId: 1, bucket: 'NEW' }),
      card({ fulfillmentId: 2, bucket: 'RUNNING' }),
      card({ fulfillmentId: 3, bucket: 'HISTORY' }),
    ]));
    renderPage();
    const first = screen.getByRole('tab', { name: /Lệnh mới/ });
    const running = screen.getByRole('tab', { name: /Đã nhận/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(running).toHaveFocus();
    expect(running).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel', { name: 'Đã nhận' })).toBeVisible();
    fireEvent.keyDown(running, { key: 'End' });
    expect(screen.getByRole('tab', { name: /Lịch sử/ })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Lịch sử' })).toBeVisible();
  });

  it('renders the card time VN-pinned — a 17:30Z trip reads 00:30 on the NEXT day', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([card({ scheduledAt: '2026-09-06T17:30:00.000Z' })]));
    renderPage();

    expect(await screen.findByText('00:30 - 07/09')).toBeTruthy();
  });

  it('VID-DRV-05 clearly identifies an unconfirmed schedule instead of an ambiguous dash', () => {
    useDriverJourneyBoardMock.mockReturnValue(board([card({ scheduledAt: null })]));
    renderPage();
    expect(screen.getByText('Chưa chốt lịch')).toBeTruthy();
  });

  it('renders the Trả rỗng port line when the card carries a distinct return depot', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([card({ returnDepotName: 'Bãi JJ LOGISTICS' })]));
    renderPage();

    const depotLine = await screen.findByText(/Bãi JJ LOGISTICS/);
    expect(depotLine.textContent).toContain('Trả rỗng');
  });

  it.each([
    ['Bãi trả rỗng', 'Nhà máy nhận hàng', 'Bãi trả rỗng', true],
    ['Cùng một cảng', 'Cùng một cảng', 'Cùng một cảng', true],
    [null, 'Nhà máy nhận hàng', 'Chưa có nơi trả rỗng', true],
  ])('DRV-R02 IMPORT uses canonical return port %s without a duplicate return row', (depot, delivery, expected, showDelivery) => {
    useDriverJourneyBoardMock.mockReturnValue(board([card({ tradeDirection: 'IMPORT', returnDepotName: depot, dropPortName: delivery })]));
    renderPage();
    const drop = screen.getByText('Hạ').parentElement!;
    expect(drop.textContent).toBe(`Hạ ${expected}`);
    expect(screen.queryByText('Trả rỗng')).toBeNull();
    expect(Boolean(screen.queryByText('Giao hàng'))).toBe(showDelivery);
    if (showDelivery) expect(screen.getByText('Giao hàng').parentElement!.textContent).toBe(`Giao hàng ${delivery}`);
  });

  it('DRV-R01 keeps uppercase tasks and multiline driver notes on separate rows', () => {
    useDriverJourneyBoardMock.mockReturnValue(board([card({ operationalNotes: 'Đảo vỏ; Kiểm hóa\nGọi chị An trước khi đến\nKiểm tra seal tại kho' })], ['Đảo vỏ', 'Kiểm hóa']));
    const { container } = renderPage();
    const tasks = container.querySelector('.driver-journey-card__ops')!;
    expect(tasks.textContent).toBe('Tác vụĐẢO VỎKIỂM HÓA');
    const note = container.querySelector('.driver-journey-card__ops-note')!;
    expect(note.textContent).toBe('Ghi chú Gọi chị An trước khi đến\nKiểm tra seal tại kho');
    expect(note.previousElementSibling).toBe(tasks);
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

    // Card time is pinned to Vietnam wall-clock (Asia/Ho_Chi_Minh) — the
    // assertion is a fixed string, NOT device-local, so a runner in any
    // timezone proves the pin: 07:30Z = 14:30 VN on 01/08.
    const expectedTime = '14:30 - 01/08';

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

  it('navigates to the trip detail by TRIP id when a card footer is pressed (20260915_1)', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([card({ tripId: 55, fulfillmentId: 42 })]));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Xem chi tiết & Nhận lệnh/ }));
    // Card 20260915_1: the detail route carries the TRIP id; the page resolves
    // fulfillmentId from the trip payload (works for ad-hoc trips too).
    expect(navigateMock).toHaveBeenCalledWith('/my-trips/55');
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

  // Container-row 3rd column: ĐÓNG/TRẢ from shipments.trade_direction
  // (EXPORT → ĐÓNG, IMPORT → TRẢ, unknown → em-dash). The leg handling-type
  // loadingType is a DIFFERENT axis and must not drive the pill.
  it('renders the ĐÓNG / TRẢ pill from tradeDirection with an em-dash fallback', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([
      card({ fulfillmentId: 1, tradeDirection: 'EXPORT' }),
      card({ fulfillmentId: 2, tradeDirection: 'IMPORT' }),
      // Axis guard: a loadingType without a trade direction still shows '—'.
      card({ fulfillmentId: 3, loadingType: 'HANG', tradeDirection: null }),
    ]));
    renderPage();

    expect(await screen.findByText('ĐÓNG')).toBeTruthy();
    expect(screen.getByText('TRẢ')).toBeTruthy();
    const pills = screen.getAllByTestId('load-type');
    expect(pills).toHaveLength(3);
    expect(pills[2].textContent).toBe('—');
  });

  // The pill also surfaces on the Đã nhận tab (same card component) — and
  // stands alone without a cont (number, seal AND type all unknown, else the
  // known type would keep the strip rendered).
  it('shows the TRẢ pill on an accepted cont-less card', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([
      card({ fulfillmentId: 7, bucket: 'RUNNING', tradeDirection: 'IMPORT', containerNumber: null, sealNumber: null, containerTypeName: null }),
    ]));
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: /Đã nhận/ }));
    expect(await screen.findByText('TRẢ')).toBeTruthy();
    expect(screen.getAllByTestId('load-type')).toHaveLength(1);
  });

  // Unassigned number with a known type: the strip still renders — the type
  // carries the container identity and the concise pending label holds the
  // number slot until dispatch saves one.
  it('renders the container type with "Chưa có số cont" while the number is unassigned', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([
      card({ containerNumber: null, sealNumber: null, containerTypeName: "40'HC", tradeDirection: 'EXPORT' }),
    ]));
    renderPage();

    expect(await screen.findByText('Chưa có số cont')).toBeTruthy();
    expect(screen.getByText("40'HC")).toBeTruthy();
    expect(screen.queryByText(/MSCU1234561/)).toBeNull();
    // The pill rides the strip as its 3rd column while the number is pending.
    expect(screen.getAllByTestId('load-type')).toHaveLength(1);
    expect(screen.getByTestId('load-type').textContent).toBe('ĐÓNG');
  });

  // Honest empty state: number AND type unknown → no identifier strip at
  // all — a pending label alone would promise a type that doesn't exist.
  it('renders no container strip when both number and type are unknown', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([
      card({ containerNumber: null, sealNumber: null, containerTypeName: null }),
    ]));
    renderPage();

    await screen.findByText(/Nhà máy Bình Dương/);
    expect(screen.queryByText('Chưa có số cont')).toBeNull();
    expect(document.querySelector('.driver-journey-card__container')).toBeNull();
    // tradeDirection is null on this card → not even the pill-only row.
    expect(screen.queryByTestId('load-type')).toBeNull();
  });

  // Criteria 1+2: the factory abbreviation is a bold standalone header and
  // the ROUTE a standalone line right under it — no inline "NHÀ MÁY:"/
  // "TUYẾN:" label prefixes, and never the factory street address (that
  // renders in the detail factory block, not on the compact card).
  it('renders factory as the bold standalone header and route as its own line', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([
      card({
        factoryShortName: 'ASKEY-2',
        factoryName: 'Công ty TNHH Askey - Nhà máy 2',
        factoryAddress: 'Đường HS7, KCN Việt Nam - Singapore II',
        routeName: 'Cát Lái → Bình Dương',
      }),
    ]));
    renderPage();

    const factory = await screen.findByText(/ASKEY-2/);
    const header = factory.closest('.driver-journey-card__factory--headline');
    expect(header).toBeTruthy();
    expect(header!.textContent).not.toContain('NHÀ MÁY:');

    const route = document.querySelector('.driver-journey-card__route');
    expect(route).toBeTruthy();
    expect(route!.textContent).toContain('Cát Lái → Bình Dương');
    expect(route!.textContent).not.toContain('Đường HS7');
    // The street address renders nowhere on the card at all.
    expect(screen.queryByText(/Đường HS7/)).toBeNull();
  });

  // Criterion 4: the ports row carries the NÂNG/HẠ labels with the lift and
  // drop port names beside them.
  it('renders the NÂNG/HẠ ports row with lift and drop port names', async () => {
    useDriverJourneyBoardMock.mockReturnValue(board([card({})]));
    renderPage();

    const lift = await screen.findByText('Nâng');
    expect(lift.closest('.driver-journey-card__port')!.textContent).toContain('Cát Lái');
    const drop = screen.getByText('Hạ');
    expect(drop.closest('.driver-journey-card__port')!.textContent).toContain('Sóng Thần');
  });
});
