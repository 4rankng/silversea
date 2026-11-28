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
  /** UX-03 (QA 28/11): the dirty-leave dialog — one idiom for every exit
   *  (Huỷ, sidebar, link, ESC). Lưu nháp is create-only intent (SIL-171: an
   *  existing lot has no draft semantics), so edit/view omits it. */
  leaveDialogOpen: boolean;
  leaveDialogTitle: string;
  onKeepEditingLeave: () => void;
  onSaveDraftLeave?: () => void;
  onDiscardLeave: () => void;
  pendingModeSwitch: CargoMode | null;
  onClosePendingModeSwitch: () => void;
  onConfirmModeSwitch: () => void;
  pendingCustomerSwitch?: string | null;
  onClosePendingCustomerSwitch?: () => void;
  onConfirmCustomerSwitch?: () => void;
  /** SIL-1080 (K2.16): the confirm body must name the factories/kho the
   *  switch deletes and the "Bắt buộc" chip's before/after — never a generic
   *  sentence. Computed by the workspace from the SAME wipe the confirm runs. */
  customerSwitchImpact?: {
    names: string[];
    before: { done: number; total: number };
    after: { done: number; total: number };
  } | null;
  pendingContainerDelete: ShipmentContainerDraft | null;
  onClosePendingContainerDelete: () => void;
  onConfirmContainerDelete: () => void;
  /** SIL-1160 (K10.16): the reasons the clicked container cannot be deleted
   *  (live trip / số tờ khai) — null = no blocked dialog. */
  blockedContainerDeleteReasons: string[] | null;
  onCloseBlockedContainerDelete: () => void;
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
  leaveDialogOpen,
  leaveDialogTitle,
  onKeepEditingLeave,
  onSaveDraftLeave,
  onDiscardLeave,
  pendingModeSwitch,
  onClosePendingModeSwitch,
  onConfirmModeSwitch,
  pendingCustomerSwitch = null,
  onClosePendingCustomerSwitch,
  onConfirmCustomerSwitch,
  customerSwitchImpact = null,
  pendingContainerDelete,
  onClosePendingContainerDelete,
  onConfirmContainerDelete,
  blockedContainerDeleteReasons,
  onCloseBlockedContainerDelete,
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
        isOpen={leaveDialogOpen}
        title={leaveDialogTitle}
        onClose={onKeepEditingLeave}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={onKeepEditingLeave}>Tiếp tục nhập</button>
            {onSaveDraftLeave && (
              <button type="button" className="btn btn--secondary" onClick={onSaveDraftLeave}>Lưu nháp</button>
            )}
            <button type="button" className="btn btn--danger" onClick={onDiscardLeave}>Bỏ thay đổi và rời trang</button>
          </>
        )}
      >
        <p>Thông tin chưa lưu sẽ bị mất khi rời trang.{onSaveDraftLeave ? ' Hãy lưu nháp để tiếp tục sau, hoặc bỏ thay đổi.' : ''}</p>
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
        isOpen={pendingCustomerSwitch !== null}
        title="Đổi khách hàng?"
        onClose={() => onClosePendingCustomerSwitch?.()}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={() => onClosePendingCustomerSwitch?.()}>Giữ nguyên</button>
            <button type="button" className="btn btn--secondary" onClick={() => onConfirmCustomerSwitch?.()}>Đổi khách hàng</button>
          </>
        )}
      >
        <p>Đổi khách hàng sẽ xóa nhà máy / kho đã chọn của khách hàng cũ (Số Bill / Booking vẫn được giữ lại). Bạn có chắc muốn đổi?</p>
        {customerSwitchImpact && customerSwitchImpact.names.length > 0 && (
          <>
            {/* §8 copy law: each sentence renders as ONE text node — adjacent
                JSX text children glue without separators in node extraction. */}
            <p>{`Sẽ bị xóa: ${customerSwitchImpact.names.join(', ')}.`}</p>
            <p>{`Bắt buộc: ${customerSwitchImpact.before.done}/${customerSwitchImpact.before.total} → ${customerSwitchImpact.after.done}/${customerSwitchImpact.after.total}.`}</p>
          </>
        )}
      </Modal>
      {/* SIL-1160 (K10.16): the blocked Xóa dialog — a container already
          riding a live trip or carrying a số tờ khai names its reasons here
          instead of failing silently in the save's reconcile. Acknowledge
          only: no destructive confirm exists for a blocked row. */}
      <Modal
        isOpen={blockedContainerDeleteReasons !== null}
        title="Không thể xóa container"
        onClose={onCloseBlockedContainerDelete}
        footer={(
          <button type="button" className="btn btn--ghost" onClick={onCloseBlockedContainerDelete}>Đóng</button>
        )}
      >
        {(blockedContainerDeleteReasons ?? []).map((reason) => (
          <p key={reason} style={{ margin: '0 0 6px' }}>{reason}</p>
        ))}
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
