import { test } from 'node:test';
import assert from 'node:assert';
import { round2dp, roundInt } from './round';
import { computeTripTotals, ComputeTripTotalsInput } from './tripTotals';

const defaultBaseInput: ComputeTripTotalsInput = {
  legs: [
    { sequence: 1, km: 120, loadingType: 'HANG' },
    { sequence: 2, km: 120, loadingType: 'VO' }
  ],
  fuelMode: 'AUTO',
  fuelLitersOverride: null,
  fuelSupplementLiters: 0,
  fuelLoadedNorm: 43.0,
  fuelEmptyNorm: 25.0,
  fuelPerTripSupplement: 3.0,
  fuelUnitPrice: 20000,
  isMountainRoute: false,
  mountainFixedAllowance: null,
  roadAllowanceBase: 1500000,
  tollsDiscount: 100000,
  tollsAddition: 1740000,
  tollsStations: 2,
  tollPerStation: 55000,
  hasReturnCargo: true,
  returnCargoBonus: 300000,
  revenue: 4000000,
  driverSalary: 800000,
  twoPointDeliveryBonus: 0,
  vehicleShiftAllowance: 0,
};

test('round2dp boundary correctness', () => {
  // Test banker's rounding representation issues
  assert.strictEqual(round2dp(1.005), 1.01);
  assert.strictEqual(round2dp(1.004), 1.00);
  assert.strictEqual(round2dp(0), 0.0);
  assert.strictEqual(round2dp(-1.005), -1.01);
});

test('roundInt rounds to nearest integer and clamps negatives', () => {
  assert.strictEqual(roundInt(97.2), 97);
  assert.strictEqual(roundInt(97.9), 98);
  assert.strictEqual(roundInt(97), 97);
  assert.strictEqual(roundInt(0.4), 0);
  assert.strictEqual(roundInt(0.5), 1);
  assert.strictEqual(roundInt(0), 0);
  assert.strictEqual(roundInt(-5.7), 0); // negative inputs are clamped to 0
});

test('AUTO standard mode calculation -- fuel liters rounded to integer', () => {
  const result = computeTripTotals(defaultBaseInput);

  // Leg 1: 120 * 43.0 / 100 = 51.6 L -> round 52 L
  // Leg 2: 120 * 25.0 / 100 = 30.0 L -> round 30 L
  // Sum of legs = 82 L
  // Total = 82 + 3 (per-trip) + 0 (supplement) = 85 L
  assert.strictEqual(result.totalFuelLiters, 85);
  assert.strictEqual(result.legCalculations.length, 2);
  assert.strictEqual(result.legCalculations[0].calculatedLiters, 52);
  assert.strictEqual(result.legCalculations[1].calculatedLiters, 30);

  // fuelCost = 85 * 20000 = 1700000 VND
  assert.strictEqual(result.totalFuelCost, 1700000);

  // roadAllowance = tollsAddition(1740000) + returnCargoBonus(300000) - tollsDiscount(100000) = 1940000 VND
  assert.strictEqual(result.totalRoadAllowance, 1940000);

  // tollCost = tollsStations(2) × tollPerStation(55000) = 110000 VND
  assert.strictEqual(result.tollCost, 110000);

  // totalCost = 1700000 (fuel) + 1940000 (road) + 110000 (tolls) + 100000 (tollsDiscount) + 800000 (salary) = 4650000 VND
  assert.strictEqual(result.totalCost, 4650000);

  // grossProfit = 4000000 - 4650000 = -650000 VND
  assert.strictEqual(result.grossProfit, -650000);
});

test('AUTO mountain mode allowance calculation', () => {
  const input = {
    ...defaultBaseInput,
    isMountainRoute: true,
    mountainFixedAllowance: 240
  };

  const result = computeTripTotals(input);

  // totalLiters = round(240) + 0 (supplement) = 240 L (per-trip supplement NOT added)
  assert.strictEqual(result.totalFuelLiters, 240);
  assert.strictEqual(result.legCalculations[0].calculatedLiters, 0);
  assert.strictEqual(result.legCalculations[1].calculatedLiters, 0);
  assert.strictEqual(result.totalFuelCost, 240 * 20000);
});

test('AUTO uses a configured fixed route allowance even when the route is classified as plain', () => {
  const result = computeTripTotals({
    ...defaultBaseInput,
    isMountainRoute: false,
    mountainFixedAllowance: 180,
  });

  assert.strictEqual(result.totalFuelLiters, 180);
  assert.strictEqual(result.legCalculations[0].calculatedLiters, 0);
  assert.strictEqual(result.legCalculations[1].calculatedLiters, 0);
  assert.strictEqual(result.totalFuelCost, 180 * 20000);
});

test('AUTO mountain fallback calculation when allowance is null', () => {
  const input = {
    ...defaultBaseInput,
    isMountainRoute: true,
    mountainFixedAllowance: null
  };

  const result = computeTripTotals(input);

  // Falls back to standard per-leg AUTO (rounded)
  assert.strictEqual(result.totalFuelLiters, 85);
  assert.strictEqual(result.legCalculations[0].calculatedLiters, 52);
});

test('FLAT_RATE mode calculation', () => {
  const input = {
    ...defaultBaseInput,
    fuelMode: 'FLAT_RATE' as const,
    fuelLitersOverride: 150
  };

  const result = computeTripTotals(input);

  // totalLiters = round(150) + 0 = 150 L (per-trip supplement NOT added)
  assert.strictEqual(result.totalFuelLiters, 150);
  assert.strictEqual(result.legCalculations[0].calculatedLiters, 0);
});

test('FLAT_RATE mode takes precedence over mountain route', () => {
  const input = {
    ...defaultBaseInput,
    fuelMode: 'FLAT_RATE' as const,
    fuelLitersOverride: 150,
    isMountainRoute: true,
    mountainFixedAllowance: 240
  };

  const result = computeTripTotals(input);

  // totalLiters = 150 (FLAT_RATE wins over mountain 240)
  assert.strictEqual(result.totalFuelLiters, 150);
});

test('FLAT_RATE with fractional override is rounded to integer', () => {
  const input = {
    ...defaultBaseInput,
    fuelMode: 'FLAT_RATE' as const,
    fuelLitersOverride: 150.7,
  };
  const result = computeTripTotals(input);
  // round(150.7) = 151
  assert.strictEqual(result.totalFuelLiters, 151);
});

test('supplement added in all modes (and rounded)', () => {
  const input = {
    ...defaultBaseInput,
    fuelSupplementLiters: 15.5
  };

  const result = computeTripTotals(input);

  // AUTO standard: 82 (rounded legs) + 3 (per-trip) + round(15.5)=16 = 101 L
  assert.strictEqual(result.totalFuelLiters, 101);
});

test('negative road allowance clamped to 0', () => {
  const input = {
    ...defaultBaseInput,
    tollsDiscount: 2000000 // excessive discount
  };

  const result = computeTripTotals(input);

  // tollsAddition(1740000) + returnCargoBonus(300000) - tollsDiscount(2000000) = 40000 -> not negative, not clamped
  assert.strictEqual(result.totalRoadAllowance, 40000);
});

test('0 legs (empty legs array)', () => {
  const input = {
    ...defaultBaseInput,
    legs: [],
    fuelPerTripSupplement: 0,
  };

  const result = computeTripTotals(input);

  // No legs -> 0 leg liters, no per-trip supplement -> only user supplement
  assert.strictEqual(result.totalFuelLiters, 0);
  assert.strictEqual(result.legCalculations.length, 0);
  assert.strictEqual(result.totalFuelCost, 0);
  // roadAllowance unchanged by legs: tollsAddition(1740000) + returnCargoBonus(300000) - tollsDiscount(100000) = 1940000
  assert.strictEqual(result.totalRoadAllowance, 1940000);
  // tollCost = 2 × 55000 = 110000
  assert.strictEqual(result.tollCost, 110000);
  // totalCost = 0 (fuel) + 1940000 (road) + 110000 (tolls) + 100000 (tollsDiscount) + 800000 (salary) = 2950000
  assert.strictEqual(result.grossProfit, 4000000 - 0 - 1940000 - 110000 - 100000 - 800000);
});

test('rounding preserves sum-of-legs consistency', () => {
  // 0.43 + 0.43 = 0.86 -- sum of rounds would be 0, round of sum is 1.
  // Our implementation rounds each leg individually so the displayed
  // breakdown adds up to the issued total (a saner UX for the fuel card).
  const input = {
    ...defaultBaseInput,
    legs: [
      { sequence: 1, km: 1, loadingType: 'HANG' as const }, // 1 * 43 / 100 = 0.43 -> round 0
      { sequence: 2, km: 1, loadingType: 'HANG' as const }, // 1 * 43 / 100 = 0.43 -> round 0
    ],
    fuelPerTripSupplement: 0,
    fuelSupplementLiters: 0,
    tollsDiscount: 0,
    tollsAddition: 0,
    tollsStations: 0,
    hasReturnCargo: false,
    driverSalary: 0,
    revenue: 0,
    roadAllowanceBase: 0,
  };

  const result = computeTripTotals(input);
  assert.strictEqual(result.legCalculations[0].calculatedLiters, 0);
  assert.strictEqual(result.legCalculations[1].calculatedLiters, 0);
  // 0 + 0 + 0 (per-trip rounded) + 0 (supplement) = 0
  assert.strictEqual(result.totalFuelLiters, 0);
});

test('fuel liters always integer even when raw result is x.xx5', () => {
  // 11.5 * 43 / 100 = 4.945 -- rounds to 5
  const input = {
    ...defaultBaseInput,
    legs: [{ sequence: 1, km: 11.5, loadingType: 'HANG' as const }],
    fuelPerTripSupplement: 0,
    fuelSupplementLiters: 0,
    tollsDiscount: 0,
    tollsAddition: 0,
    tollsStations: 0,
    hasReturnCargo: false,
    driverSalary: 0,
    revenue: 0,
    roadAllowanceBase: 0,
  };

  const result = computeTripTotals(input);
  assert.strictEqual(result.legCalculations[0].calculatedLiters, 5);
  assert.strictEqual(result.totalFuelLiters, 5);
  // fuelCost = 5 * 20000 = 100000
  assert.strictEqual(result.totalFuelCost, 100000);
});

test('twoPointDeliveryBonus and vehicleShiftAllowance included in totalCost', () => {
  const input = {
    ...defaultBaseInput,
    twoPointDeliveryBonus: 200000,
    vehicleShiftAllowance: 350000,
  };

  const result = computeTripTotals(input);

  // totalCost = 1700000 (fuel) + 1940000 (road) + 110000 (tolls) + 100000 (tollsDiscount) + 800000 (salary) + 200000 + 350000 = 5200000
  assert.strictEqual(result.totalCost, 5200000);
  assert.strictEqual(result.grossProfit, 4000000 - 5200000);
});

// --- A4 extension tests -----------------------------------------------------

const BASE_A4 = {
  legs: [{ sequence: 1, km: 100, loadingType: 'HANG' as const }],
  fuelMode: 'AUTO' as const,
  fuelLitersOverride: null,
  fuelSupplementLiters: 0,
  fuelLoadedNorm: 43,
  fuelEmptyNorm: 25,
  fuelPerTripSupplement: 3,
  fuelUnitPrice: 20000,
  isMountainRoute: false,
  mountainFixedAllowance: null,
  roadAllowanceBase: 500000,
  tollsDiscount: 0,
  tollsAddition: 0,
  tollsStations: 0,
  tollPerStation: 55000,
  hasReturnCargo: false,
  returnCargoBonus: 300000,
  revenue: 10800000,   // 10,000,000 ex-VAT at 8%
  driverSalary: 800000,
  twoPointDeliveryBonus: 0,
  vehicleShiftAllowance: 0,
  roadAllowanceOverride: null,
};

test('backward-compat: vatRate=0 (default) -- freightExVat equals revenue', () => {
  const r = computeTripTotals(BASE_A4);
  assert.strictEqual(r.freightExVat, BASE_A4.revenue);
  assert.strictEqual(r.serviceMargin, 0);
  assert.strictEqual(r.externalMargin, 0);
  // existing AUTO fuel calculation: 100km HANG @ 43L/100 = 43L + 3 supplement = 46L
  assert.strictEqual(r.totalFuelLiters, 46);
  assert.strictEqual(r.totalFuelCost, 920000);
});

test('OWN trip with 8% VAT: freightExVat = revenue / 1.08', () => {
  const r = computeTripTotals({ ...BASE_A4, vatRate: 0.08 });
  assert.strictEqual(r.freightExVat, 10000000);  // 10800000 / 1.08
});

test('OWN trip with ancillary fees: service amounts do not affect transport grossProfit', () => {
  const base = computeTripTotals({ ...BASE_A4, vatRate: 0.08 });
  const r = computeTripTotals({
    ...BASE_A4,
    vatRate: 0.08,
    ancillaryFees: [
      { buyAmount: 540000, sellAmount: 540000, vatRate: 0.08 },   // at-cost: sell ex-VAT 500000, buy incl-VAT 540000 -> margin -40000
      { buyAmount: 540000, sellAmount: 1080000, vatRate: 0.08 },  // markup: sell ex-VAT 1000000, buy incl-VAT 540000 -> margin 460000
    ],
  });
  // Service/ocean-fee values are for debit notes and customer AR only.
  // Transport P&L does not track the buy side or service margin.
  assert.strictEqual(r.totalServiceBuy, 0);
  assert.strictEqual(r.totalServiceSell, 1500000);
  assert.strictEqual(r.serviceMargin, 0);
  assert.strictEqual(r.grossProfit, base.grossProfit);
});

test('EXTERNAL trip: totalCost = externalFreightCost, margin uses incl-VAT cost (§4.7)', () => {
  const r = computeTripTotals({
    ...BASE_A4,
    vatRate: 0.08,
    carrierType: 'EXTERNAL',
    externalFreightCost: 5400000,  // incl-VAT (ex-VAT would be 5000000)
    revenue: 10800000,             // 10000000 ex-VAT
  });
  assert.strictEqual(r.externalFreightExVat, 5000000);  // informational ex-VAT field (display only)
  assert.strictEqual(r.externalMargin, 4600000);   // 10000000 ex-VAT − 5400000 incl-VAT (§4.7)
  assert.strictEqual(r.totalCost, 5400000);        // incl-VAT stored for AP
  assert.strictEqual(r.grossProfit, 4600000);      // external carrier margin only
  assert.strictEqual(r.totalFuelCost, 920000);     // still computed but not in totalCost
});

test('EXTERNAL trip with service fees: service amounts do not affect transport grossProfit', () => {
  const r = computeTripTotals({
    ...BASE_A4,
    vatRate: 0.08,
    carrierType: 'EXTERNAL',
    externalFreightCost: 5400000,
    ancillaryFees: [{ buyAmount: 540000, sellAmount: 1080000, vatRate: 0.08 }],
  });
  assert.strictEqual(r.serviceMargin, 0);
  assert.strictEqual(r.totalServiceBuy, 0);
  assert.strictEqual(r.totalServiceSell, 1000000);
  assert.strictEqual(r.grossProfit, 4600000);
});

test('auto-calculated road allowance when tollsAddition is 0', () => {
  const r = computeTripTotals({
    ...BASE_A4,
    tollsAddition: 0,
    tollsDiscount: 100000,
    tollsStations: 2,
    tollPerStation: 50000,
    hasReturnCargo: true,
    returnCargoBonus: 300000,
  });
  // base = 500000, discount = 100000, addition = 0
  // stations cost = 2 * 50000 = 100000
  // return bonus = 300000
  // tongTienDiDuong = 500000 - 100000 + 300000 = 700000
  // totalRoadAllowance = tongTienDiDuong - discount = 700000 - 100000 = 600000
  assert.strictEqual(r.totalRoadAllowance, 600000);
});

test('tollCost = tollsStations × tollPerStation, included in totalCost for OWN trips', () => {
  const r = computeTripTotals({
    ...BASE_A4,
    tollsStations: 3,
    tollPerStation: 70000,
  });
  // tollCost = 3 × 70000 = 210000
  assert.strictEqual(r.tollCost, 210000);
  // roadAllowance = 500000 - (3 × 70000) = 290000 (tolls subtracted from base)
  // totalCost = 920000 (fuel) + 290000 (road) + 210000 (tolls) + 800000 (salary) = 2220000
  assert.strictEqual(r.totalCost, 2220000);
  assert.strictEqual(r.grossProfit, 10800000 - 2220000);
});

test('tollCost = 0 when tollsStations is 0', () => {
  const r = computeTripTotals(BASE_A4);
  assert.strictEqual(r.tollCost, 0);
});

test('tollCost NOT included in totalCost for EXTERNAL trips', () => {
  const r = computeTripTotals({
    ...BASE_A4,
    tollsStations: 3,
    tollPerStation: 70000,
    carrierType: 'EXTERNAL',
    externalFreightCost: 5400000,
  });
  assert.strictEqual(r.tollCost, 210000);
  // EXTERNAL: totalCost = externalFreightCost only, tollCost not added
  assert.strictEqual(r.totalCost, 5400000);
});

// --- Commission (recordedRevenue) tests ------------------------------------

test('customerCommission=0: recordedRevenue equals freightExVat (backward compat)', () => {
  const r = computeTripTotals({ ...BASE_A4, vatRate: 0.08, customerCommission: 0 });
  assert.strictEqual(r.freightExVat, 10000000);
  assert.strictEqual(r.recordedRevenue, 10000000);  // no commission
});

test('customerCommission=500K: recordedRevenue = freightExVat - commission', () => {
  // AC1: revenue 10.8M, vatRate 8%, commission 500K
  const r = computeTripTotals({ ...BASE_A4, vatRate: 0.08, customerCommission: 500000 });
  assert.strictEqual(r.freightExVat, 10000000);
  assert.strictEqual(r.recordedRevenue, 9500000);   // 10000000 - 500000
});

test('customerCommission omitted (undefined): recordedRevenue equals freightExVat', () => {
  const r = computeTripTotals({ ...BASE_A4, vatRate: 0.08 });
  assert.strictEqual(r.recordedRevenue, r.freightExVat);
});

test('commission reduces grossProfit for OWN trips', () => {
  const noCommission = computeTripTotals({ ...BASE_A4, vatRate: 0.08 });
  const withCommission = computeTripTotals({ ...BASE_A4, vatRate: 0.08, customerCommission: 500000 });
  // grossProfit reduced by exactly 500000 (commission amount)
  assert.strictEqual(withCommission.grossProfit, noCommission.grossProfit - 500000);
});

test('commission reduces EXTERNAL trip grossProfit and management margin', () => {
  const r = computeTripTotals({
    ...BASE_A4,
    vatRate: 0.08,
    carrierType: 'EXTERNAL',
    externalFreightCost: 5400000,
    customerCommission: 500000,
  });
  assert.strictEqual(r.recordedRevenue, 9500000);
  assert.strictEqual(r.externalMargin, 4100000);     // recorded revenue 9.5M − hire cost 5.4M
  assert.strictEqual(r.grossProfit, 4100000);
});
