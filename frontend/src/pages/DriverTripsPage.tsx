import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, Loader2, MapPinned, Package2, Phone, Route, Truck } from 'lucide-react';
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

function dash(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : '—';
}

function JourneyCard({ card }: { card: DriverJourneyCard }) {
  const navigate = useNavigate();
  const tag = tagLabelFor(card);
  const isPaired = tag === 'KẸP' || tag === 'KẾT HỢP';
  const footerLabel = card.bucket === 'NEW' ? 'Xem chi tiết & Nhận lệnh' : 'Xem chi tiết';
  return (
    <article className={`driver-journey-card${isPaired ? ' driver-journey-card--clamp' : ''}`}>
      <div className="driver-journey-card__header">
        <span className={`driver-journey-card__tag${isPaired ? ' driver-journey-card__tag--clamp' : ''}`}>
          {tag}
        </span>
        <span className="driver-journey-card__time">{formatCardTime(card.scheduledAt)}</span>
      </div>
      {/* Spec A4 field order: Nhà máy → Tuyến đường → Người liên hệ → SĐT →
          Cont/Loại cont/Seal (1 line) → Càng Nâng → Cảng Hạ → Đầu kéo → Mooc */}
      <div className="driver-journey-card__row">
        <span className="driver-journey-card__cell"><Building2 size={13} /> {dash(card.factoryName)}</span>
        <span className="driver-journey-card__cell driver-journey-card__cell--right"><Route size={13} /> {dash(card.routeName)}</span>
      </div>
      <div className="driver-journey-card__row">
        <span className="driver-journey-card__cell"><Phone size={13} /> {dash(card.contactName)}</span>
        <span className="driver-journey-card__cell driver-journey-card__cell--right">{dash(card.contactPhone)}</span>
      </div>
      <div className="driver-journey-card__container">
        <Package2 size={14} />
        <span>
          Cont: {card.containerNumber ?? '—'}
          {card.containerTypeName ? ` · ${card.containerTypeName}` : ''}
          {card.sealNumber ? ` · Seal ${card.sealNumber}` : ''}
        </span>
      </div>
      <div className="driver-journey-card__row">
        <span className="driver-journey-card__cell"><MapPinned size={13} /> Nâng: {dash(card.loadingPortName)}</span>
        <span className="driver-journey-card__cell driver-journey-card__cell--right"><MapPinned size={13} /> Hạ: {dash(card.dropPortName)}</span>
      </div>
      <div className="driver-journey-card__row">
        <span className="driver-journey-card__cell"><Truck size={13} /> Đầu: {dash(card.truckPlate)}</span>
        <span className="driver-journey-card__cell driver-journey-card__cell--right"><Truck size={13} /> Mooc: {dash(card.trailerPlate)}</span>
      </div>
      <button
        type="button"
        className="driver-journey-card__footer"
        onClick={() => navigate(`/my-trips/${card.fulfillmentId}`)}
      >
        <span>{footerLabel}</span>
        <ArrowRight size={16} />
      </button>
    </article>
  );
}

export default function DriverTripsPage() {
  const [activeTab, setActiveTab] = useState<JourneyTabKey>('NEW');
  const { data, isLoading, error } = useDriverJourneyBoard();

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
          <p className="driver-journey__error">Không thể tải hành trình. Vui lòng thử lại.</p>
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
