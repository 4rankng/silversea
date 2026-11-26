import type { Customer, Port, Route } from '@tingting/shared';
import type { OperationalSite } from '../../../api/shipmentClient';
import type { CatalogData } from '../../../api/tripClient';
import { OperationalSiteDetailsDialog } from '../../../components/shipment/OperationalSiteDetailsDialog';
import { OperationalSiteCreateDialog } from '../../../components/shipment/OperationalSiteCreateDialog';
import { ShippingLineAddDialog } from './ShippingLineAddDialog';
import { RouteCreateDialog } from './RouteCreateDialog';
import { PortCreateDialog } from './PortCreateDialog';
import { CustomerCreateDialog } from './CustomerCreateDialog';
import { Modal } from '../../../components/UI';
import type { CargoMode, ShipmentContainerDraft } from './shipment-create-model';

export interface ShipmentCreateModalsProps {
  detailSite: OperationalSite | null;
  onCloseDetailSite: () => void;
  createSiteDialog: { open: boolean; siteType: 'FACTORY' | 'WAREHOUSE' };
  /** Card 181026143000 §1a: kho dialog title follows the lot's direction. */
  tradeDirection: 'IMPORT' | 'EXPORT' | '';
  customerId: string;
  /** Card 211026130115: picker-mode options for a customerId-less quick-add. */
  customers: Array<{ id: number; name: string }>;
  routes: CatalogData['routes'] | Route[];
  onCloseCreateSite: () => void;
  onSiteCreated: (site: OperationalSite) => void;
  onRouteCreatedInSite: (route: Route) => void;
  shippingLineDialogOpen: boolean;
  currentShippingLineName: string;
  onCloseShippingLineDialog: () => void;
  onApplyShippingLine: (name: string) => Promise<void>;
  routeDialogOpen: boolean;
  onCloseRouteDialog: () => void;
  onRouteCreated: (route: Route) => void;
  routeDialogInitialName: string;
  portDialog: { open: boolean; target: { key: string; field: 'pickupPortId' | 'dropoffPortId'; name: string } | null };
  onClosePortDialog: () => void;
  onPortCreated: (port: Port) => void;
  customerDialogOpen: boolean;
  onCloseCustomerDialog: () => void;
  onCustomerCreated: (customer: Customer) => void;
  backConfirmOpen: boolean;
  onCloseBackConfirm: () => void;
  onDiscardAndGoBack: () => void;
  pendingModeSwitch: CargoMode | null;
  onClosePendingModeSwitch: () => void;
  onConfirmModeSwitch: () => void;
  pendingContainerDelete: ShipmentContainerDraft | null;
  onClosePendingContainerDelete: () => void;
  onConfirmContainerDelete: () => void;
  /** SIL-688 (id 800 — QA 06/11): the review page's Xóa lô confirm — a
   *  destructive action with its own confirm + REQUIRED reason (the BE
   *  answers 400 without one), danger voice, never auto-armed. */
  deleteLotOpen: boolean;
  deleteReason: string;
  onDeleteReasonChange: (reason: string) => void;
  deleteLotError: string | null;
  deleteLotSubmitting: boolean;
  onCloseDeleteLot: () => void;
  onConfirmDeleteLot: () => void;
}

export function ShipmentCreateModals({
  detailSite,
  onCloseDetailSite,
  createSiteDialog,
  tradeDirection,
  customerId,
  customers,
  routes,
  onCloseCreateSite,
  onSiteCreated,
  onRouteCreatedInSite,
  shippingLineDialogOpen,
  currentShippingLineName,
  onCloseShippingLineDialog,
  onApplyShippingLine,
  routeDialogOpen,
  onCloseRouteDialog,
  onRouteCreated,
  routeDialogInitialName,
  portDialog,
  onClosePortDialog,
  onPortCreated,
  customerDialogOpen,
  onCloseCustomerDialog,
  onCustomerCreated,
  backConfirmOpen,
  onCloseBackConfirm,
  onDiscardAndGoBack,
  pendingModeSwitch,
  onClosePendingModeSwitch,
  onConfirmModeSwitch,
  pendingContainerDelete,
  onClosePendingContainerDelete,
  onConfirmContainerDelete,
  deleteLotOpen,
  deleteReason,
  onDeleteReasonChange,
  deleteLotError,
  deleteLotSubmitting,
  onCloseDeleteLot,
  onConfirmDeleteLot,
}: ShipmentCreateModalsProps) {
  return (
    <>
      <OperationalSiteDetailsDialog site={detailSite} isOpen={Boolean(detailSite)} onClose={onCloseDetailSite} />
      <OperationalSiteCreateDialog
        // Card 211026130115: the kho quick-add opens before a customer is
        // chosen — a customerId-less open renders the dialog's own customer
        // picker (passing `Number('')` = 0 would fake a chosen customer and
        // skip it).
        isOpen={createSiteDialog.open}
        customerId={customerId ? Number(customerId) : undefined}
        customers={customers}
        defaultSiteType={createSiteDialog.siteType}
        tradeDirection={tradeDirection}
        // Card 20261009_10 (owner ruling): BOTH intake quick-adds are quick.
        // They differ in their bodies — a warehouse asks for name/short/address,
        // a factory additionally for the route and a contact — but neither opens
        // the full master-data form from intake.
        quickAdd
        routes={routes}
        onClose={onCloseCreateSite}
        onCreated={onSiteCreated}
        onRouteCreated={onRouteCreatedInSite}
      />
      <ShippingLineAddDialog
        isOpen={shippingLineDialogOpen}
        currentName={currentShippingLineName}
        onClose={onCloseShippingLineDialog}
        onApply={onApplyShippingLine}
      />
      <RouteCreateDialog
        isOpen={routeDialogOpen}
        onClose={onCloseRouteDialog}
        onCreated={onRouteCreated}
        initialName={routeDialogInitialName}
      />
      <PortCreateDialog
        isOpen={portDialog.open}
        onClose={onClosePortDialog}
        onCreated={onPortCreated}
        initialName={portDialog.target?.name ?? ''}
      />
      <CustomerCreateDialog
        isOpen={customerDialogOpen}
        onClose={onCloseCustomerDialog}
        onCreated={onCustomerCreated}
      />
      <Modal
        isOpen={backConfirmOpen}
        title="Bỏ tạo lô hàng?"
        onClose={onCloseBackConfirm}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={onCloseBackConfirm}>Tiếp tục nhập</button>
            <button type="button" className="btn btn--secondary" onClick={onDiscardAndGoBack}>Bỏ thay đổi và quay lại</button>
          </>
        )}
      >
        <p>Thông tin chưa lưu sẽ bị mất. Hãy tạo lô hàng hoặc xác nhận bỏ thay đổi.</p>
      </Modal>
      <Modal
        isOpen={pendingModeSwitch !== null}
        title="Chuyển loại hàng?"
        onClose={onClosePendingModeSwitch}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={onClosePendingModeSwitch}>Tiếp tục nhập</button>
            <button type="button" className="btn btn--secondary" onClick={onConfirmModeSwitch}>Chuyển và xóa dữ liệu</button>
          </>
        )}
      >
        <p>Chuyển sang {pendingModeSwitch} sẽ xóa dữ liệu hàng hóa đã nhập.</p>
      </Modal>
      <Modal
        isOpen={pendingContainerDelete !== null}
        title="Xóa container?"
        onClose={onClosePendingContainerDelete}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={onClosePendingContainerDelete}>Hủy</button>
            <button type="button" className="btn btn--secondary" onClick={onConfirmContainerDelete}>Xóa container</button>
          </>
        )}
      >
        <p>Xóa container này sẽ mất dữ liệu đã nhập.</p>
      </Modal>
      {/* SIL-688 (id 800 — QA 06/11): the review page's Xóa lô confirm.
          Destructive law: distinct voice + explicit confirmation + a reason
          the BE stores. The confirm stays disabled until the reason carries
          text, so the click can never be a reflex. */}
      <Modal
        isOpen={deleteLotOpen}
        title="Xóa lô hàng?"
        onClose={onCloseDeleteLot}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={onCloseDeleteLot}>Hủy</button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={onConfirmDeleteLot}
              disabled={deleteLotSubmitting || !deleteReason.trim()}
            >
              {deleteLotSubmitting ? 'Đang xóa…' : 'Xóa lô hàng'}
            </button>
          </>
        )}
      >
        <p>Xóa lô hàng sẽ loại bỏ hoàn toàn dữ liệu của lô cùng mọi container của nó. Thao tác không thể hoàn tác.</p>
        <div style={{ display: 'grid', gap: 4, marginTop: 10 }}>
          <label htmlFor="shipment-delete-lot-reason" style={{ color: 'var(--fg-1)', fontSize: 'var(--text-label-size)', fontWeight: 600 }}>
            Lý do xóa *
          </label>
          <textarea
            id="shipment-delete-lot-reason"
            value={deleteReason}
            onChange={(event) => onDeleteReasonChange(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Ví dụ: tạo trùng lô, sai khách hàng…"
            disabled={deleteLotSubmitting}
            aria-invalid={deleteLotError ? true : undefined}
            style={{
              border: '1px solid var(--control-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 8px',
              font: 'inherit',
              fontSize: 'var(--text-data-size)',
              background: 'var(--surface)',
              resize: 'vertical',
            }}
          />
          {deleteLotError && (
            <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--text-caption-size)' }}>{deleteLotError}</span>
          )}
        </div>
      </Modal>
    </>
  );
}
