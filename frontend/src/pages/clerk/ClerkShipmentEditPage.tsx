import { Navigate, useParams } from 'react-router-dom';
import { ShipmentCreateWorkspace } from '../../features/shipments/create/ShipmentCreateWorkspace';

/**
 * SIL-171 (FB-147): /shipments/:id/edit — the "Sửa lô" surface. The SAME
 * Tạo lô hàng workspace in edit mode (same fields, same layout, same
 * validation; submit PATCHes the lot). An invalid id lands on the detail
 * route's own not-found handling instead of a broken form.
 */
export default function ClerkShipmentEditPage() {
  const { id } = useParams<{ id: string }>();
  const shipmentId = Number(id);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    return <Navigate to="/shipments" replace />;
  }
  return <ShipmentCreateWorkspace editTarget={{ shipmentId }} />;
}
