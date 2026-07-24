import React from 'react';
import './TripChecklistPanel.css';
import { Check } from 'lucide-react';
import { useTripFormContext } from '../../hooks/useTripFormContext';

function stateClass(done: boolean, active: boolean): string {
  if (done) return 'tc-check-item--done';
  if (active) return 'tc-check-item--active';
  return '';
}

export function TripChecklistPanel() {
  const form = useTripFormContext();
  const { mainInfo, journey, fuelRevenue, images } = form.completionStatus;
  const mainInfoDone = mainInfo >= form.totalRequiredFields;
  const items = [
    { name: 'Thông tin chính', done: mainInfoDone, active: mainInfo > 0, badge: mainInfoDone ? '✓' : `${mainInfo}/${form.totalRequiredFields}`, badgeClass: mainInfoDone },
    { name: 'Hành trình chi tiết', done: journey >= 1, active: journey > 0, badge: journey >= 1 ? `${journey} chặng` : '0 chặng', badgeClass: journey >= 1 },
    { name: 'Nhiên liệu & doanh thu', done: fuelRevenue >= 5, active: fuelRevenue > 0, badge: `${fuelRevenue}/8`, badgeClass: fuelRevenue >= 5 },
    { name: 'Hình ảnh & ghi chú', done: images >= 1, active: images > 0, badge: images === 0 ? '—' : `${images}/2`, badgeClass: images >= 1 },
  ];

  return (
    <div className="tc-checklist">
      <h4 className="tc-checklist__title">Hoàn tất lệnh</h4>
      {items.map((item) => (
        <div key={item.name} className={`tc-check-item ${stateClass(item.done, item.active)}`}>
          <span className="tc-check-item__dot">
            {item.done && <Check size={10} />}
          </span>
          <span className="tc-check-item__name">{item.name}</span>
          <span className={`tc-check-item__badge ${item.badgeClass ? 'tc-check-item__badge--done' : 'tc-check-item__badge--pending'}`}>
            {item.badge}
          </span>
        </div>
      ))}
    </div>
  );
}
