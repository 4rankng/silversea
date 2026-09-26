import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TripStatus } from '@tingting/shared';
import { DriverTaskInfoSections } from './DriverTaskInfoSections';
import type { DriverTaskDetail } from '../../api/driverClient';

/**
 * Component-level coverage for the THÔNG TIN LỆNH fact grid and the
 * THÔNG TIN XUẤT HÓA ĐƠN block: field order, factory block (abbrev with
 * fallback, canonical full name, site address), no duplicate route,
 * always-visible warehouse phone, and per-segment fee-invoice rows.
 * The page suite (DriverTripDetailPage.test.tsx) locks the same behavior
 * through the full page render — both must move in lockstep.
 */

function makeTrip(overrides: {
  fulfillment?: Partial<NonNullable<DriverTaskDetail['fulfillment']>>;
  invoiceMaster?: DriverTaskDetail['invoiceMaster'];
  invoiceFactory?: DriverTaskDetail['invoiceFactory'];
  routeName?: string | null;
  tradeDirection?: string | null;
} = {}): DriverTaskDetail {
  return {
    id: 55,
    version: 3,
    tripCode: 'TRIP-55',
    status: TripStatus.IN_TRANSIT,
    departureDate: '2026-08-01',
    tradeDirection: overrides.tradeDirection ?? null,
    routeName: overrides.routeName !== undefined ? overrides.routeName : 'Cảng Cát Lái → Nhà máy Bình Dương',
    truckPlate: '51C-12345',
    trailerPlate: '51R-55555',
    trailerType: '40FT',
    customerName: 'SilverSea',
    cargoTypeName: 'Hàng xuất',
    fuelLiters: null,
    fuelMode: null,
    fuelSupplierName: null,
    totalRoadAllowance: '450000',
    driverSalary: '1500000',
    hasReturnCargo: false,
    notes: null,
    costSubmissionNote: null,
    customerReference: 'CUS-REF',
    accountingLock: null,
    containers: [{ id: 1, containerNumber: 'MSCU1234561', sealNumber: 'SEAL-9', containerTypeId: 1, containerTypeName: '40FT', containerTypeCode: '40G1', cargoWeightKg: null, updatedAt: '2026-08-01T01:00:00.000Z' }],
    legs: [],
    fulfillment: {
      id: 88,
      code: 'FUL-88',
      taskCode: 'FUL-88',
      type: 'FCL_CONTAINER',
      modeLabel: 'FCL',
      factoryName: 'Nhà máy Askey Việt Nam',
      factoryShortName: 'ASKEY',
      factoryFullName: 'Công ty TNHH Askey Việt Nam',
      factoryAddress: 'KCN Việt Nam – Singapore, Thuận An, Bình Dương',
      khoPhone: '0901234567',
      pickupPortName: 'Cát Lái',
      dropPortName: 'Sóng Thần',
      pickupWarehouseName: null,
      dropWarehouseName: null,
      lclWarehouseName: null,
      plannedAt: '2026-08-01T09:00:00.000Z',
      contactName: 'Anh Minh',
      contactPhone: '0909000001',
      driverNotes: null,
      routeSummary: 'Cát Lái → Thuận An',
      siteRules: [],
      invoiceInfo: null,
      containerSealPhotos: [],
      ...overrides.fulfillment,
    },
    invoiceMaster: overrides.invoiceMaster,
    invoiceFactory: overrides.invoiceFactory ?? null,
  };
}

const labels = () => Array.from(document.querySelectorAll('.driver-task-fact__label')).map((el) => el.textContent);

const valueOf = (label: string) => Array.from(document.querySelectorAll('.driver-task-fact'))
  .find((el) => el.querySelector('.driver-task-fact__label')?.textContent === label)
  ?.querySelector('.driver-task-fact__value')?.textContent;

describe('DriverTaskInfoSections', () => {
  it('VID-DRV-05 does not invent an appointment time from a date-only departure day', () => {
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: { plannedAt: null } })} />);
    expect(valueOf('Ngày giờ kế hoạch')).toBe('Chưa chốt lịch');
    expect(screen.queryByText(/07:00/)).toBeNull();
  });

  it('VID-DRV-01 renders schedule, factory, contact, container, seal and ports without a duplicate route row', () => {
    render(<DriverTaskInfoSections trip={makeTrip()} />);

    expect(labels()).toEqual([
      'Số Bill / Booking',
      'Ngày giờ kế hoạch',
      'Nhà máy',
      'Tên nhà máy',
      'Địa chỉ nhà máy',
      'Số điện thoại liên hệ',
      'Số điện thoại kho',
      'Container / lô hàng',
      'Seal',
      'Cảng nâng',
      'Cảng hạ',
    ]);
  });

  it('renders the factory block: short name, canonical full name, site address', () => {
    render(<DriverTaskInfoSections trip={makeTrip()} />);

    expect(valueOf('Nhà máy')).toBe('ASKEY');
    expect(valueOf('Tên nhà máy')).toBe('Công ty TNHH Askey Việt Nam');
    expect(valueOf('Địa chỉ nhà máy')).toBe('KCN Việt Nam – Singapore, Thuận An, Bình Dương');
  });

  it('falls back to the full factory name in the abbrev row when the site has no short name', () => {
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: { factoryShortName: null } })} />);

    expect(valueOf('Nhà máy')).toBe('Nhà máy Askey Việt Nam');
  });

  it('renders "—" for the full-name and address rows when the shipment carries neither', () => {
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: { factoryFullName: undefined, factoryAddress: null } })} />);

    expect(valueOf('Tên nhà máy')).toBe('—');
    expect(valueOf('Địa chỉ nhà máy')).toBe('—');
  });

  it('dashes the full-name row when the site join misses and only free text exists', () => {
    // Site-miss: the full-name chain falls back to the free-text factoryName,
    // which is also what the abbrev row shows — no duplicate row.
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: {
      factoryShortName: null,
      factoryName: 'Nhà máy Free Text',
      factoryFullName: 'Nhà máy Free Text',
    } })} />);

    expect(valueOf('Nhà máy')).toBe('Nhà máy Free Text');
    expect(valueOf('Tên nhà máy')).toBe('—');
  });

  it('dashes the full-name row when a blank site short name resolves both rows to the site name', () => {
    // Blank short_name: the SQL blank-safe resolution makes the abbrev row
    // show the site's full name — identical to the canonical full name.
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: {
      factoryShortName: 'Nhà máy Đầy Đủ',
      factoryName: 'STALE TEXT',
      factoryFullName: 'Nhà máy Đầy Đủ',
    } })} />);

    expect(valueOf('Nhà máy')).toBe('Nhà máy Đầy Đủ');
    expect(valueOf('Tên nhà máy')).toBe('—');
  });

  it('no longer renders a standalone warehouse-phone row (the combined contact row carries the number)', () => {
    render(<DriverTaskInfoSections trip={makeTrip()} />);

    expect(screen.queryByText('SĐT liên hệ')).toBeNull();
  });
  it('renders contact name + phone grouped as Số điện thoại liên hệ beneath factory address', () => {
    render(<DriverTaskInfoSections trip={makeTrip()} />);

    const contactValue = valueOf('Số điện thoại liên hệ');
    expect(contactValue).toContain('Anh Minh');
    expect(contactValue).toContain('0909000001');
    // Phone is a tel link
    const contactLink = screen.getByText('0909000001');
    expect(contactLink.getAttribute('href')).toBe('tel:0909000001');
  });

  it('renders only phone in Số điện thoại liên hệ when contact name is absent', () => {
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: { contactName: null } })} />);

    const contactLink = screen.getByText('0909000001');
    expect(contactLink.getAttribute('href')).toBe('tel:0909000001');
  });

  it('renders "—" in Số điện thoại liên hệ when both name and phone are absent', () => {
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: { contactName: null, contactPhone: null } })} />);

    expect(valueOf('Số điện thoại liên hệ')).toBe('—');
  });

  it('VID-DRV-01 renders the factory address in the info section, leaving route text to the task header', () => {
    render(<DriverTaskInfoSections trip={makeTrip()} />);

    expect(valueOf('Địa chỉ nhà máy')).toBe('KCN Việt Nam – Singapore, Thuận An, Bình Dương');
    expect(valueOf('Tuyến')).toBeUndefined();
    expect(screen.queryByText('Cát Lái → Thuận An')).toBeNull();
  });

  it('VID-DRV-01 does not recreate a route row for missing summary or route values', () => {
    const { unmount } = render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: { routeSummary: null } })} />);
    expect(valueOf('Tuyến')).toBeUndefined();
    unmount();

    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: { routeSummary: null }, routeName: null })} />);
    expect(valueOf('Tuyến')).toBeUndefined();
  });

  it('renders master rows and fee-invoice rows with name · address · MST segments in order', () => {
    render(<DriverTaskInfoSections trip={makeTrip({
      invoiceMaster: { taxCode: '3701234567', companyName: 'Công ty TNHH ABC', address: '45 Lê Lợi, Quận 1, Tp.HCM' },
      fulfillment: {
        invoiceInfo: {
          liftFeeInvoiceName: 'CTY TNHH Nâng Hàng',
          liftFeeInvoiceAddress: '12 Đường Số 5, KCN Sóng Thần',
          liftFeeTaxCode: '370111222',
          dropFeeInvoiceName: 'CTY TNHH Hạ Hàng',
          dropFeeInvoiceAddress: null,
          dropFeeTaxCode: '370333444',
          cleaningInvoiceName: 'CTY Vệ Sinh Container',
          cleaningInvoiceAddress: '9 Phạm Ngũ Lão',
          cleaningTaxCode: null,
        },
      },
    })} />);

    const grid = document.getElementById('driver-task-invoice-grid');
    expect(grid).toBeTruthy();
    const invoiceLabels = Array.from(grid!.querySelectorAll('.driver-task-fact__label')).map((el) => el.textContent);
    expect(invoiceLabels).toEqual(['Tên công ty', 'Địa chỉ', 'MST', 'Hóa đơn phí nâng', 'Hóa đơn phí hạ', 'Hóa đơn vệ sinh cont']);
    expect(screen.getByText('Công ty TNHH ABC')).toBeTruthy();
    expect(screen.getByText('45 Lê Lợi, Quận 1, Tp.HCM')).toBeTruthy();
    expect(screen.getByText('3701234567')).toBeTruthy();
    expect(screen.getByText('CTY TNHH Nâng Hàng · 12 Đường Số 5, KCN Sóng Thần · MST 370111222')).toBeTruthy();
    expect(screen.getByText('CTY TNHH Hạ Hàng · MST 370333444')).toBeTruthy();
    expect(screen.getByText('CTY Vệ Sinh Container · 9 Phạm Ngũ Lão')).toBeTruthy();
  });

  it('explains missing invoice configuration for the displayed factory instead of silently hiding it', () => {
    render(<DriverTaskInfoSections trip={makeTrip()} />);

    expect(screen.getByText('Thông tin xuất hóa đơn')).toBeTruthy();
    expect(screen.getByText('Nhà máy chưa cấu hình thông tin xuất hóa đơn.')).toBeTruthy();
  });

  it('identifies missing factory invoice fields without borrowing customer values', () => {
    render(<DriverTaskInfoSections trip={makeTrip({ invoiceFactory: { name: 'Factory Legal Name', address: null, taxCode: null }, invoiceMaster: { companyName: 'Customer', address: 'Customer billing address', taxCode: '123' } })} />);
    expect(screen.getByText('Nhà máy chưa cấu hình: địa chỉ xuất hóa đơn, mã số thuế.')).toBeTruthy();
    expect(screen.getByText('Customer billing address')).toBeTruthy();
  });

  it('DRV-R03 retains known invoice address and tax ID when the legal name is missing', () => {
    render(<DriverTaskInfoSections trip={makeTrip({
      invoiceFactory: { name: null, address: 'Địa chỉ pháp lý nhà máy', taxCode: '2301234567' },
      fulfillment: { invoiceInfo: {
        liftFeeInvoiceName: ' ', liftFeeInvoiceAddress: 'Địa chỉ pháp lý nhà máy', liftFeeTaxCode: '2301234567',
        dropFeeInvoiceName: null, dropFeeInvoiceAddress: null, dropFeeTaxCode: null,
        cleaningInvoiceName: null, cleaningInvoiceAddress: null, cleaningTaxCode: null,
      } },
    })} />);
    expect(screen.getByText('Nhà máy chưa cấu hình: tên pháp lý.')).toBeTruthy();
    expect(valueOf('Hóa đơn phí nâng')).toBe('Chưa có tên đơn vị · Địa chỉ pháp lý nhà máy · MST 2301234567');
  });

  it('DRV-R04 renders a trimmed named contact only once without warehouse-phone duplication', () => {
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: { contactName: '  Chị An  ', contactPhone: ' 0909000001  ' } })} />);
    expect(valueOf('Số điện thoại liên hệ')).toBe('Chị An · 0909000001');
    expect(screen.getAllByRole('link', { name: '0909000001' })).toHaveLength(1);
    expect(labels()).not.toContain('SĐT kho');
    expect(labels()).not.toContain('SĐT liên hệ');
  });

  it('labels the factory invoice profile under its own party heading — never the customer fallback', () => {
    render(<DriverTaskInfoSections trip={makeTrip({
      // SUNRISE-style positive fixture: factory profile rides the wire
      // (site fee-invoice fields), distinct from the customer master data.
      invoiceFactory: { name: 'CÔNG TY TNHH SUNRISE TECHNOLOGY (VIỆT NAM)', address: 'Một phần Lô CN-09, KCN Vân Trung, Bắc Ninh', taxCode: '2301123456' },
      invoiceMaster: { taxCode: '2300540419', companyName: 'Long Minh', address: null },
    })} />);

    const grid = document.getElementById('driver-task-invoice-grid');
    expect(grid).toBeTruthy();
    const partyLabels = Array.from(grid!.querySelectorAll('.driver-task-invoice-party')).map((el) => el.textContent);
    expect(partyLabels).toEqual(['Nhà máy', 'Khách hàng']);
    // Factory rows lead, with the factory's OWN tax code — not the customer's.
    expect(screen.getByText('CÔNG TY TNHH SUNRISE TECHNOLOGY (VIỆT NAM)')).toBeTruthy();
    expect(screen.getByText('2301123456')).toBeTruthy();
    // Customer rows stay correctly attributed with their own values.
    expect(screen.getByText('Long Minh')).toBeTruthy();
    expect(screen.getByText('2300540419')).toBeTruthy();
  });

  it('renders the honest empty note for an unconfigured factory — customer data never stands in', () => {
    render(<DriverTaskInfoSections trip={makeTrip({
      invoiceMaster: { taxCode: '2300540419', companyName: 'Long Minh', address: '12 Nguyễn Trãi' },
    })} />);

    expect(screen.getByText('Nhà máy chưa cấu hình thông tin xuất hóa đơn.')).toBeTruthy();
    // Exactly one MST row — the customer's. No factory-labeled stand-in.
    const mstValues = Array.from(document.querySelectorAll('.driver-task-fact'))
      .filter((el) => el.querySelector('.driver-task-fact__label')?.textContent === 'MST')
      .map((el) => el.querySelector('.driver-task-fact__value')?.textContent);
    expect(mstValues).toEqual(['2300540419']);
  });

  it('renders the empty-container return depot as Trả cont rỗng for EXPORT when distinct from Cảng hạ', () => {
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: { returnDepotName: 'Bãi JJ LOGISTICS' } })} />);

    expect(labels()).toEqual([
      'Số Bill / Booking',
      'Ngày giờ kế hoạch',
      'Nhà máy',
      'Tên nhà máy',
      'Địa chỉ nhà máy',
      'Số điện thoại liên hệ',
      'Số điện thoại kho',
      'Container / lô hàng',
      'Seal',
      'Cảng nâng',
      'Cảng hạ',
      'Trả cont rỗng',
    ]);
    expect(valueOf('Cảng hạ')).toBe('Sóng Thần');
    expect(valueOf('Trả cont rỗng')).toBe('Bãi JJ LOGISTICS');
  });

  it('hides the return depot row when it equals the drop point (EXPORT)', () => {
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: { returnDepotName: 'Sóng Thần' } })} />);

    expect(labels()).not.toContain('Trả cont rỗng');
  });

  it('hides the return depot row when returnDepotName is null', () => {
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: { returnDepotName: null } })} />);

    expect(labels()).not.toContain('Trả cont rỗng');
  });

  it('KP-063: without tradeDirection (EXPORT-like), Cảng hạ is the drop port and return depot renders separately', () => {
    render(<DriverTaskInfoSections trip={makeTrip({
      fulfillment: { returnDepotName: 'Bãi JJ LOGISTICS', dropPortName: 'Nhà máy Samsung' },
    })} />);

    expect(valueOf('Cảng hạ')).toBe('Nhà máy Samsung');
    expect(valueOf('Trả cont rỗng')).toBe('Bãi JJ LOGISTICS');
  });

  it('KP-063: IMPORT direction swaps Cảng hạ to return depot and shows actual delivery separately', () => {
    render(<DriverTaskInfoSections trip={makeTrip({
      tradeDirection: 'IMPORT',
      fulfillment: { returnDepotName: 'Bãi JJ LOGISTICS', dropPortName: 'Nhà máy Samsung' },
    })} />);

    expect(valueOf('Cảng hạ')).toBe('Bãi JJ LOGISTICS');
    expect(valueOf('Địa chỉ giao hàng')).toBe('Nhà máy Samsung');
    expect(labels()).not.toContain('Trả cont rỗng');
  });

  it('DRV-R02: IMPORT with no return depot never mislabels the delivery factory as Cảng hạ', () => {
    render(<DriverTaskInfoSections trip={makeTrip({
      tradeDirection: 'IMPORT',
      fulfillment: { returnDepotName: null, dropPortName: 'Nhà máy Samsung' },
    })} />);

    expect(valueOf('Cảng hạ')).toBe('Chưa có nơi trả rỗng');
    expect(valueOf('Địa chỉ giao hàng')).toBe('Nhà máy Samsung');
    expect(labels()).not.toContain('Trả cont rỗng');
  });

  it('P1_5: IMPORT with return depot equal to drop port still shows delivery row', () => {
    render(<DriverTaskInfoSections trip={makeTrip({
      tradeDirection: 'IMPORT',
      fulfillment: { returnDepotName: 'Sóng Thần', dropPortName: 'Sóng Thần' },
    })} />);

    expect(valueOf('Cảng hạ')).toBe('Sóng Thần');
    // P1_5 regression fix: always show delivery address for IMPORT when data exists
    expect(valueOf('Địa chỉ giao hàng')).toBe('Sóng Thần');
    expect(labels()).not.toContain('Trả cont rỗng');
  });

  it('renders each container number paired with its type code (KP-191)', () => {
    render(<DriverTaskInfoSections trip={makeTrip()} />);

    // Each container number is paired with its own type code.
    expect(valueOf('Container / lô hàng')).toBe('MSCU1234561 · 40G1');
    // Seals render on their own row.
    expect(valueOf('Seal')).toBe('Seal SEAL-9');
  });

  it('falls back to dropWarehouseName when dropPortName is null', () => {
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: {
      dropPortName: null,
      dropWarehouseName: 'Legacy Kho',
      lclWarehouseName: 'Legacy LCL',
    } })} />);

    expect(valueOf('Cảng hạ')).toBe('Legacy Kho');
  });

  it('shows "—" when both dropPortName and dropWarehouseName are null', () => {
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: {
      dropPortName: null,
      dropWarehouseName: null,
      lclWarehouseName: null,
    } })} />);

    expect(valueOf('Cảng hạ')).toBe('—');
  });
});


it('renders a legacy task without a container array without crashing', () => {
  const trip = makeTrip();
  trip.containers = null as unknown as DriverTaskDetail['containers'];
  render(<DriverTaskInfoSections trip={trip} />);
  expect(screen.getByText('Container / lô hàng')).toBeTruthy();
  expect(screen.getByText('FCL')).toBeTruthy();
});
