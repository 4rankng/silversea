// Customer feedback 2026-09-07 (BL `JJCTCHPDY260305`): the inline warning
// below Bill/Booking/declaration fields. Lives outside the workspace to
// keep the file under its frozen structure-guard ceiling.
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ShipmentReferenceConflict } from '../../../api/shipmentDuplicateClient';

interface ShipmentReferenceConflictWarningProps {
  conflict: ShipmentReferenceConflict | undefined;
  /** "Số Bill" / "Số Booking" / "Số tờ khai" — what the user just typed. */
  fieldLabel: string;
}

export function ShipmentReferenceConflictWarning({ conflict, fieldLabel }: ShipmentReferenceConflictWarningProps) {
  if (!conflict) return null;
  const actor = conflict.createdBy?.username ?? 'tài khoản khác';
  const createdAt = new Date(conflict.createdAt);
  const atLabel = Number.isNaN(createdAt.getTime())
    ? ''
    : `${createdAt.toLocaleDateString('vi-VN')} ${createdAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
  return (
    <>
      <AlertTriangle size={14} aria-hidden="true" />
      <span>
        {fieldLabel} <strong>{conflict.reference}</strong> đã được nhập bởi <strong>{actor}</strong>
        {atLabel && <> lúc <strong>{atLabel}</strong></>}. Không thể tạo lô trùng.
      </span>
      <Link
        to={`/shipments/${conflict.shipmentId}`}
        className="csc-field-warning__link"
        target="_blank"
        rel="noopener"
      >
        Xem lô đã nhập
      </Link>
    </>
  );
}
