// SIL-505 unit pins — the free-text passthrough resolution family
// (createAdhocFieldLogic): a typed label resolves to the catalog id under the
// app's search normalization law (case/diacritic-exact, matchesComboboxSearch
// parity), never on substring/prefix, so 'GLC' resolves, 'glc' resolves, and
// 'LC' (filter-visible but not a full label) stays free text with the id
// cleared. Sweeps the whole matcher class: customer, route, factory,
// warehouse, port, and the per-container variants — one shared owner.
import { describe, expect, it, vi } from 'vitest';
import { createAdhocFieldLogic } from './createAdhocFieldLogic';
import type { OperationalSite } from '../../../api/shipmentClient';

/** Complete OperationalSite fixture (no type-widening) — only the label
 *  fields vary per test. */
function makeSite(overrides: Partial<OperationalSite> & Pick<OperationalSite, 'id' | 'siteType' | 'name'>): OperationalSite {
  return {
    customerId: 1,
    code: `SITE-${overrides.id ?? 0}`,
    shortName: undefined,
    routeId: null,
    address: '',
    googleMapsUrl: null,
    contactName: null,
    contactPhone: null,
    warehouseContactInfo: null,
    liftInfo: null,
    dropInfo: null,
    cleaningInfo: null,
    liftFeeInvoiceName: null,
    liftFeeInvoiceAddress: null,
    liftFeeTaxCode: null,
    strictRules: null,
    version: 1,
    ...overrides,
  };
}

function buildDeps(overrides: Partial<Parameters<typeof createAdhocFieldLogic>[0]> = {}) {
  return {
    customerOptions: [{ value: '1', label: 'LONG MINH' }],
    routeOptions: [{ value: '7', label: 'KCN ĐÔNG VĂN, HÀ NAM' }],
    portOptions: [{ value: '9', label: 'Cảng Hải Phòng' }],
    operationalSites: [
      makeSite({ id: 21, siteType: 'FACTORY', name: 'NEWEB-KHO 1', shortName: 'NEWEB-KHO 1' }),
      makeSite({ id: 22, siteType: 'FACTORY', name: 'Bãi Chùa Hang', shortName: 'Bãi Chùa Hang' }),
    ],
    warehouseSites: [
      makeSite({ id: 27166, siteType: 'WAREHOUSE', name: 'Bãi GLC', shortName: 'GLC' }),
      makeSite({ id: 27167, siteType: 'WAREHOUSE', name: 'ICD Sóng Thần', shortName: 'Kho ST' }),
    ],
    selectCustomer: vi.fn(),
    selectOperationalSite: vi.fn(),
    selectContainerFactory: vi.fn(),
    update: vi.fn(),
    updateContainer: vi.fn(),
    setForm: vi.fn(),
    setContainers: vi.fn(),
    clearFeedback: vi.fn(),
    ...overrides,
  } as Parameters<typeof createAdhocFieldLogic>[0];
}

describe('createAdhocFieldLogic — SIL-505 normalized exact-label resolution', () => {
  it('warehouseCustomText resolves the full label at any case to the site id', () => {
    for (const typed of ['GLC', 'glc', 'Glc']) {
      const deps = buildDeps();
      createAdhocFieldLogic(deps).warehouseCustomText(typed);
      expect(deps.update).toHaveBeenCalledWith('pickupWarehouseSiteId', '27166');
    }
  });

  it('warehouseCustomText keeps diacritic-insensitive resolution for Vietnamese labels', () => {
    const deps = buildDeps();
    createAdhocFieldLogic(deps).warehouseCustomText('kho st');
    expect(deps.update).toHaveBeenCalledWith('pickupWarehouseSiteId', '27167');
    const deps2 = buildDeps();
    createAdhocFieldLogic(deps2).warehouseCustomText('KHO ST');
    expect(deps2.update).toHaveBeenCalledWith('pickupWarehouseSiteId', '27167');
  });

  it('warehouseCustomText does NOT resolve substrings/prefixes — LC stays free text', () => {
    const setForm = vi.fn();
    const deps = buildDeps({ setForm });
    createAdhocFieldLogic(deps).warehouseCustomText('LC');
    expect(deps.update).not.toHaveBeenCalled();
    expect(setForm).toHaveBeenCalledTimes(1);
    // The free-text half of the hybrid contract: id cleared, raw name kept.
    const updater = setForm.mock.calls[0][0] as (current: { pickupWarehouseSiteId: string; pickupWarehouseName: string }) => { pickupWarehouseSiteId: string; pickupWarehouseName: string };
    expect(updater({ pickupWarehouseSiteId: '27166', pickupWarehouseName: '' })).toEqual({
      pickupWarehouseSiteId: '',
      pickupWarehouseName: 'LC',
    });
  });

  it('factory passthrough resolves case variants over shortName', () => {
    const deps = buildDeps();
    createAdhocFieldLogic(deps).factoryCustomText('neweb-kho 1');
    expect(deps.selectOperationalSite).toHaveBeenCalledWith('21');
  });

  it('customer, route, and port passthroughs share the same normalized law', () => {
    const deps = buildDeps();
    const logic = createAdhocFieldLogic(deps);
    logic.customerCustomText('long minh');
    expect(deps.selectCustomer).toHaveBeenCalledWith('1');
    logic.routeCustomText('kcn dong van, ha nam');
    expect(deps.update).toHaveBeenCalledWith('routeId', '7');
    logic.portCustomText('row1', 'pickupPortId', 'rawPickupPortName', 'cảng hải phòng');
    expect(deps.updateContainer).toHaveBeenCalledWith('row1', 'pickupPortId', '9');
  });

  it('container factory/route variants resolve the same way', () => {
    const deps = buildDeps();
    const logic = createAdhocFieldLogic(deps);
    logic.containerFactoryCustomText('rowA', 'NEWEB-KHO 1');
    expect(deps.selectContainerFactory).toHaveBeenCalledWith('rowA', '21');
    logic.containerRouteCustomText('rowA', 'KCN ĐÔNG VĂN, HÀ NAM');
    expect(deps.updateContainer).toHaveBeenCalledWith('rowA', 'routeId', '7');
  });

  it('an unmatched typed label never resolves — free-text passthrough keeps the id cleared', () => {
    const deps = buildDeps();
    createAdhocFieldLogic(deps).warehouseCustomText('GLC 2');
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.setForm).toHaveBeenCalledTimes(1);
  });

  it('normalization-colliding labels resolve find()-first, consistent with the dropdown filter', () => {
    // 'GLC' and a same-normalization label both surface under one query; the
    // passthrough commits the FIRST match exactly like the list's ordering.
    const deps = buildDeps({
      warehouseSites: [
        makeSite({ id: 1, siteType: 'WAREHOUSE', name: 'Bãi GLC', shortName: 'GLC' }),
        makeSite({ id: 2, siteType: 'WAREHOUSE', name: 'bãi glc', shortName: 'glc' }),
      ],
    });
    createAdhocFieldLogic(deps).warehouseCustomText('GLC');
    expect(deps.update).toHaveBeenCalledWith('pickupWarehouseSiteId', '1');
  });
});
