import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, Loader2, Package2, Phone, Route } from 'lucide-react';
import { useDriverJourneyBoard } from '../hooks/useDriverQueries';
import type { DriverJourneyCard } from '../api/driverClient';
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
    const key = card.linked ? `shipment:${card.shipmentId}` : `fulfillment:${card.fulfillmentId}`;
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

function JourneyCard({ card }: { card: DriverJourneyCard }) {
  const navigate = useNavigate();
  const tag = tagLabelFor(card);
  const isPaired = tag === 'KẸP' || tag === 'KẾT HỢP';
  const isNew = card.bucket === 'NEW';
  const footerLabel = isNew ? 'Xem chi tiết & Nhận lệnh' : 'Xem chi tiết';
  const hasContact = isPresent(card.contactName) || isPresent(card.contactPhone);
  const hasContainer = isPresent(card.containerNumber) || isPresent(card.sealNumber);

  /* Only facts that actually carry a value earn a slot. Dispatch fills the
     ports late, so on a history list nearly every card would otherwise spend
     two full rows rendering nothing but dashes. */
  const facts = [
    { label: 'Nâng', value: card.loadingPortName },
    { label: 'Hạ', value: card.dropPortName },
    { label: 'Đầu kéo', value: card.truckPlate },
    { label: 'Mooc', value: card.trailerPlate },
  ].filter((fact): fact is { label: string; value: string } => isPresent(fact.value));

  /* Spec A4 field order: Nhà máy → Tuyến đường → Người liên hệ → SĐT →
     Cont/Loại cont/Seal (1 line) → Càng Nâng → Cảng Hạ → Đầu kéo → Mooc.
     Order is preserved; the weight is not — the route is the one fact a driver
     scans a list for, so it leads as the card's headline and everything else
     ranks below it. Sections with nothing to say are omitted rather than
     rendered as a row of dashes. */
  return (
    <article className={`driver-journey-card${isPaired ? ' driver-journey-card--clamp' : ''}`}>
      <div className="driver-journey-card__header">
        <span className={`driver-journey-card__tag${isPaired ? ' driver-journey-card__tag--clamp' : ''}`}>
          {tag}
        </span>
        <span className="driver-journey-card__time">{formatCardTime(card.scheduledAt)}</span>
      </div>

      {/* No route name means no headline. A lone dash in the card's largest
          type reads as a title rather than as absent data; the ports below
          already say where the trip ran, and inventing a headline from them
          would conflate a named route with its lift/drop pair. */}
      {isPresent(card.routeName) ? (
        <p className="driver-journey-card__route">
          <Route size={16} aria-hidden="true" /> {card.routeName}
        </p>
      ) : null}

      {isPresent(card.factoryName) ? (
        <p className="driver-journey-card__factory">
          <Building2 size={13} aria-hidden="true" /> {card.factoryName}
        </p>
      ) : null}

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

      {facts.length > 0 ? (
        <div className="driver-journey-card__facts">
          {facts.map((fact) => (
            <JourneyFact key={fact.label} label={fact.label} value={fact.value} />
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className={`driver-journey-card__footer${isNew ? '' : ' driver-journey-card__footer--quiet'}`}
        onClick={() => navigate(`/my-trips/${card.fulfillmentId}`)}
      >
        <span>{footerLabel}</span>
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </article>
  );
}

export default function DriverTripsPage() {
  const [activeTab, setActiveTab] = useState<JourneyTabKey>('NEW');
  const { data, isLoading, error, refetch, isFetching } = useDriverJourneyBoard();

  const countsByBucket = useMemo(() => {
    const counts: Record<JourneyTabKey, number> = { NEW: 0, RUNNING: 0, HISTORY: 0 };
    for (const card of data ?? []) counts[card.bucket] += 1;
    return counts;
  }, [data]);

  const groupedCardsForTab = useMemo(() => {
    const cardsInTab = (data ?? []).filter((card) => card.bucket === activeTab);
    return groupCards(cardsInTab);
  }, [data, activeTab]);

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
                  <JourneyCard key={card.fulfillmentId} card={card} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
