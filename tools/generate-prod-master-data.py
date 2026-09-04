#!/usr/bin/env python3
"""Generate backend/src/seed/data/prod-master-data.ts from the customer's
Excel master-data delivery (users/roles, drivers, customers, sites, routes,
ports, tractors, trailers).

Usage:
  python3 tools/generate-prod-master-data.py <User & Role.xlsx> <Data form.xlsx>

The output is committed; regenerate after the customer sends a new file.
"""
import json
import re
import sys

import openpyxl

OUT = 'backend/src/seed/data/prod-master-data.ts'


def cell(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip()
        return v if v else None
    return v


def title_case_name(n):
    return ' '.join(w.capitalize() for w in str(n).split())


def name_username(full_name):
    # Vietnamese convention: given name + initials of the preceding words,
    # ASCII-folded (Nguyễn Thị Phương -> phuongnt), mirroring the driver
    # sheet's own code style (LƯƠNG VĂN LONG -> LVLONG).
    import unicodedata

    def fold(s):
        s = unicodedata.normalize('NFD', s)
        s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
        return s.replace('đ', 'd').replace('Đ', 'D')

    words = str(full_name).strip().split()
    if len(words) == 1:
        return fold(words[0]).lower()
    given = fold(words[-1]).lower()
    initials = ''.join(fold(w)[0] for w in words[:-1]).lower()
    return f'{given}{initials}'


def iso_date(v):
    import datetime
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.date().isoformat() if isinstance(v, datetime.datetime) else v.isoformat()
    return str(v).strip() if v else None

users = []
drivers = []
customers = []
sites = []
routes = []
ports = []
tractors = []
trailers = []


def extract_users(wb):
    for row in wb['User'].iter_rows(min_row=3, values_only=True):
        code, name, role = cell(row[0]), cell(row[1]), cell(row[2])
        if not code or not name:
            continue
        users.append({
            'username': name_username(name),
            'employeeCode': str(code),
            'fullName': str(name).strip(),
            'roleGroup': str(role).strip(),
        })


def extract_drivers(wb):
    for row in wb['Lái xe'].iter_rows(min_row=3, values_only=True):
        vals = [cell(c) for c in row[:9]]
        code, name, cccd, gplx, gplx_exp, phone, bank, acct, salary_type = vals
        if not code or not name:
            continue
        drivers.append({
            'code': str(code).strip(),
            'username': str(code).strip().lower(),
            'name': title_case_name(str(name)),
            'idNumber': str(cccd).strip() if cccd else None,
            'licenseNumber': str(gplx).strip() if gplx else None,
            'licenseExpiryDate': iso_date(gplx_exp),
            'phone': str(phone).strip() if phone else None,
            'bankName': str(bank) if bank else None,
            'bankAccount': str(acct).strip() if acct else None,
            'salaryType': str(salary_type) if salary_type else None,
        })


def extract_customers(wb2):
    for row in wb2['Khách hàng'].iter_rows(min_row=3, values_only=True):
        vals = [cell(c) for c in row[:12]]
        name, short, code, tax, addr, director, dir_phone, acc, acc_phone, email, chi_ho, cuoc = vals
        if not name:
            continue
        customers.append({
            'name': str(name),
            'shortName': str(short) if short else None,
            'code': str(code) if code else None,
            'taxCode': str(tax) if tax else None,
            'address': addr,
            'director': director,
            'directorPhone': str(dir_phone) if dir_phone else None,
            'accountantName': str(acc) if acc else None,
            'accountantPhone': str(acc_phone) if acc_phone else None,
            'email': email,
            'paymentTermChiHoDays': int(chi_ho) if chi_ho else None,
            'paymentTermCuocDays': int(cuoc) if cuoc else None,
        })


def extract_sites(wb2):
    for row in wb2['Nhà máy & Kho'].iter_rows(min_row=3, values_only=True):
        vals = [cell(c) for c in row[:14]]
        (name, code, short, cust_code, route_name, addr, owner, owner_phone,
         wh_contact, note, lift_info, drop_info, wash_info, maps) = vals
        if not code:
            continue
        sites.append({
            'name': str(name),
            'code': str(code).strip(),
            'shortName': str(short) if short else None,
            'customerCode': str(cust_code) if cust_code else None,
            'routeName': route_name,
            'address': addr,
            'note': note,
            'contactName': str(owner) if owner else None,
            'contactPhone': str(owner_phone) if owner_phone else None,
            'warehouseContactInfo': wh_contact,
            'liftInfo': lift_info,
            'dropInfo': drop_info,
            'cleaningInfo': wash_info,
            'mapsUrl': maps,
        })


def extract_routes(wb2):
    for row in wb2['Tuyến đường'].iter_rows(min_row=3, values_only=True):
        vals = [cell(c) for c in row[:7]]
        code, name, short, point, km, tolls, note = vals
        if not code:
            continue
        tolls_val = None
        if tolls is not None:
            t = str(tolls).strip().replace('.', '').replace(',', '')
            tolls_val = int(t) if t.isdigit() else None
        routes.append({
            'name': str(code),
            'code': str(code),
            'fullName': str(name) or '',
            'shortName': str(short) or '',
            'loadPoint': point,
            'distanceKm': int(km) if km else None,
            'tolls': tolls_val,
            'note': note,
        })


def extract_ports(wb2):
    for row in wb2['Cảng & Bãi'].iter_rows(min_row=3, values_only=True):
        vals = [cell(c) for c in row[:16]]
        (name, code, ptype, legal, addr, lachuyen, web, l20e, l20f, l40e, l40f,
         h20e, h20f, h40e, h40f, pos) = vals
        if not name:
            continue
        ports.append({
            'name': str(name),
            'code': str(code) if code else None,
            'classification': str(ptype) if ptype else None,
            'legalEntity': legal,
            'address': addr,
            'isLachHuyen': (str(lachuyen).strip() == 'Có') if lachuyen else False,
            'opsPortalUrl': web,
            'position': pos,
        })


def normalize_plate(raw):
    plate = re.sub(r'\s+', '', str(raw)).replace(',', '.')
    m = re.match(r'^(\d{2}[A-Za-z]{1,2})-?(\d{2,5})\.?(\d{2})$', plate)
    if m:
        return f'{m.group(1)}-{m.group(2)}.{m.group(3)}'
    return str(raw).replace(' ', '')


def extract_tractors(wb2):
    seen = {}
    for row in wb2['Đầu kéo'].iter_rows(min_row=3, values_only=True):
        vals = [cell(c) for c in row[:11]]
        (plate_raw, driver_name, vtype, brand, tow, fuel_full, fuel_empty,
         inspect, insurance, route, note) = vals
        if not plate_raw:
            continue
        plate = normalize_plate(plate_raw)
        driver_tc = title_case_name(str(driver_name)) if driver_name else None
        tractors.append({
            'plate': plate,
            'driverName': driver_tc,
            'vehicleClass': str(vtype) if vtype else None,
            'brand': str(brand) if brand else None,
            'towCapacityTons': float(tow) if tow else None,
            'fuelLPer100kmLoaded': float(fuel_full) if fuel_full else None,
            'fuelLPer100kmEmpty': float(fuel_empty) if fuel_empty else None,
            'inspectionDeadline': iso_date(inspect),
            'insuranceExpiry': iso_date(insurance),
            'preferredRoute': str(route) if route else None,
            'note': str(note) if note else None,
        })
        if plate in seen and seen[plate] != driver_tc:
            print(f'WARNING duplicate tractor plate {plate}: '
                  f'{seen[plate]} AND {driver_tc}', file=sys.stderr)
        seen[plate] = driver_tc


def num_tons(v):
    if v is None:
        return None
    try:
        return float(str(v).replace(',', '.'))
    except ValueError:
        return None


def extract_trailers(wb2):
    for row in wb2['Mooc'].iter_rows(min_row=3, values_only=True):
        vals = [cell(c) for c in row[:8]]
        (plate_raw, paired, ttype, max_load, front, rear, inspect, note) = vals
        if not plate_raw:
            continue
        trailers.append({
            'plate': re.sub(r'\s+', '', str(plate_raw)),
            'pairedTractor': normalize_plate(paired) if paired else None,
            'type': str(ttype) if ttype else None,
            'maxPayloadTons': num_tons(max_load),
            'maxAxleLoadFrontTons': num_tons(front),
            'maxAxleLoadRearTons': num_tons(rear),
            'inspectionDeadline': iso_date(inspect),
            'note': str(note) if note else None,
        })


TS_INTERFACES = """// AUTO-GENERATED by tools/generate-prod-master-data.py — do not hand-edit.
// Source: the customer's Excel master-data delivery. Regenerate with:
//   python3 tools/generate-prod-master-data.py <User & Role.xlsx> <Data form.xlsx>
export interface ProdStaffSeed { username: string; employeeCode: string; fullName: string; roleGroup: string; }
export interface ProdDriverSeed { code: string; username: string; name: string; idNumber: string | null; licenseNumber: string | null; licenseExpiryDate: string | null; phone: string | null; bankName: string | null; bankAccount: string | null; salaryType: string | null; }
export interface ProdCustomerSeed { name: string; shortName: string | null; code: string; taxCode: string | null; address: string | null; director: string | null; directorPhone: string | null; accountantName: string | null; accountantPhone: string | null; email: string | null; paymentTermChiHoDays: number | null; paymentTermCuocDays: number | null; }
export interface ProdSiteSeed { name: string; code: string; shortName: string | null; customerCode: string | null; routeName: string | null; address: string | null; note: string | null; contactName: string | null; contactPhone: string | null; warehouseContactInfo: string | null; liftInfo: string | null; dropInfo: string | null; cleaningInfo: string | null; mapsUrl: string | null; }
export interface ProdRouteSeed { name: string; code: string; fullName: string; shortName: string; loadPoint: string | null; distanceKm: number | null; tolls: number | null; note: string | null; }
export interface ProdTractorSeed { plate: string; driverName: string | null; vehicleClass: string | null; brand: string | null; towCapacityTons: number | null; fuelLPer100kmLoaded: number | null; fuelLPer100kmEmpty: number | null; inspectionDeadline: string | null; insuranceExpiry: string | null; preferredRoute: string | null; note: string | null; }
export interface ProdTrailerSeed { plate: string; pairedTractor: string | null; type: string | null; maxPayloadTons: number | null; maxAxleLoadFrontTons: number | null; maxAxleLoadRearTons: number | null; inspectionDeadline: string | null; note: string | null; }
export interface ProdPortSeed { name: string; code: string | null; classification: string | null; legalEntity: string | null; address: string | null; isLachHuyen: boolean; opsPortalUrl: string | null; position: string | null; }
"""


def main():
    users_wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
    data_wb = openpyxl.load_workbook(sys.argv[2], data_only=True)
    extract_users(users_wb)
    extract_drivers(users_wb)
    extract_customers(data_wb)
    extract_sites(data_wb)
    extract_routes(data_wb)
    extract_ports(data_wb)
    extract_tractors(data_wb)
    extract_trailers(data_wb)
    sections = [
        ('prodStaff', 'ProdStaffSeed', users),
        ('prodDrivers', 'ProdDriverSeed', drivers),
        ('prodCustomers', 'ProdCustomerSeed', customers),
        ('prodSites', 'ProdSiteSeed', sites),
        ('prodRoutes', 'ProdRouteSeed', routes),
        ('prodTractors', 'ProdTractorSeed', tractors),
        ('prodTrailers', 'ProdTrailerSeed', trailers),
        ('prodPorts', 'ProdPortSeed', ports),
    ]
    out = [TS_INTERFACES]
    for name, iface, rows in sections:
        out.append(f'export const {name}: {iface}[] = '
                   + json.dumps(rows, ensure_ascii=False, indent=2) + ';')
        out.append('')
    with open(OUT, 'w') as f:
        f.write('\n'.join(out))
    counts = ', '.join(f'{n}={len(r)}' for n, _, r in sections)
    print(f'wrote {OUT}: {counts}')


if __name__ == '__main__':
    main()
