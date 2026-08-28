import type { ZoneTruckPresenceItem } from '../../../api/dispatchPlanningClient';
// Styles live with the component so every host page (master plan + detail plan)
// loads them — DetailedPlanGrid.css is only bundled on /dispatch-detail.
import './ZoneTruckPresencePanel.css';

const REASON_LABELS: Record<'D-1_DROP' | 'D+1_PICKUP', string> = {
  'D-1_DROP': 'Hạ D-1',
  'D+1_PICKUP': 'Lấy D+1',
};

/**
 * Advisory strip: OWN trucks with work in the selected zone around the viewing
 * date (dropoff D-1 / pickup D+1). Clicking a chip narrows the grid search to
 * that plate so the dispatcher can pair zone orders onto the truck. Read-only
 * — it never gates eligibility or mutates the plan.
 */
export function ZoneTruckPresencePanel({
  items,
  zoneLabel,
  date,
  onSelectPlate,
}: {
  items: ZoneTruckPresenceItem[];
  /** Operator-facing zone label from the DB taxonomy. */
  zoneLabel: string;
  date: string | null;
  onSelectPlate: (plate: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="zone-presence-panel" aria-label={`Xe tại ${zoneLabel}`}>
      <div className="zone-presence-panel__head">
        <span className="zone-presence-panel__title">Xe tại {zoneLabel}</span>
        {date && <span className="zone-presence-panel__date">quanh ngày {date}</span>}
      </div>
      <div className="zone-presence-panel__chips" role="list">
        {items.map((item) => {
          const reasons = [...new Set(item.evidence.map((evidence) => evidence.reason))];
          return (
            <button
              key={item.truckId}
              type="button"
              className="zone-presence-panel__chip"
              role="listitem"
              onClick={() => onSelectPlate(item.plateNumber)}
              title={item.evidence
                .map((evidence) => `${REASON_LABELS[evidence.reason]} · ${evidence.containerNumber ?? ''} · ${evidence.portName}`)
                .join('\n')}
            >
              <span className="zone-presence-panel__plate">{item.plateNumber}</span>
              {reasons.map((reason) => (
                <span key={reason} className={`zone-presence-panel__tag zone-presence-panel__tag--${reason.toLowerCase()}`}>
                  {REASON_LABELS[reason]}
                </span>
              ))}
              <span className="zone-presence-panel__count">{item.evidence.length}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
