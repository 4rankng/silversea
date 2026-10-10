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
  customerId: string;
  routes: CatalogData['routes'] | Route[];
  onCloseCreateSite: () => void;
  onSiteCreated: (site: OperationalSite) => void;
  onRouteCreatedInSite: (route: Route) => void;
  shippingLineDialogOpen: boolean;
  currentShippingLineName: string;
  onCloseShippingLineDialog: () => void;
  onApplyShippingLine: (name: string) => void;
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
}

export function ShipmentCreateModals({
  detailSite,
  onCloseDetailSite,
  createSiteDialog,
  customerId,
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
}: ShipmentCreateModalsProps) {
  return (
    <>
      <OperationalSiteDetailsDialog site={detailSite} isOpen={Boolean(detailSite)} onClose={onCloseDetailSite} />
      <OperationalSiteCreateDialog
        isOpen={createSiteDialog.open && Boolean(customerId)}
        customerId={Number(customerId)}
        defaultSiteType={createSiteDialog.siteType}
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
    </>
  );
}
