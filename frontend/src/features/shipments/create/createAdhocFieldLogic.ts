// Lệnh chạy ngoài (MasterDataNhaMay §4.2) free-text passthrough: an exact
// option-label match selects the catalog id; anything else becomes the raw
// text with a cleared id (Case 2 hybrid storage). Split from
// ShipmentCreateWorkspace.tsx (structure-guard debt wave): the decisions
// live here as a factory over injected callbacks — the workspace keeps
// state ownership.
import type { OperationalSite } from '../../../api/shipmentClient';
import type { ShipmentContainerDraft, ShipmentCreateFormState } from './shipment-create-model';

interface OptionLike { value: string; label: string }

export interface AdhocFieldLogicDeps {
  customerOptions: OptionLike[];
  routeOptions: OptionLike[];
  portOptions: OptionLike[];
  operationalSites: OperationalSite[];
  selectCustomer: (value: string) => void;
  selectOperationalSite: (value: string) => void;
  selectContainerFactory: (rowKey: string, value: string) => void;
  update: (key: string, value: string) => void;
  updateContainer: (rowKey: string, field: string, value: string) => void;
  setForm: (updater: (current: ShipmentCreateFormState) => ShipmentCreateFormState) => void;
  setContainers: (updater: (current: ShipmentContainerDraft[]) => ShipmentContainerDraft[]) => void;
  clearFeedback: () => void;
}

export function createAdhocFieldLogic(deps: AdhocFieldLogicDeps) {
  const {
    customerOptions, routeOptions, portOptions, operationalSites,
    selectCustomer, selectOperationalSite, selectContainerFactory,
    update, updateContainer, setForm, setContainers, clearFeedback,
  } = deps;

  function customerCustomText(text: string) {
    const match = customerOptions.find((option) => option.label === text);
    if (match) { selectCustomer(match.value); return; }
    setForm((current) => ({ ...current, customerId: '', rawCustomerName: text }));
    clearFeedback();
  }

  function routeCustomText(text: string) {
    const match = routeOptions.find((option) => option.label === text);
    if (match) { update('routeId', match.value); return; }
    setForm((current) => ({ ...current, routeId: '', rawRouteName: text }));
    clearFeedback();
  }

  function factoryCustomText(text: string) {
    const match = operationalSites.find((site) => (site.shortName || site.name) === text);
    if (match) { selectOperationalSite(String(match.id)); return; }
    setForm((current) => ({ ...current, operationalSiteId: '', factoryName: text }));
    clearFeedback();
  }

  function portCustomText(
    rowKey: string,
    idField: 'pickupPortId' | 'dropoffPortId',
    rawField: 'rawPickupPortName' | 'rawDropoffPortName',
    text: string,
  ) {
    const match = portOptions.find((option) => option.label === text);
    if (match) { updateContainer(rowKey, idField, match.value); return; }
    updateContainer(rowKey, idField, '');
    updateContainer(rowKey, rawField, text);
  }

  function containerFactoryCustomText(rowKey: string, text: string) {
    const match = operationalSites.find((site) => (site.shortName || site.name) === text);
    if (match) { selectContainerFactory(rowKey, String(match.id)); return; }
    setContainers((current) => current.map((row) => row.key === rowKey
      ? { ...row, operationalSiteId: '', rawFactoryName: text, routeId: '', rawRouteName: '' }
      : row));
    clearFeedback();
  }

  function containerRouteCustomText(rowKey: string, text: string) {
    const match = routeOptions.find((option) => option.label === text);
    if (match) { updateContainer(rowKey, 'routeId', match.value); return; }
    setContainers((current) => current.map((row) => row.key === rowKey
      ? { ...row, routeId: '', rawRouteName: text }
      : row));
    clearFeedback();
  }

  /**
   * Factory-route authority (master-data spec 2026-09-06): a factory with a
   * configured route owns the shipment/container route — the route field
   * auto-fills and locks. Returns '' when the factory has no route so manual
   * selection stays allowed (no dead-end).
   */
  function routeIdForSite(siteId: string): string {
    if (!siteId) return '';
    const site = operationalSites.find((item) => String(item.id) === siteId);
    return site?.routeId != null ? String(site.routeId) : '';
  }

  return {
    customerCustomText, routeCustomText, factoryCustomText, portCustomText,
    containerFactoryCustomText, containerRouteCustomText, routeIdForSite,
  };
}
