import React from 'react';
import { Receipt } from 'lucide-react';
import { AncillaryFeesCard } from '../../../components/trip/AncillaryFeesCard';

interface ServiceCostsCardProps {
  tripId: number;
  readOnly: boolean;
}

export function ServiceCostsCard({ tripId, readOnly }: ServiceCostsCardProps) {
  return (
    <section className="card service-card anim d4">
      <div className="card-head">
        <h2>
          <span className="hicon hicon--sm"><Receipt size={14} /></span>
          Dịch vụ đi kèm
          <span className="sub sub--inline">
            • Lên giấy báo nợ và công nợ phải thu
          </span>
        </h2>
      </div>
      <div className="card-body">
        <AncillaryFeesCard tripId={tripId} readOnly={readOnly} />
      </div>
    </section>
  );
}
