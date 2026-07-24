import './TripLegsPanel.css';

interface TripLeg {
  id: number;
  sequence: number;
  origin: string;
  destination: string;
  km: number;
  loadingType: string;
}

interface TripLegsPanelProps {
  legs: TripLeg[];
  emptyMessage?: string;
}

function loadingTypeLabel(t: string) {
  if (t === 'HANG') return 'Có hàng';
  if (t === 'VO') return 'Vỏ rỗng';
  return t;
}

export default function TripLegsPanel({ legs, emptyMessage = 'Chưa có thông tin hành trình' }: TripLegsPanelProps) {
  if (legs.length === 0) {
    return (
      <div className="panel trip-legs">
        <div className="panel__head">
          <span className="trip-legs__title">Hành trình chi tiết</span>
        </div>
        <div className="trip-legs__empty">{emptyMessage}</div>
      </div>
    );
  }

  // Build unique stop list: first origin, then each leg's destination
  const stops: { name: string; legAfter?: TripLeg }[] = [
    { name: legs[0].origin, legAfter: legs[0] },
    ...legs.slice(1).map(leg => ({ name: leg.origin, legAfter: leg })),
    { name: legs[legs.length - 1].destination },
  ];
  const lastIdx = stops.length - 1;

  return (
    <div className="panel trip-legs">
      <div className="panel__head">
        <span className="trip-legs__title">Hành trình chi tiết</span>
        <span className="trip-legs__count">{legs.length} chặng</span>
      </div>
      <div className="trip-legs__body">
        {stops.map((stop, idx) => (
          <div key={idx} className="trip-legs__stop">
            {/* Timeline track */}
            <div className="trip-legs__track">
              <div
                className={`trip-legs__dot ${
                  idx === 0 ? 'trip-legs__dot--origin' :
                  idx === lastIdx ? 'trip-legs__dot--dest' :
                  'trip-legs__dot--mid'
                }`}
              />
              {idx < lastIdx && <div className="trip-legs__line" />}
            </div>

            {/* Stop content */}
            <div className="trip-legs__content">
              <div className="trip-legs__stop-name">{stop.name}</div>

              {/* Leg info between stops */}
              {stop.legAfter && (
                <div className="trip-legs__leg">
                  <span className="trip-legs__km">{stop.legAfter.km} km</span>
                  <span className={`trip-legs__badge ${
                    stop.legAfter.loadingType === 'HANG'
                      ? 'trip-legs__badge--loaded'
                      : 'trip-legs__badge--empty'
                  }`}>
                    {loadingTypeLabel(stop.legAfter.loadingType)}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
