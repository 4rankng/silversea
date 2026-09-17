import assert from 'node:assert/strict';
import test from 'node:test';
import { factoryInvoiceProfile } from '../../services/driver.service';

// The precedence order IS the contract: the factory's own invoice identity
// comes from the site's fee-invoice profile, lift → drop → cleaning. Null
// when unconfigured — the driver invoice section shows an honest empty state,
// never the customer's billing data as a stand-in.
test('factory invoice profile: lift beats drop beats cleaning; null when unconfigured', () => {
  const base = {
    liftFeeInvoiceName: null,
    liftFeeInvoiceAddress: null,
    liftFeeTaxCode: null,
    dropFeeInvoiceName: null,
    dropFeeInvoiceAddress: null,
    dropFeeTaxCode: null,
    cleaningInvoiceName: null,
    cleaningInvoiceAddress: null,
    cleaningTaxCode: null,
  };

  // Unconfigured site → null (the FE empty-note case).
  assert.equal(factoryInvoiceProfile(base), null);

  // SUNRISE-style fixture: lift carries the profile, drop repeats it,
  // cleaning is unconfigured — the lift profile wins.
  assert.deepEqual(factoryInvoiceProfile({
    ...base,
    liftFeeInvoiceName: 'CÔNG TY TNHH SUNRISE TECHNOLOGY (VIỆT NAM)',
    liftFeeInvoiceAddress: 'Một phần Lô CN-09, KCN Vân Trung, Bắc Ninh',
    liftFeeTaxCode: '2301123456',
    dropFeeInvoiceName: 'CÔNG TY TNHH SUNRISE TECHNOLOGY (VIỆT NAM)',
    dropFeeInvoiceAddress: 'Một phần Lô CN-09, KCN Vân Trung, Bắc Ninh',
    dropFeeTaxCode: '2301123456',
  }), {
    name: 'CÔNG TY TNHH SUNRISE TECHNOLOGY (VIỆT NAM)',
    address: 'Một phần Lô CN-09, KCN Vân Trung, Bắc Ninh',
    taxCode: '2301123456',
  });

  // Drop wins when lift is unconfigured; cleaning loses to both.
  assert.deepEqual(factoryInvoiceProfile({
    ...base,
    dropFeeInvoiceName: 'CÔNG TY DBP',
    dropFeeInvoiceAddress: 'Biên Hòa',
    dropFeeTaxCode: '3601234567',
    cleaningInvoiceName: 'CÔNG TY VỆ SINH',
    cleaningInvoiceAddress: 'KCN Sóng Thần',
    cleaningTaxCode: '370222333',
  }), {
    name: 'CÔNG TY DBP',
    address: 'Biên Hòa',
    taxCode: '3601234567',
  });
});

test('DRV-R03 retains partial invoice identity without mixing fee parties and ignores whitespace-only profiles', () => {
  const base = {
    liftFeeInvoiceName: ' ', liftFeeInvoiceAddress: null, liftFeeTaxCode: null,
    dropFeeInvoiceName: null, dropFeeInvoiceAddress: null, dropFeeTaxCode: null,
    cleaningInvoiceName: null, cleaningInvoiceAddress: null, cleaningTaxCode: null,
  };
  assert.equal(factoryInvoiceProfile(base), null);
  assert.deepEqual(factoryInvoiceProfile({ ...base, dropFeeInvoiceName: ' Công ty B ', dropFeeTaxCode: ' 456 ' }), {
    name: 'Công ty B', address: null, taxCode: '456',
  });
  assert.deepEqual(factoryInvoiceProfile({
    ...base, liftFeeInvoiceAddress: ' Địa chỉ A ', liftFeeTaxCode: ' 123 ', dropFeeInvoiceName: 'Công ty B',
  }), { name: null, address: 'Địa chỉ A', taxCode: '123' });
});
