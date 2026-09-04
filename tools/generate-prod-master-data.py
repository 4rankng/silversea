#!/usr/bin/env python3
"""Generate backend/src/seed/data/prod-master-data.ts from the customer's
Excel master-data delivery (staff, drivers, customers, sites, routes, ports,
tractors, trailers, carriers).

Usage:
  python3 tools/generate-prod-master-data.py <Import data form.xlsx> <User & Role.xlsx>

Two-file delivery (2026-09-04 "4.9"): master data comes from the 4.9 Import
data form (single workbook incl. Nhân viên HR sheet and Nhà xe carriers);
STAFF ACCOUNTS come from User & Role.xlsx (User sheet, NV001..NV022 with
R_* role codes — this file is the account authority; its Lái xe sheet is an
older subset, so drivers still come from the 4.9 form).
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
carriers = []


def extract_staff(wb):
    # "User" sheet of User & Role.xlsx (account authority): NV001..NV022,
    # R_* permission code + role group. Tên đăng nhập is normally blank —
    # logins derive from the full name (same convention as prod today).
    for row in wb['User'].iter_rows(min_row=3, values_only=True):
        vals = row_vals(row, 6)
        code, name, login, role_code, _email, role_group = vals
        if not code or not name:
            continue
        users.append({
            'username': str(login).strip().lower() if login else name_username(name),
            'employeeCode': str(code),
            'fullName': title_case_name(str(name)),
            'roleCode': str(role_code).strip() if role_code else None,
            'roleGroup': str(role_group).strip() if role_group else None,
        })


def extract_carriers(wb):
    # "Nhà xe" (4.9 delivery): subcontractor trucking companies -> suppliers
    # with type CARRIER. Payment-term columns exist in the sheet but are blank.
    for row in wb['Nhà xe'].iter_rows(min_row=3, values_only=True):
        vals = [cell(c) for c in row[:7]]
        name, short, code, tax, addr, director, phone = vals
        if not name:
            continue
        carriers.append({
            'name': str(name),
            'shortName': str(short or code or name).strip(),
            'taxCode': str(tax) if tax else None,
            'address': addr,
            'contactPerson': str(director) if director else None,
            'phone': str(phone).strip() if phone else None,
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


def extract_customers(wb):
    for row in wb['Khách hàng'].iter_rows(min_row=3, values_only=True):
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


def row_vals(row, n):
    # openpyxl trims trailing empty cells — pad so unpacking never breaks.
    return [cell(c) for c in list(row[:n]) + [None] * n][:n]


def sheet_junk(v):
    # Customer markers for "fill this in later" / "ignore this cell".
    return v is None or str(v).strip().lower() in ('bỏ', 'bỏ cột này', 'bổ sung sau')


def extract_sites(wb):
    # 4.9 layout: a "Tên tuyến rút gọn" column was inserted at position 6
    # (address moved 6 -> 7) and "Khoảng cách"/"Vé cầu đường" appended at
    # 16/17 (route-level info — owned by the Tuyến đường sheet, skipped here).
    for row in wb['Nhà máy & Kho'].iter_rows(min_row=3, values_only=True):
        vals = row_vals(row, 17)
        (name, code, short, cust_code, route_full, route_short, addr, owner,
         owner_phone, wh_contact, note, lift_info, drop_info, wash_info,
         maps, km, toll_note) = vals
        if not code or str(code).strip().upper() == 'NO NAME':
            continue
        sites.append({
            'name': str(name),
            'code': str(code).strip(),
            'shortName': str(short) if short else None,
            'customerCode': str(cust_code) if cust_code else None,
            'routeName': route_full,
            'address': addr,
            'note': note,
            'contactName': None if sheet_junk(owner) else str(owner),
            'contactPhone': None if sheet_junk(owner_phone) else str(owner_phone),
            'warehouseContactInfo': wh_contact,
            'liftInfo': None if sheet_junk(lift_info) else lift_info,
            'dropInfo': None if sheet_junk(drop_info) else drop_info,
            'cleaningInfo': None if sheet_junk(wash_info) else wash_info,
            'mapsUrl': maps,
        })


def extract_routes(wb):
    for row in wb['Tuyến đường'].iter_rows(min_row=3, values_only=True):
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
            'loadPoint': None if sheet_junk(point) else point,
            'distanceKm': int(km) if km else None,
            'tolls': tolls_val,
            'note': note,
        })


def extract_ports(wb):
    for row in wb['Cảng & Bãi'].iter_rows(min_row=3, values_only=True):
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


def extract_tractors(wb):
    seen = {}
    for row in wb['Đầu kéo'].iter_rows(min_row=3, values_only=True):
        vals = row_vals(row, 11)
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


def extract_trailers(wb):
    for row in wb['Mooc'].iter_rows(min_row=3, values_only=True):
        vals = row_vals(row, 8)
        (plate_raw, paired, ttype, max_load, front, rear, inspect, note) = vals
        if not plate_raw:
            continue
        trailers.append({
            'plate': normalize_plate(plate_raw),
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
//   python3 tools/generate-prod-master-data.py <Import data form.xlsx>
export interface ProdStaffSeed { username: string; employeeCode: string; fullName: string; roleCode: string | null; roleGroup: string | null; }
export interface ProdDriverSeed { code: string; username: string; name: string; idNumber: string | null; licenseNumber: string | null; licenseExpiryDate: string | null; phone: string | null; bankName: string | null; bankAccount: string | null; salaryType: string | null; }
export interface ProdCustomerSeed { name: string; shortName: string | null; code: string; taxCode: string | null; address: string | null; director: string | null; directorPhone: string | null; accountantName: string | null; accountantPhone: string | null; email: string | null; paymentTermChiHoDays: number | null; paymentTermCuocDays: number | null; }
export interface ProdSiteSeed { name: string; code: string; shortName: string | null; customerCode: string | null; routeName: string | null; address: string | null; note: string | null; contactName: string | null; contactPhone: string | null; warehouseContactInfo: string | null; liftInfo: string | null; dropInfo: string | null; cleaningInfo: string | null; mapsUrl: string | null; }
export interface ProdRouteSeed { name: string; code: string; fullName: string; shortName: string; loadPoint: string | null; distanceKm: number | null; tolls: number | null; note: string | null; }
export interface ProdTractorSeed { plate: string; driverName: string | null; vehicleClass: string | null; brand: string | null; towCapacityTons: number | null; fuelLPer100kmLoaded: number | null; fuelLPer100kmEmpty: number | null; inspectionDeadline: string | null; insuranceExpiry: string | null; preferredRoute: string | null; note: string | null; }
export interface ProdTrailerSeed { plate: string; pairedTractor: string | null; type: string | null; maxPayloadTons: number | null; maxAxleLoadFrontTons: number | null; maxAxleLoadRearTons: number | null; inspectionDeadline: string | null; note: string | null; }
export interface ProdPortSeed { name: string; code: string | null; classification: string | null; legalEntity: string | null; address: string | null; isLachHuyen: boolean; opsPortalUrl: string | null; position: string | null; }
export interface ProdCarrierSeed { name: string; shortName: string; taxCode: string | null; address: string | null; contactPerson: string | null; phone: string | null; }
"""


def main():
    wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
    users_wb = openpyxl.load_workbook(sys.argv[2], data_only=True)
    extract_staff(users_wb)
    extract_drivers(wb)
    extract_customers(wb)
    extract_sites(wb)
    extract_routes(wb)
    extract_ports(wb)
    extract_tractors(wb)
    extract_trailers(wb)
    extract_carriers(wb)
    sections = [
        ('prodStaff', 'ProdStaffSeed', users),
        ('prodDrivers', 'ProdDriverSeed', drivers),
        ('prodCustomers', 'ProdCustomerSeed', customers),
        ('prodSites', 'ProdSiteSeed', sites),
        ('prodRoutes', 'ProdRouteSeed', routes),
        ('prodTractors', 'ProdTractorSeed', tractors),
        ('prodTrailers', 'ProdTrailerSeed', trailers),
        ('prodPorts', 'ProdPortSeed', ports),
        ('prodCarriers', 'ProdCarrierSeed', carriers),
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
