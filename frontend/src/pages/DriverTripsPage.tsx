import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, Loader2, Package2, Pencil, Route } from 'lucide-react';
import { useDriverJourneyBoard } from '../hooks/useDriverQueries';
import { useMonth } from '../hooks/useMonth';
import { formatVietnamDateInput } from '../lib/shipment-operations';
import type { DriverJourneyCard, DriverJourneyCardContainer } from '../api/driverJourneyBoard';
import { parseDriverTaskNote } from '@tingting/shared';
import { formatDateTimeShort, formatWeight } from '../lib/format';
import { PageHeader } from '../components/UI';
import { EmptyState } from '../design-system';
import { Tabs } from '../design-system/Tabs';
import { driverLocationLabels } from '../features/driver/driver-display';
import { tagLabelFor } from '../features/driver/driver-trip-model';
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

function JourneyCard({ card, tagLabels, pairSize }: { card: DriverJourneyCard; tagLabels: ReadonlyArray<string>; pairSize: number }) {
  const navigate = useNavigate();
  const tag = tagLabelFor(card);
  const isPaired = tag === 'KẸP' || tag === 'KẾT HỢP';
  const isNew = card.bucket === 'NEW';
  const footerLabel = isNew ? 'Xem chi tiết & Nhận lệnh' : 'Xem chi tiết';
  // SIL-815 — the strip list is the trip's own containers (the exact list the
  // Chi tiết lệnh screen renders): one strip per container so a multi-cont
  // trip shows every number its detail shows. The singular fields mirror the
  // first entry (older cached boards without `containers` render identically).
  const containerStrips: DriverJourneyCardContainer[] = card.containers?.length
    ? card.containers
    : [{
      containerNumber: card.containerNumber,
      containerTypeName: card.containerTypeName,
      sealNumber: card.sealNumber,
      cargoWeightKg: card.cargoWeightKg,
    }];
  const renderedStrips = containerStrips.filter((cont) =>
    isPresent(cont.containerNumber) || isPresent(cont.sealNumber) || isPresent(cont.containerTypeName));
  const hasContainer = renderedStrips.length > 0;
  // K10.22 (SIL-947, KB §10.4.5): a trip carrying 2+ containers (the ghép-kẹp
  // clamp) renders ONE CARD PER CONTAINER — each with number/type/seal/weight
  // and its own "Sửa số cont i/n" affordance. Single-cont cards keep the
  // compact strip. Editing is a live-order affordance: completed/cancelled
  // (HISTORY) and pair-locked (read-only per TC8) cards show none — the
  // backend rejects container edits on closed trips anyway.
  const isMultiCont = renderedStrips.length >= 2;
  const canEditContainers = card.bucket !== 'HISTORY' && !card.pairLocked;
  // K10.22 (SIL-947, KB §10.4.5): "2 thẻ liền kề có dấu hiệu cùng cặp" —
  // a Kẹp pair's two cards carry their position in the pair ("Cặp 1/2"),
  // so the driver reads them as ONE load (two boxes) instead of two
  // unrelated orders. KẾT HỢP pairs are the same box on two legs, not two
  // boxes, so they carry no pair position.
  const pairBadge = card.pairKind === 'KEP' && card.pairOrder != null
    ? `Cặp ${card.pairOrder}/${Math.max(2, pairSize)}`
    : null;
  const locations = driverLocationLabels(card.tradeDirection, card.dropPortName, card.returnDepotName);
  /* Card 121026141020 (FB-082 retest): no "Giao hàng" chip here. The delivery
     destination is the factory, and the card's headline row already names it;
     a chip fed from the drop chain could only repeat the Hạ chip beside it. */
  const hasPorts = isPresent(card.loadingPortName) || isPresent(locations.drop) || isPresent(locations.returnDepot) || card.tradeDirection === 'IMPORT';
  const tradeLabel = tradeDirectionLabel(card);
  // Bill/booking is the driver-facing document identity (CHIEF 26/09). When no
  // document was captured the chip says so: the internal SHP-YYMM-NNNNN
  // shipment code is a system key and never titles a driver screen — the same
  // rule DriverTripHeader already applies on the detail screen (card
  // 20260927_1). Mirrors the app-wide "Chưa có Bill/Booking" pending copy.
  const billLabel = card.blNumber || card.bookingRef || 'Chưa có Bill/Booking';
  const billPending = !card.blNumber && !card.bookingRef;
  // Card 261022201006c: the app lái xe BỎ hiển thị mã chuyến (REQ-07 cũ) —
  // bill/booking is the only trip identity a driver sees. The tripCode field
  // stays on the wire (detail-screen board matching); nothing renders it here.
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
            law). One card rides one fulfillment, so one bill per card. The
            shipment code is a system key too, so a card whose documents were
            never filled in states the gap instead of leaking it. */}
        <span className={`driver-journey-card__bill${billPending ? ' driver-journey-card__bill--pending' : ''}`}>
          {billLabel}
        </span>
        {/* SIL-636 — the pair tag moves from the header to the container row
            (ruling: tag cạnh số container) whenever the card carries a
            container strip; the header slot is the fallback so a card with
            no container data never loses the tag. Rendered once either way. */}
        {!hasContainer && (
          <span className={`driver-journey-card__tag${isPaired ? ' driver-journey-card__tag--clamp' : ''}`}>
            {tag}
          </span>
        )}
        {card.isAdHoc && <span className="adhoc-label" data-adhoc-label>Chạy ngoài</span>}
        <span className="driver-journey-card__time">
          {/* Round-17 sweep (mislabeled time column): this chip renders
              trips.plannedStartAt — the planned run start, "Giờ chạy" in the
              dispatch vocabulary. The old "Giờ đóng / trả" label named the
              container-appointment concept (customerAppointmentAt, "Giờ hẹn
              đóng/trả" on the CUS ledger), telling the driver the box
              closes/returns at a time that is actually the truck's departure.
              The label now names the field it renders; the appointment lives
              in the detail screen's "Ngày giờ kế hoạch" block. */}
          <span className="driver-journey-card__time-label">Giờ chạy:</span>
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

      {/* 3. Container + loại hình + 4. Ports — side-by-side block. A known
          type keeps the strip rendered while the number is still unassigned
          ("Chưa có số cont"). */}
      {(hasContainer || hasPorts || tradeLabel) ? (
        <div className="driver-journey-card__container-block">
          {hasContainer && isMultiCont ? (
            /* K10.22 (SIL-947, KB §10.4.5): a Kẹp trip with 2+ own containers
                renders ONE CARD PER CONTAINER — number + type + seal + weight
                on each, the pair tag on EVERY sub-card ("2 thẻ liền kề có
                dấu hiệu cùng cặp"), and each carries its own "Sửa số cont
                i/n" button (deep-links to the trip detail with ?cont=N so
                the driver lands on that exact container row). */
            <div className="driver-journey-card__cont-cards" data-testid="driver-journey-cont-cards">
              {renderedStrips.map((cont, index) => (
                <div
                  className={`driver-journey-cont-card${isPaired ? ' driver-journey-cont-card--clamp' : ''}`}
                  key={`cont-card-${index}`}
                  data-testid={`driver-journey-cont-card-${index}`}
                >
                  <div className="driver-journey-cont-card__head">
                    <span className="driver-journey-card__pair-badge">Cặp {index + 1}/{renderedStrips.length}</span>
                    <span className={`driver-journey-card__tag${isPaired ? ' driver-journey-card__tag--clamp' : ''}`}>
                      {tag}
                    </span>
                  </div>
                  <div className="driver-journey-cont-card__no">
                    <Package2 size={13} aria-hidden="true" />
                    {isPresent(cont.containerNumber) ? cont.containerNumber : 'Chưa có số cont'}
                  </div>
                  <div className="driver-journey-cont-card__meta">
                    {isPresent(cont.containerTypeName) ? (
                      <span className="driver-journey-card__cont-type">{cont.containerTypeName}</span>
                    ) : null}
                    {/* SIL-733 (standard CUS-08) — payload formatted in tons */}
                    {isPresent(cont.cargoWeightKg) ? (
                      <span className="driver-journey-card__cont-weight" data-testid="cont-weight">{formatWeight(cont.cargoWeightKg)}</span>
                    ) : null}
                    {isPresent(cont.sealNumber) ? (
                      <span className="driver-journey-card__seal">Seal {cont.sealNumber}</span>
                    ) : (
                      /* KB §10.4.5: each per-container card names seal +
                         weight — a missing seal states the gap (DRI-04
                         named-fallback law) instead of a silent hole. */
                      <span className="driver-journey-cont-card__pending">Chưa có số chì</span>
                    )}
                  </div>
                  {canEditContainers ? (
                    <button
                      type="button"
                      className="driver-journey-cont-card__edit"
                      data-testid={`driver-journey-cont-edit-${index}`}
                      onClick={() => navigate(`/my-trips/${card.tripId}?cont=${index + 1}`)}
                    >
                      <Pencil size={12} aria-hidden="true" />
                      Sửa số cont {index + 1}/{renderedStrips.length}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : hasContainer ? renderedStrips.map((cont, index) => (
            <p className="driver-journey-card__container" key={`cont-${index}`}>
              <Package2 size={13} aria-hidden="true" />
              {isPresent(cont.containerNumber) ? (
                <span className="driver-journey-card__cont-no">{cont.containerNumber}</span>
              ) : (
                <span className="driver-journey-card__cont-pending">Chưa có số cont</span>
              )}
              {/* SIL-636 — pair tag rides the container number (ruling:
                  "tag [KẸP] cạnh số container, trên cả 2 thẻ của cặp").
                  The flex strip wraps cleanly at 390px. One tag per card —
                  it rides the FIRST strip (SIL-815). Single-cont strips
                  only: a multi-cont trip renders the per-container cards
                  above, which each carry the tag. */}
              {index === 0 && (
                <span className={`driver-journey-card__tag${isPaired ? ' driver-journey-card__tag--clamp' : ''}`}>
                  {tag}
                </span>
              )}
              {/* K10.22 (SIL-947, KB §10.4.5): the pair position rides the
                  container strip beside the KẸP tag — the two adjacent cards of
                  a Kẹp pair read as one load ("Cặp 1/2" / "Cặp 2/2"). */}
              {index === 0 && pairBadge ? (
                <span className="driver-journey-card__pair-badge" data-testid="pair-badge">{pairBadge}</span>
              ) : null}
              {isPresent(cont.containerTypeName) ? (
                <span className="driver-journey-card__cont-type">{cont.containerTypeName}</span>
              ) : null}
              {/* SIL-733 (standard CUS-08) — payload formatted in tons (e.g. "12 tấn") */}
              {isPresent(cont.cargoWeightKg) ? (
                <span className="driver-journey-card__cont-weight" data-testid="cont-weight">{formatWeight(cont.cargoWeightKg)}</span>
              ) : null}
              {isPresent(cont.sealNumber) ? (
                <span className="driver-journey-card__seal">Seal {cont.sealNumber}</span>
              ) : null}
            </p>
          )) : null}
          {/* SIL-797 (KB Ch4 §4.2.2) — nhiệm vụ viết hoa TRÊN DÒNG RIÊNG: the
              ĐÓNG/TRẢ pill left the container strip (it rode that line as a
              3rd column, reading as part of "CONT [KẸP] 20'RF 12 tấn"). The
              task is the run's order, not container data, so it owns the line
              between the cont strip and the ports. Em-dash fallback kept for
              container cards (unknown direction still names the column); a
              container-less card with no direction renders no bare-dash line. */}
          {(hasContainer || tradeLabel) ? (
            <p className="driver-journey-card__task">
              <span className="driver-journey-card__task-pill" data-testid="load-type">{tradeLabel ?? '—'}</span>
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
                  <span className="driver-journey-card__port-label">Hạ</span> {locations.drop ?? 'Chưa có nơi hạ'}
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
      {/* K10.19 (SIL-946, KB §10.4.2 ⑥): nhiệm vụ/ghi chú owns a line on
          EVERY card — with no dispatch note it names the gap ("Chưa có ghi
          chú") instead of silently omitting the row. */}
      <p className="driver-journey-card__ops-note" data-testid="driver-journey-card-note">
        <span className="driver-journey-card__port-label">Ghi chú</span>
        {' '}{isPresent(operationManualText) ? operationManualText : 'Chưa có ghi chú'}
      </p>

      {/* SIL-638 TC8: locked Lệnh 2 card — DOC sentence; its footer below stays hidden (read-only). */}
      {card.pairLocked ? (
        <p className="driver-journey-card__locked">Cần hoàn thành trả hàng lệnh trước để mở khóa</p>
      ) : null}

      {/* 3a0bd5af: contact + Đầu kéo/Mooc rows dropped from the compact card
          (mockup image3 has neither) — the detail page carries full info. */}

      {/* SIL-638 TC8: locked card = read-only, no action footer (TC4 keeps it on active cards). */}
      {!card.pairLocked && (
        <button
          type="button"
          className={`driver-journey-card__footer${isNew ? '' : ' driver-journey-card__footer--quiet'}`}
          onClick={() => navigate(`/my-trips/${card.tripId}`)}
        >
          <span>{footerLabel}</span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      )}
    </article>
  );
}

export default function DriverTripsPage() {
  const [activeTab, setActiveTab] = useState<JourneyTabKey>('NEW');
  const { month, year } = useMonth();
  const { data, isLoading, error, refetch, isFetching } = useDriverJourneyBoard();
  // SIL-672: this board IS the driver's day view — the tabs + in-day cards
  // already carry today's Lệnh mới / Đã nhận / Lịch sử. The former header
  // shortcut labelled "Lệnh trong ngày" only redirected to /my-trips/paired-
  // orders (the paired-orders screen), which duplicated the name and read as
  // "no orders" on days without a persisted pair. The shortcut is removed per
  // the ticket ruling; paired-orders stays reachable by direct URL and the
  // /my-trips/two-orders redirect, and its screen is named "Lệnh ghép".
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
      <PageHeader title="Hành trình của tôi" />

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
              {/* Plain count text — the shared Badge's status dot reads as a
                  black blob jammed against a tab label (Chief 26/09). */}
              <span className="driver-journey__tab-count">{countsByBucket[tab.key]}</span>
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
                  <JourneyCard key={card.fulfillmentId} card={card} tagLabels={tagLabels} pairSize={group.length} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
