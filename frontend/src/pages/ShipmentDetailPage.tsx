import { Navigate, useParams } from 'react-router-dom';
import { Role } from '@tingting/shared';
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
  // SIL-706 (owner confirm 07/11, reversing SIL-688 r2 / ruling 3953):
  // Rút quyền XÓA + SỬA lô khỏi ĐIỀU VẬN.
  // Sửa lô: ADMIN, MANAGER, CUS. Xóa lô: CUS, ADMIN.
  const canEditLot = !!user?.role && (user.role === Role.ADMIN || user.role === Role.MANAGER || user.role === Role.CUS);
  const canDeleteLot = user?.role === Role.CUS || user?.role === Role.ADMIN;
  // SIL-453 (FB-098 restore, QA fail 06/11): the review page carries "Khai
  // chi phí" for exactly the BE expense-write trio (`requireExpenseFinance`
  // = ADMIN/MANAGER/ACCOUNTANT); the accounting-lock half is applied inside
  // the workspace once the detail lands (the card's "ẩn khi khóa kế toán").
  const canDeclareCost = !!user?.role && (user.role === Role.ADMIN || user.role === Role.MANAGER || user.role === Role.ACCOUNTANT);
  // SIL-720 (id 840): the per-container tờ khai writes under the SIL-551
  // writer law (the container-line command): ADMIN, MANAGER, CUS, ĐIỀU VẬN.
  // The accounting-lock half is applied inside the workspace once the detail
  // lands (a locked lot refuses every write).
  const canEditDeclaration = !!user?.role
    && (user.role === Role.ADMIN || user.role === Role.MANAGER || user.role === Role.CUS || user.role === Role.DISPATCHER);
  return <ShipmentCreateWorkspace viewTarget={{ shipmentId, canEditLot, canDeleteLot, canDeclareCost, canEditDeclaration }} />;
}
