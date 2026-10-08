import { describe, expect, it } from 'vitest';
import { FuelMode, LoadingType, TripStatus, type TripDetail, type FuelConfig, type RoadConfig, type RoadAllowance } from '@tingting/shared';
import { computeTripFormPreview, resolveTripPreviewSettings, type TripFinancialForm, type TripPreviewSettings } from './tripFinancialPreview';

const form: TripFinancialForm = {
  carrierType: 'EXTERNAL', externalFreightCost: '5400000', vatRate: 0.08, revenue: '10800000', customerCommission: '0',
  fuelMode: FuelMode.AUTO, fuelLitersOverride: '', fuelSupplementLiters: '7', fuelActualUnitPrice: '',
  tollsDiscount: '10000', tollsAddition: '', tollsStations: '2', hasReturnCargo: false,
  driverSalary: '500000', twoPointDeliveryBonus: '100000', vehicleShiftAllowance: '200000', roadAllowanceOverride: '',
};
const settings: TripPreviewSettings = { fuelLoadedNorm: 43, fuelEmptyNorm: 25, fuelPerTripSupplement: 3,
  fuelUnitPrice: 23000, isMountainRoute: false, mountainFixedAllowance: null,
  roadAllowanceBase: 300000, tollPerStation: 55000, returnCargoBonus: 300000 };
const legs = [{ sequence: 1, km: '100', loadingType: LoadingType.HANG }];

describe('QA-AUDIT-FIN-01 canonical form preview', () => {
  it('excludes OWN costs from external hire, keeps inclusive hire VAT and deducts commission/extras once', () => {
    const result = computeTripFormPreview(form, legs, settings);
    expect(result.totalCost).toBe(5400000); expect(result.freightExVat).toBe(10000000); expect(result.grossProfit).toBe(4600000);
    const commission = computeTripFormPreview({ ...form, customerCommission: '500000' }, legs, { ...settings, reconciledExtraCost: 150000 });
    expect(commission.recordedRevenue).toBe(9500000); expect(commission.totalCost).toBe(5550000); expect(commission.grossProfit).toBe(3950000);
  });
  it('treats blank and zero hire as zero even with populated OWN fuel and salary; clearing revenue produces a real loss', () => {
    for (const externalFreightCost of ['', '0']) {
      const result = computeTripFormPreview({ ...form, externalFreightCost }, legs, settings);
      expect(result.totalCost).toBe(0); expect(result.grossProfit).toBe(10000000);
    }
    expect(computeTripFormPreview({ ...form, revenue: '' }, legs, settings).grossProfit).toBe(-5400000);
  });
  it('responds to VAT0 and both carrier toggles without carrying inactive costs between modes', () => {
    expect(computeTripFormPreview({ ...form, vatRate: 0 }, legs, settings).grossProfit).toBe(5400000);
    const own = computeTripFormPreview({ ...form, carrierType: 'OWN' }, legs, settings);
    expect(own.totalFuelLiters).toBe(53); expect(own.totalFuelCost).toBe(1219000);
    expect(own.totalCost).toBe(2319000); expect(own.grossProfit).toBe(7681000);
    expect(computeTripFormPreview(form, legs, settings).totalCost).toBe(5400000);
  });
  it('preserves actual fuel price, zero road override and reconciled toll/backhaul inputs for OWN', () => {
    const result = computeTripFormPreview({ ...form, carrierType: 'OWN', fuelActualUnitPrice: '20000', roadAllowanceOverride: '0' }, legs,
      { ...settings, tollDeduction: 55000, reconciledTollCost: 42000, reconciledExtraCost: 150000 });
    expect(result.totalFuelCost).toBe(1060000); expect(result.totalRoadAllowance).toBe(0); expect(result.tollCost).toBe(42000);
    expect(result.totalCost).toBe(2062000); expect(result.grossProfit).toBe(7938000);
  });
  it('preserves committed legacy OWN fuel cost and litres without live recosting, while EXTERNAL omits that operating cost', () => {
    const legacy = { ...settings, fuelUnitPrice: 0, fuelLoadedNorm: 0, fuelEmptyNorm: 0,
      legacyFuel: { status: TripStatus.IN_TRANSIT, fuelPriceApplied: 0, fuelLoadedNormApplied: 0,
        fuelEmptyNormApplied: 0, storedFuelCost: 987000, storedFuelLiters: 43 } };
    const own = computeTripFormPreview({ ...form, carrierType: 'OWN' }, legs, legacy);
    expect(own.totalFuelCost).toBe(987000); expect(own.totalFuelLiters).toBe(43);
    expect(own.totalCost).toBe(2087000); expect(own.grossProfit).toBe(7913000);
    expect(computeTripFormPreview(form, legs, legacy).totalCost).toBe(5400000);
  });
});


describe('FIN01 applied-rate boundaries', () => {
  const fuel = { unitPrice: '23000', loadedNorm: '35', emptyNorm: '22', supplement: '3' } as FuelConfig;
  const road = { tollPerStation: '55000', returnCargoBonus: '300000' } as RoadConfig;
  const route = { id: 1, label: 'Hải Phòng', name: 'Hải Phòng', fixedFuelAllowance: '100', isMountain: false };
  const allowance = [{ routeId: 1, trailerType: '40FT', baseAmount: '300000', deletedAt: null }] as RoadAllowance[];
  const legacy = { status: TripStatus.CREATED, routeId: 1, trailerType: '40FT', fuelPriceApplied: '0',
    fuelLoadedNormApplied: '0', fuelEmptyNormApplied: '0', fuelSupplementNormApplied: '0',
    tollPerStationApplied: '0', returnCargoBonusApplied: '0', roadAllowanceBaseApplied: '0' } as TripDetail;
  it('uses live fuel only for missing uncommitted snapshots and pins committed legacy fuel', () => {
    const current = resolveTripPreviewSettings(legacy, fuel, road, route, '40FT', allowance);
    expect(current.fuelUnitPrice).toBe(23000); expect(current.fuelLoadedNorm).toBe(35);
    const committed = resolveTripPreviewSettings({ ...legacy, status: TripStatus.COMPLETED, totalFuelCost: '987000', fuelLiters: '43' }, fuel, road, route, '40FT', allowance);
    expect(committed.fuelUnitPrice).toBe(0); expect(committed.fuelLoadedNorm).toBe(0);
    expect(computeTripFormPreview({ ...form, carrierType: 'OWN' }, legs, committed).totalFuelCost).toBe(987000);
    const partial = resolveTripPreviewSettings({ ...legacy, fuelLoadedNormApplied: '40' }, fuel, road, route, '40FT', allowance);
    expect(partial.fuelUnitPrice).toBe(0); expect(partial.fuelLoadedNorm).toBe(40);
  });
  it('resolves both-zero road rates and changed allowance while preserving existing nonzero snapshots', () => {
    const current = resolveTripPreviewSettings(legacy, fuel, road, route, '40FT', allowance);
    expect(current.tollPerStation).toBe(55000); expect(current.returnCargoBonus).toBe(300000); expect(current.roadAllowanceBase).toBe(300000);
    const stored = { ...legacy, tollPerStationApplied: '10000', returnCargoBonusApplied: '0', roadAllowanceBaseApplied: '700000' };
    const retained = resolveTripPreviewSettings(stored, fuel, road, route, '40FT', allowance);
    expect(retained.tollPerStation).toBe(10000); expect(retained.returnCargoBonus).toBe(0); expect(retained.roadAllowanceBase).toBe(700000);
    expect(resolveTripPreviewSettings(stored, fuel, road, route, '20FT', allowance).roadAllowanceBase).toBe(0);
    expect(resolveTripPreviewSettings(stored, fuel, road, { ...route, id: 2 }, '40FT', allowance).roadAllowanceBase).toBe(0);
  });
});
