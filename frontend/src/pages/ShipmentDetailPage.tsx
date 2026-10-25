import { Navigate, useParams } from 'react-router-dom';
import { SHIPMENT_INTAKE_MUTATION_ROLES } from '@tingting/shared';
import { useAuth } from '../hooks/useAuth';
import { ShipmentCreateWorkspace } from '../features/shipments/create/ShipmentCreateWorkspace';

/**
 * SIL-481 (ruling owner 25/10): /shipments/:id is the POST-CREATE REVIEW —
 * "just post view action after create mới lô hàng". The page shows the SAME
 * Tạo lô hàng workspace as /shipments/new in VIEW mode: read-only pre-fill,
 * "Sửa" opens the SIL-171 edit form, "Quay lại" returns to the
 * list. One form layout everywhere (create → view → edit); no panels, no
 * second layout. Reached from the create flow's own landing (and legacy
 * links); the Tổng quan drawer deliberately does NOT navigate here.
 *
 * The role gate lives HERE because the workspace stays free of useAuth: the
 * shared SHIPMENT_INTAKE_MUTATION_ROLES authority (what PUT /shipments/:id
 * authorizes) may open the edit form. An invalid id lands on the list
 * instead of a broken form.
 */
export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const shipmentId = Number(id);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    return <Navigate to="/shipments" replace />;
  }
  const canEditLot = !!user?.role && SHIPMENT_INTAKE_MUTATION_ROLES.includes(user.role);
  return <ShipmentCreateWorkspace viewTarget={{ shipmentId, canEditLot }} />;
}
