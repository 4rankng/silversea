import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TripStatus } from '@tingting/shared';
import { DriverTaskInfoSections } from './DriverTaskInfoSections';
import type { DriverTaskDetail } from '../../api/driverClient';

/**
 * Component-level coverage for the THÔNG TIN LỆNH fact grid and the
 * THÔNG TIN XUẤT HÓA ĐƠN block: field order, factory block (abbrev with
 * fallback, canonical full name, site address), route-only Tuyến,
 * always-visible warehouse phone, and per-segment fee-invoice rows.
 * The page suite (DriverTripDetailPage.test.tsx) locks the same behavior
 * through the full page render — both must move in lockstep.
 */

function makeTrip(overrides: {
  fulfillment?: Partial<NonNullable<DriverTaskDetail['fulfillment']>>;
  invoiceMaster?: DriverTaskDetail['invoiceMaster'];
  invoiceFactory?: DriverTaskDetail['invoiceFactory'];
  routeName?: string | null;
} = {}): DriverTaskDetail {
  return {
    id: 55,
    version: 3,
    tripCode: 'TRIP-55',
    status: TripStatus.IN_TRANSIT,
    departureDate: '2026-08-01',
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
  it('renders the full fact-grid order: factory block, container, ports, route, warehouse phone, schedule, contacts', () => {
    render(<DriverTaskInfoSections trip={makeTrip()} />);

    expect(labels()).toEqual([
      'Nhà máy',
      'Tên nhà máy',
      'Địa chỉ nhà máy',
      'Container / lô hàng',
      'Cảng nâng',
      'Cảng hạ',
      'Tuyến',
      'SĐT kho',
      'Ngày giờ kế hoạch',
      'Người liên hệ',
      'Số điện thoại',
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

  it('renders the warehouse-phone row as a tel link when the site has a phone', () => {
    render(<DriverTaskInfoSections trip={makeTrip()} />);

    const link = screen.getByText('0901234567');
    expect(link.getAttribute('href')).toBe('tel:0901234567');
  });

  it('keeps the warehouse-phone row visible with "—" when the site has no phone', () => {
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: { khoPhone: null } })} />);

    expect(labels()).toContain('SĐT kho');
    expect(valueOf('SĐT kho')).toBe('—');
  });

  it('renders route text on Tuyến — the factory address never leaks into it', () => {
    render(<DriverTaskInfoSections trip={makeTrip()} />);

    expect(valueOf('Tuyến')).toBe('Cát Lái → Thuận An');
    expect(valueOf('Tuyến')).not.toContain('KCN Việt Nam');
  });

  it('falls back to the route name when no route summary exists, "—" when neither', () => {
    const { unmount } = render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: { routeSummary: null } })} />);
    expect(valueOf('Tuyến')).toBe('Cảng Cát Lái → Nhà máy Bình Dương');
    unmount();

    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: { routeSummary: null }, routeName: null })} />);
    expect(valueOf('Tuyến')).toBe('—');
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

  it('hides the invoice section when neither invoice info nor master data rides the wire', () => {
    render(<DriverTaskInfoSections trip={makeTrip()} />);

    expect(screen.queryByText('Thông tin xuất hóa đơn')).toBeNull();
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

  it('renders the empty-container return depot as its own row between Cảng hạ and Tuyến', () => {
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: { returnDepotName: 'Bãi JJ LOGISTICS' } })} />);

    expect(labels()).toEqual([
      'Nhà máy',
      'Tên nhà máy',
      'Địa chỉ nhà máy',
      'Container / lô hàng',
      'Cảng nâng',
      'Cảng hạ',
      'Trả cont rỗng',
      'Tuyến',
      'SĐT kho',
      'Ngày giờ kế hoạch',
      'Người liên hệ',
      'Số điện thoại',
    ]);
    expect(valueOf('Cảng hạ')).toBe('Sóng Thần');
    expect(valueOf('Trả cont rỗng')).toBe('Bãi JJ LOGISTICS');
  });

  it('renders the wire drop point authoritatively — "—" when the chain resolves null, ignoring legacy local fallbacks', () => {
    render(<DriverTaskInfoSections trip={makeTrip({ fulfillment: {
      dropPortName: null,
      dropWarehouseName: 'Legacy Kho',
      lclWarehouseName: 'Legacy LCL',
    } })} />);

    expect(valueOf('Cảng hạ')).toBe('—');
  });
});
