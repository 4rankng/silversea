import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, ChevronRight, Loader2, Package2, Route, Truck } from 'lucide-react';
import { useDriverJourneyBoard, useDriverTwoOrders } from '../hooks/useDriverQueries';
import { useMonth } from '../hooks/useMonth';
import { formatVietnamDateInput } from '../lib/shipment-operations';
import type { DriverJourneyCard } from '../api/driverJourneyBoard';
import { parseDriverTaskNote } from '@tingting/shared';
import { formatDateTimeShort } from '../lib/format';
import { PageHeader } from '../components/UI';
import { Badge } from '../components/shared';
import { EmptyState } from '../design-system';
import { Tabs } from '../design-system/Tabs';
import { driverLocationLabels } from '../features/driver/driver-display';
import './DriverTripsPage.css';

type JourneyTabKey = 'NEW' | 'RUNNING' | 'HISTORY';

const TABS: Array<{ key: JourneyTabKey; label: string }> = [
  { key: 'NEW', label: 'Lệnh mới' },
  { key: 'RUNNING', label: 'Đã nhận' },
  { key: 'HISTORY', label: 'Lịch sử' },
];

const EMPTY_MESSAGE: Record<JourneyTabKey, string> = {
  NEW: 'Chưa có lệnh mới nào được giao.',
  RUNNING: 'Không có chuyến nào đang chạy.',
  HISTORY: 'Chưa có chuyến nào trong lịch sử.',
};

/**
 * Second line of the illustrated empty state — names what will fill the tab,
 * so the face carries information and not only the absence of it.
 */
const EMPTY_HINT: Record<JourneyTabKey, string> = {
  NEW: 'Điều vận đẩy lệnh mới xuống ngay khi phân công xong.',
  RUNNING: 'Chuyến bạn đã nhận nằm ở đây cho tới khi hoàn thành.',
  HISTORY: 'Chuyến đã hoàn thành trong tháng được lưu ở đây.',
};

/**
 * Spec tag taxonomy: ĐƠN/KẸP/KẾT HỢP (+ LCL's LẺ). DOUBLE and COMBINED carry
 * their own label; a SINGLE-classified fulfillment riding a linked sibling
 * pair (the isCombined "kẹp" case — see driver-journey-board.service.ts)
 * reads as KẸP; an unlinked SINGLE is ĐƠN.
 */
function tagLabelFor(card: DriverJourneyCard): string {
  // An ACTIVE trip pair is the authoritative source for the tag (PRD §3.2:
  // tags are derived from the pair, not entered by hand); the shipment
  // classification only fills in when no pair stands.
  if (card.pairKind === 'KEP') return 'KẸP';
  if (card.pairKind === 'KET_HOP') return 'KẾT HỢP';
  if (card.classification === 'DOUBLE') return 'KẸP';
  if (card.classification === 'COMBINED') return 'KẾT HỢP';
  if (card.classification === 'LCL') return 'LẺ';
  return card.linked ? 'KẸP' : 'ĐƠN';
}

/**
 * Kẹp/kết hợp: linked cards (sibling fulfillments sharing one isCombined
 * shipment, or an expressively classified pair) render as separate, visually
 * stuck-together cards under one shared tag. Everything else is its own group
 * of one.
 */
function groupCards(cards: DriverJourneyCard[]): DriverJourneyCard[][] {
  const groups = new Map<string, DriverJourneyCard[]>();
  const order: string[] = [];
  for (const card of cards) {
    // A trip pair spans two shipments, so pair grouping must win over the
    // same-shipment (isCombined) grouping.
    const key = card.pairId != null
      ? `pair:${card.pairId}`
      : card.linked ? `shipment:${card.shipmentId}` : `fulfillment:${card.fulfillmentId}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(card);
  }
  return order.map((key) => groups.get(key)!);
}

/** Container-row 3rd column wording — shipments.trade_direction: EXPORT →
 *  ĐÓNG, IMPORT → TRẢ; unknown renders the em-dash, never a blank. */
const TRADE_DIRECTION_CARD_LABELS: Record<string, string> = {
  EXPORT: 'ĐÓNG',
  IMPORT: 'TRẢ',
};

function tradeDirectionLabel(card: DriverJourneyCard): string | null {
  return card.tradeDirection ? TRADE_DIRECTION_CARD_LABELS[card.tradeDirection] ?? null : null;
}

function isPresent(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function JourneyCard({ card, tagLabels }: { card: DriverJourneyCard; tagLabels: ReadonlyArray<string> }) {
  const navigate = useNavigate();
  const tag = tagLabelFor(card);
  const isPaired = tag === 'KẸP' || tag === 'KẾT HỢP';
  const isNew = card.bucket === 'NEW';
  const footerLabel = isNew ? 'Xem chi tiết & Nhận lệnh' : 'Xem chi tiết';
  const hasContainer = isPresent(card.containerNumber) || isPresent(card.sealNumber) || isPresent(card.containerTypeName);
  const locations = driverLocationLabels(card.tradeDirection, card.dropPortName, card.returnDepotName);
  const hasPorts = isPresent(card.loadingPortName) || isPresent(locations.drop) || isPresent(locations.delivery) || isPresent(locations.returnDepot) || card.tradeDirection === 'IMPORT';
  const tradeLabel = tradeDirectionLabel(card);
  const { selectedLabels: operationTags, manualText: operationManualText } = parseDriverTaskNote(card.operationalNotes, tagLabels);

  /* Ticket 365943ea field order: Nhà máy (top) → Tuyến đường → Cont →
     Cảng nâng / Cảng hạ → Tác vụ → Đầu kéo → Mooc.
     Factory name is the headline — the primary identifier a driver scans
     a 27-card history for. Route follows as the secondary line. Container
     and ports sit side-by-side per responsive-space-utilisation. */
  return (
    <article className={`driver-journey-card${isPaired ? ' driver-journey-card--clamp' : ''}`}>
      <div className="driver-journey-card__header">
        {/* CHIEF 26/09: drivers match shipments by SỐ BILL/BOOKING — the bill
            leads the card; the internal TRP code never renders (internal-ids
            law). One card rides one fulfillment, so one bill per card. */}
        {card.shipmentCode && (
          <span className="driver-journey-card__bill">{card.shipmentCode}</span>
        )}
        <span className={`driver-journey-card__tag${isPaired ? ' driver-journey-card__tag--clamp' : ''}`}>
          {tag}
        </span>
        {card.isAdHoc && <span className="adhoc-label" data-adhoc-label>Chạy ngoài</span>}
        <span className="driver-journey-card__time">
          <span className="driver-journey-card__time-label">Giờ đóng / trả:</span>
          {card.scheduledAt ? formatDateTimeShort(card.scheduledAt) : 'Chưa chốt lịch'}
        </span>
      </div>

      {/* 1. Factory name — top, headline */}
      {isPresent(card.factoryShortName || card.factoryName) ? (
        <p className="driver-journey-card__factory driver-journey-card__factory--headline">
          <Building2 size={16} aria-hidden="true" /> {card.factoryShortName || card.factoryName}
        </p>
      ) : null}

      {/* 2. Route — secondary line: the route NAME only, mirroring the
          detail page's route-only Tuyến row. The factory site address
          renders in the detail factory block, never on the compact card. */}
      {isPresent(card.routeName) ? (
        <p className="driver-journey-card__route">
          <Route size={13} aria-hidden="true" /> {card.routeName}
        </p>
      ) : null}

      {/* 3. Container + loại hình + 4. Ports — side-by-side block. The
          ĐÓNG/TRẢ pill rides the cont row as its 3rd column (em-dash when the
          shipment's trade direction is unknown) and stands alone when the card
          has no container data. A known type keeps the strip rendered while
          the number is still unassigned ("Chưa có số cont"). */}
      {(hasContainer || hasPorts || tradeLabel) ? (
        <div className="driver-journey-card__container-block">
          {hasContainer ? (
            <p className="driver-journey-card__container">
              <Package2 size={13} aria-hidden="true" />
              {isPresent(card.containerNumber) ? (
                <span className="driver-journey-card__cont-no">{card.containerNumber}</span>
              ) : (
                <span className="driver-journey-card__cont-pending">Chưa có số cont</span>
              )}
              {isPresent(card.containerTypeName) ? (
                <span className="driver-journey-card__cont-type">{card.containerTypeName}</span>
              ) : null}
              {/* 3rd column — trade-direction ĐÓNG/TRẢ, em-dash when unknown. */}
              <span className="driver-journey-card__cont-type" data-testid="load-type">{tradeLabel ?? '—'}</span>
              {isPresent(card.sealNumber) ? (
                <span className="driver-journey-card__seal">Seal {card.sealNumber}</span>
              ) : null}
            </p>
          ) : tradeLabel ? (
            <p className="driver-journey-card__container">
              <span className="driver-journey-card__cont-type" data-testid="load-type">{tradeLabel}</span>
            </p>
          ) : null}
          {hasPorts ? (
            <div className="driver-journey-card__ports">
              {isPresent(card.loadingPortName) ? (
                <span className="driver-journey-card__port">
                  <span className="driver-journey-card__port-label">Nâng</span> {card.loadingPortName}
                </span>
              ) : null}
              {isPresent(locations.drop) || card.tradeDirection === 'IMPORT' ? (
                <span className="driver-journey-card__port">
                  <span className="driver-journey-card__port-label">Hạ</span> {locations.drop ?? 'Chưa có nơi trả rỗng'}
                </span>
              ) : null}
              {isPresent(locations.delivery) ? (
                <span className="driver-journey-card__port">
                  <span className="driver-journey-card__port-label">Giao hàng</span> {locations.delivery}
                </span>
              ) : null}
              {isPresent(locations.returnDepot) ? (
                <span className="driver-journey-card__port">
                  <span className="driver-journey-card__port-label">Trả rỗng</span> {locations.returnDepot}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 5. Operation tasks (tác vụ) — chips from operationalNotes */}
      {operationTags.length > 0 ? (
        <div className="driver-journey-card__ops" aria-label="Tác vụ">
          <span className="driver-journey-card__port-label">Tác vụ</span>
          {operationTags.map((opTag) => (
            <span key={opTag} className="driver-journey-card__ops-tag">{opTag.toLocaleUpperCase('vi-VN')}</span>
          ))}
        </div>
      ) : null}
      {isPresent(operationManualText) ? (
        <p className="driver-journey-card__ops-note"><span className="driver-journey-card__port-label">Ghi chú</span>{' '}{operationManualText}</p>
      ) : null}

      {/* KẾT HỢP sequencing lock (TC-GHEP-010) */}
      {card.pairLocked ? (
        <p className="driver-journey-card__locked">
          Đang chờ Lệnh 1 hoàn thành trả hàng
        </p>
      ) : null}

      {/* 3a0bd5af: contact + Đầu kéo/Mooc rows dropped from the compact card
          (mockup image3 has neither) — the detail page carries full info. */}

      <button
        type="button"
        className={`driver-journey-card__footer${isNew ? '' : ' driver-journey-card__footer--quiet'}`}
        onClick={() => navigate(`/my-trips/${card.tripId}`)}
      >
        <span>{footerLabel}</span>
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </article>
  );
}

export default function DriverTripsPage() {
  const [activeTab, setActiveTab] = useState<JourneyTabKey>('NEW');
  const { month, year } = useMonth();
  const { data, isLoading, error, refetch, isFetching } = useDriverJourneyBoard();
  // Card 20260922_30(b): the M8.3 "Hai lệnh hôm nay" screen
  // (/my-trips/two-orders) had no inbound link anywhere in the app — only
  // tests reached it. It reads the same query key, so tapping through renders
  // from cache. The count promotes the entry exactly when the day carries the
  // 2+ orders the screen exists for; the entry itself stays put, because a
  // driver checks the day's sequence before dispatch pushes anything.
  const { data: dayView } = useDriverTwoOrders();
  const todayOrders = dayView?.allToday.length ?? 0;
  // Tag labels ride on the board response — the driver portal fetches nothing
  // from the dispatcher-only tag pool (ticket 53a536f9).
  const cards = useMemo(() => {
    const selectedMonth = `${year}-${String(month).padStart(2, '0')}`;
    return (data?.items ?? []).filter((card) => card.bucket !== 'HISTORY'
      || formatVietnamDateInput(card.historyAt ?? card.scheduledAt).startsWith(selectedMonth));
  }, [data?.items, month, year]);
  const tagLabels = data?.knownTagLabels ?? [];

  const countsByBucket = useMemo(() => {
    const counts: Record<JourneyTabKey, number> = { NEW: 0, RUNNING: 0, HISTORY: 0 };
    for (const card of cards) counts[card.bucket] += 1;
    return counts;
  }, [cards]);

  const groupedCardsForTab = useMemo(() => {
    const cardsInTab = cards.filter((card) => card.bucket === activeTab);
    return groupCards(cardsInTab);
  }, [cards, activeTab]);

  return (
    <div className="driver-journey">
      <PageHeader
        title="Hành trình của tôi"
        action={
          <Link className="driver-journey__day-view" to="/my-trips/two-orders">
            <Truck size={16} aria-hidden="true" />
            <span className="driver-journey__day-view-label">Hai lệnh hôm nay</span>
            {todayOrders >= 2 && <Badge>{todayOrders} lệnh</Badge>}
            <ChevronRight size={16} aria-hidden="true" />
          </Link>
        }
      />

      <Tabs
        className="driver-journey__tabs"
        ariaLabel="Trạng thái hành trình"
        variant="bordered"
        tabs={TABS.map((tab) => ({
          id: tab.key,
          // The shared Badge carries the count: the primitive's own count chip
          // floated above the label baseline and read as a superscript
          // (card 20260922_30).
          label: (
            <>
              {tab.label}
              <Badge>{countsByBucket[tab.key]}</Badge>
            </>
          ),
        }))}
        value={activeTab}
        onChange={(key) => setActiveTab(key as JourneyTabKey)}
      />

      <div className="driver-journey__panel" role="tabpanel" aria-label={TABS.find((tab) => tab.key === activeTab)?.label} tabIndex={0}>
        {isLoading ? (
          <p className="driver-journey__loading">
            <Loader2 size={16} className="spin" /> Đang tải hành trình…
          </p>
        ) : error ? (
          <div className="driver-journey__error" role="alert">
            <p>Không thể tải hành trình. Vui lòng thử lại.</p>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              Thử lại
            </button>
          </div>
        ) : groupedCardsForTab.length === 0 ? (
          <EmptyState
            className="driver-journey__empty"
            context="trips"
            title={activeTab === 'HISTORY' ? `Chưa có chuyến trong tháng ${month}/${year}.` : EMPTY_MESSAGE[activeTab]}
            description={EMPTY_HINT[activeTab]}
            action={
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => void refetch()}
                disabled={isFetching}
              >
                {isFetching ? 'Đang tải…' : 'Tải lại'}
              </button>
            }
          />
        ) : (
          <div className="driver-journey__list">
            {groupedCardsForTab.map((group) => (
              <div
                key={group.map((card) => card.fulfillmentId).join('-')}
                className={group.length > 1 ? 'driver-journey-group driver-journey-group--clamp' : 'driver-journey-group'}
              >
                {group.map((card) => (
                  <JourneyCard key={card.fulfillmentId} card={card} tagLabels={tagLabels} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
