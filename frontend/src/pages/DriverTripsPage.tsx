import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, Loader2, Package2, Phone, Route } from 'lucide-react';
import { useDriverJourneyBoard } from '../hooks/useDriverQueries';
import type { DriverJourneyCard } from '../api/driverClient';
import { parseNote } from '../lib/dispatchTaskTags';
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

function formatCardTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  return `${hh}:${mm} - ${dd}/${mo}`;
}

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

function isPresent(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function dash(value: string | null | undefined): string {
  return isPresent(value) ? value : '—';
}

/**
 * Labelled cell in the card's fact grid. The label carries the field name so
 * the value can stand alone as data.
 */
function JourneyFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="driver-journey-fact">
      <span className="driver-journey-fact__label">{label}</span>
      <span className="driver-journey-fact__value">{value}</span>
    </div>
  );
}

function JourneyCard({ card, tagLabels }: { card: DriverJourneyCard; tagLabels: ReadonlyArray<string> }) {
  const navigate = useNavigate();
  const tag = tagLabelFor(card);
  const isPaired = tag === 'KẸP' || tag === 'KẾT HỢP';
  const hasContact = isPresent(card.contactName) || isPresent(card.contactPhone);
  const hasContainer = isPresent(card.containerNumber) || isPresent(card.sealNumber);
  const hasPorts = isPresent(card.loadingPortName) || isPresent(card.dropPortName);
  const { selectedLabels: operationTags, manualText: operationManualText } = parseNote(card.operationalNotes, tagLabels);

  /* Remaining facts: truck and trailer. Ports are rendered alongside the
     container per the responsive-space-utilisation contract. */
  const facts = [
    { label: 'Đầu kéo', value: card.truckPlate },
    { label: 'Mooc', value: card.trailerPlate },
  ].filter((fact): fact is { label: string; value: string } => isPresent(fact.value));

  /* Ticket 365943ea field order: Nhà máy (top) → Tuyến đường → Cont →
     Cảng nâng / Cảng hạ → Tác vụ → Đầu kéo → Mooc.
     Factory name is the headline — the primary identifier a driver scans
     a 27-card history for. Route follows as the secondary line. Container
     and ports sit side-by-side per responsive-space-utilisation. */
  return (
    <article className={`driver-journey-card${isPaired ? ' driver-journey-card--clamp' : ''}`}>
      <div className="driver-journey-card__header">
        <span className={`driver-journey-card__tag${isPaired ? ' driver-journey-card__tag--clamp' : ''}`}>
          {tag}
        </span>
        {card.isAdHoc && <span className="adhoc-label" data-adhoc-label>Chạy ngoài</span>}
        <span className="driver-journey-card__time">
          <span className="driver-journey-card__time-label">Giờ đóng / trả:</span>
          {formatCardTime(card.scheduledAt)}
        </span>
      </div>

      {/* 1. Factory name — top, headline */}
      {isPresent(card.factoryShortName || card.factoryName) ? (
        <p className="driver-journey-card__factory driver-journey-card__factory--headline">
          <Building2 size={16} aria-hidden="true" /> {card.factoryShortName || card.factoryName}
        </p>
      ) : null}

      {/* 2. Route — secondary line */}
      {isPresent(card.routeName) ? (
        <p className="driver-journey-card__route">
          <Route size={13} aria-hidden="true" /> {card.routeName}
        </p>
      ) : null}

      {/* 3. Container + 4. Ports — side-by-side block */}
      {(hasContainer || hasPorts) ? (
        <div className="driver-journey-card__container-block">
          {hasContainer ? (
            <p className="driver-journey-card__container">
              <Package2 size={13} aria-hidden="true" />
              <span className="driver-journey-card__cont-no">{dash(card.containerNumber)}</span>
              {isPresent(card.containerTypeName) ? (
                <span className="driver-journey-card__cont-type">{card.containerTypeName}</span>
              ) : null}
              {isPresent(card.sealNumber) ? (
                <span className="driver-journey-card__seal">Seal {card.sealNumber}</span>
              ) : null}
            </p>
          ) : null}
          {hasPorts ? (
            <div className="driver-journey-card__ports">
              {isPresent(card.loadingPortName) ? (
                <span className="driver-journey-card__port">
                  <span className="driver-journey-card__port-label">Nâng</span> {card.loadingPortName}
                </span>
              ) : null}
              {isPresent(card.dropPortName) ? (
                <span className="driver-journey-card__port">
                  <span className="driver-journey-card__port-label">Hạ</span> {card.dropPortName}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 5. Operation tasks (tác vụ) — chips from operationalNotes */}
      {operationTags.length > 0 ? (
        <div className="driver-journey-card__ops">
          {operationTags.map((opTag) => (
            <span key={opTag} className="driver-journey-card__ops-tag">{opTag}</span>
          ))}
        </div>
      ) : null}
      {isPresent(operationManualText) ? (
        <p className="driver-journey-card__ops-note">{operationManualText}</p>
      ) : null}

      {/* Contact */}
      {hasContact ? (
        <p className="driver-journey-card__contact">
          <Phone size={13} aria-hidden="true" /> {dash(card.contactName)}
          {isPresent(card.contactPhone) ? (
            <a
              className="driver-journey-card__phone"
              href={`tel:${card.contactPhone}`}
              onClick={(event) => event.stopPropagation()}
            >
              {card.contactPhone}
            </a>
          ) : null}
        </p>
      ) : null}

      {/* KẾT HỢP sequencing lock (TC-GHEP-010) */}
      {card.pairLocked ? (
        <p className="driver-journey-card__locked">
          Đang chờ Lệnh 1 hoàn thành trả hàng
        </p>
      ) : null}

      {/* Truck / trailer */}
      {facts.length > 0 ? (
        <div className="driver-journey-card__facts">
          {isPresent(card.truckPlate) && <JourneyFact label="Đầu kéo" value={card.truckPlate} />}
          {isPresent(card.trailerPlate) && <JourneyFact label="Mooc" value={card.trailerPlate} />}
        </div>
      ) : null}

      <button
        type="button"
        className="driver-journey-card__footer"
        onClick={() => navigate(`/my-trips/${card.fulfillmentId}`)}
      >
        <span>Xem chi tiết & Nhận lệnh</span>
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </article>
  );
}

export default function DriverTripsPage() {
  const [activeTab, setActiveTab] = useState<JourneyTabKey>('NEW');
  const { data, isLoading, error, refetch, isFetching } = useDriverJourneyBoard();
  // Tag labels ride on the board response — the driver portal fetches nothing
  // from the dispatcher-only tag pool (ticket 53a536f9).
  const cards = data?.items ?? [];
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
      <div className="driver-journey__tabs" role="tablist" aria-label="Trạng thái hành trình">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={activeTab === tab.key ? 'is-active' : ''}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}<span>{countsByBucket[tab.key]}</span>
          </button>
        ))}
      </div>

      <div className="driver-journey__panel" role="tabpanel">
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
          <p className="driver-journey__empty">{EMPTY_MESSAGE[activeTab]}</p>
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
