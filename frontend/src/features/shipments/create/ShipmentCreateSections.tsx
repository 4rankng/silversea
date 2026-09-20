import type { CSSProperties, ReactNode } from 'react';
import type { ShipmentCreateSectionId } from './shipment-create-model';

interface ShipmentCreateSectionProps {
  id: ShipmentCreateSectionId;
  title: string;
  description?: string;
  /** Right-aligned compact control on the heading row (e.g. the ad-hoc lot toggle). */
  actions?: ReactNode;
  children: ReactNode;
}

/** Semantic, focusable form section shared by the shipment-create workspace. */
export function ShipmentCreateSection({ id, title, description, actions, children }: ShipmentCreateSectionProps) {
  return (
    <section id={`shipment-section-${id}`} tabIndex={-1} className="csc-section" style={sectionStyle}>
      <div className="csc-section__heading">
        <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
        {actions && <div className="csc-section__actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export const shipmentCreateGridStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 12, minWidth: 0,
};

const sectionStyle: CSSProperties = {
  borderRadius: 12, padding: 16,
  display: 'grid', gap: 12, background: 'var(--surface-1)', minWidth: 0,
};
