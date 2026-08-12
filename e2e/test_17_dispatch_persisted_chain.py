#!/usr/bin/env python3
"""Persisted cross-role dispatch chain: intake → dispatch → driver → review → debit export."""

from __future__ import annotations

from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
import json
import os
import subprocess
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import *  # noqa: E402,F403


TITLE = "17-dispatch-persisted-chain"
RUN_SUFFIX = uuid.uuid4().hex[:8].upper()
BOOKING_PREFIX = f"E2E-LM-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{RUN_SUFFIX}"
SEARCH_SUFFIX = f"{int(RUN_SUFFIX, 16) % 100_000:05d}"
REPO_ROOT = Path(__file__).resolve().parent.parent
PDF_BYTES = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"
_ACTIVE_FLEET_FIXTURE: dict[str, int | None] | None = None


def sample_png_bytes() -> bytes:
    raw_scanline = b"\x00\xff\xff\xff\xff"

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw_scanline))
        + chunk(b"IEND", b"")
    )


def iso_at(hours_ahead: int) -> str:
    return (datetime.now().astimezone() + timedelta(hours=hours_ahead)).replace(
        minute=0,
        second=0,
        microsecond=0,
    ).isoformat(timespec="minutes")


def month_range(now: datetime | None = None) -> tuple[str, str]:
    ref = now or datetime.now()
    start = ref.replace(day=1)
    if ref.month == 12:
        end = ref.replace(year=ref.year + 1, month=1, day=1) - timedelta(days=1)
    else:
        end = ref.replace(month=ref.month + 1, day=1) - timedelta(days=1)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def first_items(payload):
    if isinstance(payload, dict):
        if isinstance(payload.get("items"), list):
            return payload["items"]
        if isinstance(payload.get("data"), dict) and isinstance(payload["data"].get("items"), list):
            return payload["data"]["items"]
    return []


def get_with_query(api: ApiClient, path: str, params: dict[str, object]):
    query = urllib.parse.urlencode([(key, value) for key, value in params.items() if value not in (None, "", [])], doseq=True)
    suffix = f"{path}?{query}" if query else path
    return api.get(suffix)


def pick_named(items, label: str, needle: str):
    for item in items:
        value = str(item.get(label, ""))
        if needle.lower() in value.lower():
            return item
    return items[0] if items else None


def api_failure_detail(response) -> str:
    if isinstance(response, dict):
        if "error" in response:
            return str(response["error"])
        if "data" in response and isinstance(response["data"], dict) and "error" in response["data"]:
            return str(response["data"]["error"])
    return str(response)


def assert_ok(results: TestResults, tc_id: str, title: str, condition: bool, detail: str) -> bool:
    if condition:
        results.pass_(tc_id, title, detail)
        return True
    results.fail(tc_id, title, detail)
    return False


def require_json_array(results: TestResults, tc_id: str, title: str, response) -> list[dict] | None:
    items = first_items(response)
    if items:
        results.pass_(tc_id, title, f"{len(items)} item(s)")
        return items
    results.fail(tc_id, title, api_failure_detail(response))
    return None


def login_api(role_key: str) -> ApiClient:
    api = ApiClient()
    account = DEMO_ACCOUNTS[role_key]
    login = api.login(account["identifier"], account["password"])
    if not login.get("token"):
        raise RuntimeError(f"login failed for {role_key}: {login}")
    return api


def bootstrap_master_data_fixture(driver_id: int) -> tuple[int, str, str, str, int]:
    global _ACTIVE_FLEET_FIXTURE
    truck_plate = f"E2E-{RUN_SUFFIX}"
    trailer_plate = f"E2E-TR-{RUN_SUFFIX}"
    customer_name = f"CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH E2E {RUN_SUFFIX}"
    customer_tax_code = f"99{int(RUN_SUFFIX, 16) % 100_000_000:08d}"
    script = r"""
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from './src/db';
import * as s from './src/db/schema';
import { seedCustomers } from './src/seed/seed-customers';

const driverId = __DRIVER_ID__;
const truckPlate = __TRUCK_PLATE__;
const trailerPlate = __TRAILER_PLATE__;
const pricingRateKey = `LCL-${truckPlate}`;
const now = new Date();

async function main() {
await seedCustomers();
const customerValues = {
  name: __CUSTOMER_NAME__,
  taxCode: __CUSTOMER_TAX_CODE__,
  contactPerson: 'Ms.Vân',
  phone: '',
  contactInfo: 'longminh.logistic@gmail.com; account1@longminhbn.com.vn',
  status: 'ACTIVE',
  debitNoteMode: 'MONTHLY',
  creditLimit: '1000000000',
  updatedAt: now,
};
const [createdCustomer] = await db.insert(s.customers).values(customerValues).returning({ id: s.customers.id });
if (!createdCustomer) throw new Error('Failed to create isolated E2E customer');
const customerId = createdCustomer.id;

const [clerkUser] = await db.select({ id: s.users.id })
  .from(s.users)
  .where(and(eq(s.users.username, 'cus'), eq(s.users.role, 'CUS')))
  .limit(1);
if (!clerkUser) throw new Error('Seed clerk cus missing');
await db.insert(s.userCustomerLinks)
  .values({ userId: clerkUser.id, customerId })
  .onConflictDoNothing({
    target: [s.userCustomerLinks.userId, s.userCustomerLinks.customerId],
  });

const [routeExisting] = await db.select({ id: s.routes.id })
  .from(s.routes)
  .where(and(
    isNull(s.routes.deletedAt),
    eq(s.routes.name, 'Cát Lái - Long Minh'),
  ))
  .limit(1);
const routeValues = {
  name: 'Cát Lái - Long Minh',
  distanceKm: 30,
  fixedFuelAllowance: null,
  updatedAt: now,
};
let routeId;
if (routeExisting) {
  routeId = routeExisting.id;
  await db.update(s.routes)
    .set(routeValues)
    .where(eq(s.routes.id, routeExisting.id));
} else {
  const [createdRoute] = await db.insert(s.routes).values(routeValues).returning({ id: s.routes.id });
  routeId = createdRoute.id;
}

const [cargoTypeExisting] = await db.select({ id: s.cargoTypes.id })
  .from(s.cargoTypes)
  .where(and(
    isNull(s.cargoTypes.deletedAt),
    eq(s.cargoTypes.name, 'Cont'),
  ))
  .limit(1);
if (!cargoTypeExisting) {
  await db.insert(s.cargoTypes).values({
    name: 'Cont',
    requiresPhotos: true,
    isBulk: false,
    updatedAt: now,
  });
}

const [pricing] = await db.insert(s.pricingTables).values({
  customerId,
  routeId,
  price: '4500000',
  rateKey: pricingRateKey,
  effectiveDate: now.toISOString().slice(0, 10),
}).returning({ id: s.pricingTables.id });

const [factoryExisting] = await db.select({ id: s.operationalSites.id })
  .from(s.operationalSites)
  .where(and(
    eq(s.operationalSites.customerId, customerId),
    eq(s.operationalSites.code, 'LM-FACTORY'),
    isNull(s.operationalSites.deletedAt),
  ))
  .limit(1);
const factoryValues = {
  customerId,
  code: 'LM-FACTORY',
  name: 'Nhà máy Long Minh',
  siteType: 'FACTORY',
  address: 'Khu công nghiệp Long Minh, Bắc Ninh',
  googleMapsUrl: 'https://maps.google.com/?q=Nha+may+Long+Minh',
  contactName: 'Ms.Vân',
  contactPhone: '0900000000',
  liftFeeInvoiceName: 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH',
  liftFeeInvoiceAddress: 'Khu 2, Phường Võ Cường, Tỉnh Bắc Ninh',
  liftFeeTaxCode: '2300540419',
  strictRules: 'Gọi điện trước khi vào; cấm hút thuốc; thời gian đỗ tối đa 30 phút',
  isActive: true,
  updatedAt: now,
};
if (factoryExisting) {
  await db.update(s.operationalSites)
    .set({ ...factoryValues, version: sql`${s.operationalSites.version} + 1` })
    .where(eq(s.operationalSites.id, factoryExisting.id));
} else {
  await db.insert(s.operationalSites).values(factoryValues);
}

const [warehouseExisting] = await db.select({ id: s.operationalSites.id })
  .from(s.operationalSites)
  .where(and(
    eq(s.operationalSites.customerId, customerId),
    eq(s.operationalSites.code, 'LM-WH'),
    isNull(s.operationalSites.deletedAt),
  ))
  .limit(1);
const warehouseValues = {
  customerId,
  code: 'LM-WH',
  name: 'Kho Long Minh',
  siteType: 'WAREHOUSE',
  address: 'Kho Long Minh, Bắc Ninh',
  googleMapsUrl: 'https://maps.google.com/?q=Kho+Long+Minh',
  contactName: 'Ms.Vân',
  contactPhone: '0900000000',
  liftFeeInvoiceName: 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH',
  liftFeeInvoiceAddress: 'Khu 2, Phường Võ Cường, Tỉnh Bắc Ninh',
  liftFeeTaxCode: '2300540419',
  strictRules: 'Gọi điện trước khi vào; cấm hút thuốc; thời gian đỗ tối đa 30 phút',
  isActive: true,
  updatedAt: now,
};
if (warehouseExisting) {
  await db.update(s.operationalSites)
    .set({ ...warehouseValues, version: sql`${s.operationalSites.version} + 1` })
    .where(eq(s.operationalSites.id, warehouseExisting.id));
} else {
  await db.insert(s.operationalSites).values(warehouseValues);
}

const [trailerExisting] = await db.select({ id: s.trailers.id })
  .from(s.trailers)
  .where(and(isNull(s.trailers.deletedAt), eq(s.trailers.licensePlate, trailerPlate)))
  .limit(1);
const trailerValues = {
  licensePlate: trailerPlate,
  type: '40FT',
  status: 'ACTIVE',
  updatedAt: now,
};
let trailerId;
if (trailerExisting) {
  trailerId = trailerExisting.id;
  await db.update(s.trailers)
    .set(trailerValues)
    .where(eq(s.trailers.id, trailerExisting.id));
} else {
  const [createdTrailer] = await db.insert(s.trailers).values(trailerValues).returning({ id: s.trailers.id });
  trailerId = createdTrailer.id;
}

const [driverExisting] = await db.select({
  id: s.drivers.id,
  assignedTruckId: s.drivers.assignedTruckId,
})
  .from(s.drivers)
  .where(and(isNull(s.drivers.deletedAt), eq(s.drivers.id, driverId)))
  .limit(1);
if (!driverExisting) throw new Error(`Driver ${driverId} missing`);

const [createdTruck] = await db.insert(s.trucks).values({
  licensePlate: truckPlate,
  currentTrailerId: trailerId,
  trailerPlateNumber: trailerPlate,
  trailerType: '40FT',
  status: 'ACTIVE',
  updatedAt: now,
}).returning({ id: s.trucks.id });
if (!createdTruck) throw new Error('Failed to create isolated E2E truck');

await db.update(s.drivers)
  .set({ assignedTruckId: createdTruck.id, updatedAt: now })
  .where(eq(s.drivers.id, driverId));

const [latestActiveTrip] = await db.select({ plannedEndAt: s.trips.plannedEndAt })
  .from(s.trips)
  .where(and(
    eq(s.trips.driverId, driverId),
    isNull(s.trips.deletedAt),
    inArray(s.trips.status, ['CREATED', 'IN_TRANSIT']),
    isNotNull(s.trips.plannedEndAt),
  ))
  .orderBy(desc(s.trips.plannedEndAt))
  .limit(1);
const nextHour = new Date(now);
nextHour.setMinutes(0, 0, 0);
nextHour.setHours(nextHour.getHours() + 1);
const latestEnd = latestActiveTrip?.plannedEndAt?.getTime() ?? 0;
// Keep a full-day safety gap because the local PostgreSQL column is timestamp
// without time zone while the API contract requires an explicit offset.
const plannedStartAt = new Date(Math.max(nextHour.getTime(), latestEnd + 24 * 60 * 60 * 1000));
const plannedEndAt = new Date(plannedStartAt.getTime() + 2 * 60 * 60 * 1000);

console.log(JSON.stringify({
  customerId,
  driverId,
  originalAssignedTruckId: driverExisting.assignedTruckId,
  truckId: createdTruck.id,
  trailerId,
  pricingTableId: pricing.id,
  pricingRateKey,
  plannedStartAt: plannedStartAt.toISOString(),
  plannedEndAt: plannedEndAt.toISOString(),
  factoryId: factoryExisting?.id ?? null,
  warehouseId: warehouseExisting?.id ?? null,
}));
}

main().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
"""
    bootstrap_script = (
        script
        .replace("__DRIVER_ID__", str(driver_id))
        .replace("__TRUCK_PLATE__", json.dumps(truck_plate))
        .replace("__TRAILER_PLATE__", json.dumps(trailer_plate))
        .replace("__CUSTOMER_NAME__", json.dumps(customer_name))
        .replace("__CUSTOMER_TAX_CODE__", json.dumps(customer_tax_code))
    )
    result = subprocess.run(
        ["pnpm", "exec", "tsx", "-e", bootstrap_script],
        cwd=REPO_ROOT / "backend",
        env={
            **os.environ,
            "DATABASE_URL": "postgres://postgres:postgres@localhost:5441/silversea",
        },
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "master data bootstrap failed:\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    for line in reversed(result.stdout.splitlines()):
        try:
            fixture = json.loads(line)
        except json.JSONDecodeError:
            continue
        if (
            isinstance(fixture, dict)
            and isinstance(fixture.get("truckId"), int)
            and isinstance(fixture.get("plannedStartAt"), str)
            and isinstance(fixture.get("plannedEndAt"), str)
        ):
            truck_id = fixture["truckId"]
            _ACTIVE_FLEET_FIXTURE = {
                "driverId": fixture["driverId"],
                "customerId": fixture["customerId"],
                "originalAssignedTruckId": fixture.get("originalAssignedTruckId"),
                "truckId": truck_id,
                "trailerId": fixture["trailerId"],
                "pricingTableId": fixture["pricingTableId"],
            }
            print(
                f"🧱 Bootstrapped isolated Long Minh fixture with truck #{truck_id} "
                f"for {fixture['plannedStartAt']} → {fixture['plannedEndAt']}"
            )
            return truck_id, fixture["plannedStartAt"], fixture["plannedEndAt"], fixture["pricingRateKey"], fixture["customerId"]
    raise RuntimeError(f"master data bootstrap did not return dispatch fixture data:\n{result.stdout}")


def cleanup_fleet_fixture() -> None:
    """Restore the demo driver and retire per-run fleet assets after local E2E."""
    global _ACTIVE_FLEET_FIXTURE
    fixture = _ACTIVE_FLEET_FIXTURE
    if fixture is None:
        return
    cleanup_script = r"""
import { eq } from 'drizzle-orm';
import { db } from './src/db';
import * as s from './src/db/schema';

const driverId = __DRIVER_ID__;
const originalAssignedTruckId = __ORIGINAL_TRUCK_ID__;
const truckId = __TRUCK_ID__;
const trailerId = __TRAILER_ID__;
const pricingTableId = __PRICING_TABLE_ID__;
const customerId = __CUSTOMER_ID__;
const now = new Date();

async function main() {
  await db.update(s.drivers)
    .set({ assignedTruckId: originalAssignedTruckId, updatedAt: now })
    .where(eq(s.drivers.id, driverId));
  await db.update(s.trucks)
    .set({ status: 'INACTIVE', deletedAt: now, updatedAt: now })
    .where(eq(s.trucks.id, truckId));
  await db.update(s.trailers)
    .set({ status: 'INACTIVE', deletedAt: now, updatedAt: now })
    .where(eq(s.trailers.id, trailerId));
  await db.delete(s.pricingTables).where(eq(s.pricingTables.id, pricingTableId));
  await db.delete(s.userCustomerLinks).where(eq(s.userCustomerLinks.customerId, customerId));
  await db.update(s.operationalSites)
    .set({ isActive: false, deletedAt: now, updatedAt: now })
    .where(eq(s.operationalSites.customerId, customerId));
  await db.update(s.customers)
    .set({ status: 'INACTIVE', deletedAt: now, updatedAt: now })
    .where(eq(s.customers.id, customerId));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
"""
    cleanup_script = (
        cleanup_script
        .replace("__DRIVER_ID__", str(fixture["driverId"]))
        .replace("__ORIGINAL_TRUCK_ID__", "null" if fixture["originalAssignedTruckId"] is None else str(fixture["originalAssignedTruckId"]))
        .replace("__TRUCK_ID__", str(fixture["truckId"]))
        .replace("__TRAILER_ID__", str(fixture["trailerId"]))
        .replace("__PRICING_TABLE_ID__", str(fixture["pricingTableId"]))
        .replace("__CUSTOMER_ID__", str(fixture["customerId"]))
    )
    result = subprocess.run(
        ["pnpm", "exec", "tsx", "-e", cleanup_script],
        cwd=REPO_ROOT / "backend",
        env={
            **os.environ,
            "DATABASE_URL": "postgres://postgres:postgres@localhost:5441/silversea",
        },
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "fleet fixture cleanup failed:\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    print(f"🧹 Restored driver assignment and retired truck #{fixture['truckId']}")
    _ACTIVE_FLEET_FIXTURE = None


def ensure_master_data_loaded(admin_api: ApiClient, driver_id: int) -> tuple[int, str, str, str, int]:
    truck_id, planned_start_at, planned_end_at, pricing_rate_key, customer_id = bootstrap_master_data_fixture(driver_id)
    customers = first_items(get_with_query(admin_api, "/api/customers", {"search": RUN_SUFFIX, "page": 1, "pageSize": 25}))
    if not customers:
        raise RuntimeError("Long Minh customer missing after bootstrap")
    return truck_id, planned_start_at, planned_end_at, pricing_rate_key, customer_id


def request_binary(api: ApiClient, path: str, *, headers: dict[str, str] | None = None) -> tuple[int, dict[str, str], bytes]:
    req_headers = {"Accept": "*/*"}
    if api.token:
        req_headers["Authorization"] = f"Bearer {api.token}"
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(f"{api.base_url}{path}", headers=req_headers, method="GET")
    with urllib.request.urlopen(req) as resp:
        return resp.status, dict(resp.headers.items()), resp.read()


def request_json(api: ApiClient, method: str, path: str, body=None, *, headers: dict[str, str] | None = None):
    url = f"{api.base_url}{path}"
    req_headers = {"Content-Type": "application/json"}
    if api.token:
        req_headers["Authorization"] = f"Bearer {api.token}"
    if headers:
        req_headers.update(headers)
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            payload = resp.read()
            return resp.status, json.loads(payload) if payload else None
    except urllib.error.HTTPError as err:
        payload = err.read()
        try:
            parsed = json.loads(payload) if payload else None
        except Exception:
            parsed = payload.decode("utf-8", errors="replace")
        return err.code, parsed


def request_multipart(
    api: ApiClient,
    path: str,
    *,
    fields: dict[str, str],
    file_field: str,
    filename: str,
    file_bytes: bytes,
    content_type: str,
    idempotency_key: str,
):
    url = f"{api.base_url}{path}"
    boundary = f"----CodexBoundary{uuid.uuid4().hex}"
    parts = []
    for key, value in fields.items():
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
        parts.append(str(value).encode())
        parts.append(b"\r\n")
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'.encode())
    parts.append(f"Content-Type: {content_type}\r\n\r\n".encode())
    parts.append(file_bytes)
    parts.append(b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    headers = {
        "Authorization": f"Bearer {api.token}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Idempotency-Key": idempotency_key,
    }
    req = urllib.request.Request(url, data=b"".join(parts), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            payload = resp.read()
            return resp.status, json.loads(payload) if payload else None
    except urllib.error.HTTPError as err:
        payload = err.read()
        try:
            parsed = json.loads(payload) if payload else None
        except Exception:
            parsed = payload.decode("utf-8", errors="replace")
        return err.code, parsed


def workbook_has_expected_template(blob: bytes, template_name: str, bill_number: str) -> tuple[bool, str]:
    with zipfile.ZipFile(BytesIO(blob)) as zf:
        workbook_text = zf.read("xl/workbook.xml").decode("utf-8", errors="replace")
        haystack = "\n".join(
            zf.read(name).decode("utf-8", errors="replace")
            for name in zf.namelist()
            if name.endswith(".xml")
        )
    ok = "Long Minh Debit" in workbook_text and template_name in haystack and bill_number in haystack
    detail = f"sheet={'Long Minh Debit' in workbook_text}, template={template_name in haystack}, bill={bill_number in haystack}"
    return ok, detail


def test_dispatch_persisted_chain(ctx: NepoTestContext, results: TestResults):
    admin_api = login_api("admin")
    clerk_api = login_api("clerk")
    manager_api = login_api("manager")
    driver_api = login_api("driver")
    forwarder_api = login_api("forwarder")
    accountant_api = login_api("accountant")
    month_from, month_to = month_range()
    driver_me_status, driver_me_body = request_json(driver_api, "GET", "/api/auth/me")
    if driver_me_status != 200 or not isinstance(driver_me_body, dict) or not isinstance(driver_me_body.get("id"), int):
        results.fail("TC-1706", "Driver identity resolves", api_failure_detail(driver_me_body))
        return
    driver_profile = driver_me_body.get("driver")
    if not isinstance(driver_profile, dict) or not isinstance(driver_profile.get("id"), int) or not isinstance(driver_profile.get("assignedTruckId"), int):
        results.fail("TC-1706", "Driver profile exposes assigned truck", str(driver_me_body))
        return
    driver_record_id = driver_profile["id"]
    truck_id, planned_start_at, planned_end_at, pricing_rate_key, customer_id = ensure_master_data_loaded(admin_api, driver_record_id)
    # Scope bootstrap invalidates the clerk's prior token by design.
    clerk_api = login_api("clerk")

    customers = require_json_array(
        results,
        "TC-1701",
        "Seed customers include Long Minh",
        get_with_query(admin_api, "/api/customers", {"search": RUN_SUFFIX, "page": 1, "pageSize": 25}),
    )
    if not customers:
        return
    customer = next((item for item in customers if item.get("id") == customer_id), None)
    if not customer or not isinstance(customer.get("id"), int):
        results.fail("TC-1701", "Seed customers include Long Minh", str(customers[:3]))
        return

    routes = require_json_array(
        results,
        "TC-1702",
        "Seed routes include Long Minh",
        get_with_query(admin_api, "/api/routes", {"search": "Long Minh", "page": 1, "pageSize": 25}),
    )
    if not routes:
        return
    route = next((item for item in routes if item.get("name") == "Cát Lái - Long Minh"), None) or pick_named(routes, "name", "Long Minh")
    if not route or not isinstance(route.get("id"), int):
        results.fail("TC-1702", "Seed routes include Long Minh", str(routes[:3]))
        return

    cargo_types = require_json_array(
        results,
        "TC-1703",
        "Seed cargo types available",
        get_with_query(admin_api, "/api/cargo-types", {"search": "Cont", "page": 1, "pageSize": 25}),
    )
    if not cargo_types:
        return
    cargo_type = cargo_types[0]
    if not isinstance(cargo_type.get("id"), int):
        results.fail("TC-1703", "Seed cargo type contract", str(cargo_type))
        return

    templates = require_json_array(
        results,
        "TC-1704",
        "Long Minh debit template is seeded",
        get_with_query(admin_api, "/api/debit-note-templates", {"search": "Long Minh", "page": 1, "pageSize": 25}),
    )
    if not templates:
        return
    template = pick_named(templates, "name", "MẪU DEBIT LONG MINH")
    if not template or not isinstance(template.get("id"), int):
        results.fail("TC-1704", "Long Minh debit template is seeded", str(templates[:3]))
        return

    sites_payload = admin_api.get(f"/api/shipments/operational-sites?customerId={customer['id']}")
    sites = require_json_array(results, "TC-1705", "Admin can read Long Minh operational sites", sites_payload)
    if not sites:
        return
    factory = pick_named([site for site in sites if site.get("siteType") == "FACTORY"], "name", "Nhà máy")
    warehouse = pick_named([site for site in sites if site.get("siteType") == "WAREHOUSE"], "name", "Kho")
    if not factory or not warehouse:
        results.fail("TC-1705", "Long Minh operational sites", str(sites))
        return
    if not isinstance(factory.get("id"), int) or not isinstance(warehouse.get("id"), int):
        results.fail("TC-1705", "Long Minh operational site contract", str({"factory": factory, "warehouse": warehouse}))
        return

    booking_ref = f"{BOOKING_PREFIX}-BOOKING-{SEARCH_SUFFIX}"
    bl_number = f"BL-{BOOKING_PREFIX}-{SEARCH_SUFFIX}"
    create_payload = {
        "customerId": customer["id"],
        "routeId": route["id"],
        "cargoTypeId": cargo_type["id"],
        "cargoMode": "LCL",
        "tradeDirection": "IMPORT",
        "operationalSiteId": factory["id"],
        "pickupWarehouseSiteId": warehouse["id"],
        "bookingRef": booking_ref,
        "blNumber": bl_number,
        "expectedDeliveryDate": datetime.now().strftime("%Y-%m-%d"),
        "packageType": "Pallet",
        "packageCount": 12,
        "cargoWeightKg": "1800",
        "cargoVolumeCbm": "8.50",
        "contactName": "Long Minh contact",
        "contactPhone": "0900000000",
        "operationalNotes": f"persisted-chain-{BOOKING_PREFIX}",
    }
    create_status, create_body = request_json(
        clerk_api,
        "POST",
        "/api/shipments/quick",
        create_payload,
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-quick"},
    )
    if create_status not in (200, 201):
        results.fail("TC-1707", "Clerk creates a new shipment", api_failure_detail(create_body))
        return
    shipment = create_body
    if shipment.get("status") != "READY_FOR_DISPATCH":
        results.fail("TC-1707", "Transport date makes the new shipment ready for dispatch", str(shipment))
        return
    shipment_id = shipment["id"]
    shipment_version = shipment["version"]
    results.pass_(
        "TC-1707",
        "Transport date makes the new shipment ready for dispatch",
        f"shipment#{shipment_id} version={shipment_version}",
    )

    readiness_status, readiness_body = request_json(
        clerk_api,
        "PUT",
        f"/api/shipments/{shipment_id}",
        {
            "expectedVersion": shipment_version,
            "closingAt": planned_start_at,
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-set-closing-at"},
    )
    if readiness_status != 200:
        results.fail("TC-1707B", "Clerk adds a closing time after the transport date", api_failure_detail(readiness_body))
        return
    shipment_version = readiness_body["version"]
    if readiness_body.get("status") != "READY_FOR_DISPATCH":
        results.fail("TC-1707B", "Shipment remains ready after adding the closing time", str(readiness_body))
        return
    results.pass_(
        "TC-1707B",
        "Shipment remains ready after adding the closing time",
        f"shipment#{shipment_id} version={shipment_version}",
    )

    forbidden_dispatch_status, forbidden_dispatch_body = request_json(
        clerk_api,
        "POST",
        f"/api/shipments/{shipment_id}/dispatch",
        {
            "fulfillmentId": 1,
            "expectedVersion": 1,
            "plannedStartAt": planned_start_at,
            "plannedEndAt": planned_end_at,
            "endTimeConfirmed": True,
            "carrierType": "OWN",
            "truckId": truck_id,
            "driverId": driver_record_id,
            "pricingRateKey": pricing_rate_key,
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-dispatch-forbidden"},
    )
    assert_ok(
        results,
        "TC-1708",
        "Clerk cannot dispatch directly",
        forbidden_dispatch_status == 403,
        api_failure_detail(forbidden_dispatch_body),
    )

    submit_status, submit_body = request_json(
        clerk_api,
        "POST",
        f"/api/shipments/{shipment_id}/submit-for-dispatch",
        {
            "expectedVersion": shipment_version,
            "priority": "URGENT",
            "operationalNote": f"urgent persisted chain {BOOKING_PREFIX}",
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-submit"},
    )
    if submit_status != 200:
        results.fail("TC-1709", "Clerk submits shipment for dispatch", api_failure_detail(submit_body))
        return
    handoff = submit_body["handoff"]
    shipment_version = submit_body["shipment"]["version"]
    if handoff.get("status") != "UNSEEN":
        results.fail("TC-1709", "Handoff created", str(submit_body))
        return
    results.pass_("TC-1709", "Clerk submits shipment for dispatch", f"handoff#{handoff['id']} version={handoff['version']}")

    manager_forbidden_review_status, manager_forbidden_review_body = request_json(
        manager_api,
        "POST",
        f"/api/shipments/{shipment_id}/pod-reviews/1/review",
        {"expectedVersion": 1, "resolution": "ACCEPT", "podRecovered": True},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-manager-review-forbidden"},
    )
    assert_ok(
        results,
        "TC-1710",
        "Manager cannot review POD submissions",
        manager_forbidden_review_status == 403,
        api_failure_detail(manager_forbidden_review_body),
    )

    resolve_status, resolve_body = request_json(
        manager_api,
        "POST",
        f"/api/shipments/{shipment_id}/dispatch-handoffs/{handoff['id']}/resolve",
        {"resolution": "ACCEPTED", "expectedVersion": handoff["version"]},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-handoff-resolve"},
    )
    if resolve_status != 200:
        results.fail("TC-1711", "Manager accepts the handoff", api_failure_detail(resolve_body))
        return
    fulfillments = resolve_body.get("fulfillments") or []
    fulfillment = fulfillments[0] if fulfillments else None
    if not fulfillment or not isinstance(fulfillment.get("id"), int):
        results.fail("TC-1711", "Fulfillment created on handoff acceptance", str(resolve_body))
        return
    fulfillment_id = fulfillment["id"]
    fulfillment_version = fulfillment["version"]
    results.pass_("TC-1711", "Manager accepts the handoff", f"fulfillment#{fulfillment_id} version={fulfillment_version}")

    issue_status, issue_body = request_json(
        manager_api,
        "POST",
        f"/api/shipments/{shipment_id}/dispatch",
        {
            "fulfillmentId": fulfillment_id,
            "expectedVersion": fulfillment_version,
            "plannedStartAt": planned_start_at,
            "plannedEndAt": planned_end_at,
            "endTimeConfirmed": True,
            "carrierType": "OWN",
            "truckId": truck_id,
            "driverId": driver_record_id,
            "pricingRateKey": pricing_rate_key,
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-issue"},
    )
    if issue_status not in (200, 201):
        results.fail("TC-1712", "Manager issues explicit dispatch order", api_failure_detail(issue_body))
        return
    trip = issue_body["trip"]
    if not isinstance(trip.get("id"), int) or trip.get("status") != "CREATED":
        results.fail("TC-1712", "Trip created from explicit dispatch order", str(issue_body))
        return
    trip_id = trip["id"]
    trip_version = trip["version"]
    results.pass_("TC-1712", "Manager issues explicit dispatch order", f"trip#{trip_id} version={trip_version}")

    trip_dispatch_status, trip_dispatch_body = request_json(
        manager_api,
        "POST",
        f"/api/trips/{trip_id}/dispatch",
        {"expectedVersion": trip_version},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-trip-dispatch"},
    )
    if trip_dispatch_status not in (200, 201):
        results.fail("TC-1712B", "Manager activates the trip for the driver", api_failure_detail(trip_dispatch_body))
        return
    if trip_dispatch_body.get("status") != "IN_TRANSIT":
        results.fail("TC-1712B", "Trip transitions to IN_TRANSIT", str(trip_dispatch_body))
        return
    trip_version = trip_dispatch_body.get("version", trip_version)
    results.pass_("TC-1712B", "Manager activates the trip for the driver", f"trip#{trip_id} status={trip_dispatch_body['status']} version={trip_version}")

    driver_trip_status, driver_trip_body = request_json(driver_api, "GET", "/api/driver/me/trips")
    driver_trips = first_items(driver_trip_body)
    if not driver_trips:
        results.fail("TC-1713", "Driver sees the dispatched trip", api_failure_detail(driver_trip_body))
        return
    matching_driver_trip = next((row for row in driver_trips if row.get("id") == trip_id), None)
    if not matching_driver_trip:
        results.fail("TC-1713", "Driver trip list includes the issued trip", str(driver_trips[:3]))
        return
    results.pass_("TC-1713", "Driver sees the dispatched trip", f"trip#{trip_id} assigned to driver#{driver_record_id}")

    users_payload = admin_api.get("/api/auth/users")
    user_rows = first_items(users_payload)
    forwarder_user = next(
        (row for row in user_rows if row.get("username") == "giaonhan"),
        None,
    )
    if not forwarder_user:
        results.fail("TC-1713B", "Ops forwarder account is available", str(users_payload))
        return
    current_shipment_ids = list(forwarder_user.get("shipmentIds") or [])
    if shipment_id not in current_shipment_ids:
        assignable_shipment_ids = []
        for assigned_shipment_id in current_shipment_ids:
            assigned_detail = admin_api.get(f"/api/shipments/{assigned_shipment_id}")
            assigned_payload = assigned_detail.get("data", assigned_detail)
            assigned_status = assigned_payload.get("shipment", {}).get("status")
            if assigned_status not in ("COMPLETED", "CANCELED"):
                assignable_shipment_ids.append(assigned_shipment_id)
        assign_status, assign_body = request_json(
            admin_api,
            "PATCH",
            f"/api/auth/users/{forwarder_user['id']}",
            {"shipmentIds": [*assignable_shipment_ids, shipment_id]},
            headers={
                "If-Unmodified-Since": forwarder_user["updatedAt"],
                "Idempotency-Key": f"{BOOKING_PREFIX}-forwarder-scope",
            },
        )
        if assign_status != 200:
            results.fail("TC-1713B", "Admin assigns the shipment to Ops", api_failure_detail(assign_body))
            return
        # Assignment changes invalidate the previous account token.
        forwarder_api = login_api("forwarder")
    results.pass_("TC-1713B", "Admin assigns the shipment to Ops", f"shipment#{shipment_id}")

    shipment_detail = admin_api.get(f"/api/shipments/{shipment_id}")
    shipment_payload = shipment_detail.get("data", shipment_detail)
    shipment_exchange_version = shipment_payload.get("shipment", {}).get("version")
    if not isinstance(shipment_exchange_version, int):
        results.fail("TC-1713C", "Ops reads the shipment version before order exchange", str(shipment_detail))
        return
    exchange_start_status, exchange_start_body = request_json(
        forwarder_api,
        "POST",
        f"/api/forwarder/me/shipments/{shipment_id}/order-exchange/start",
        {"expectedVersion": shipment_exchange_version},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-order-exchange-start"},
    )
    if exchange_start_status != 200 or not isinstance(exchange_start_body.get("version"), int):
        results.fail("TC-1713C", "Ops starts the parallel order exchange", api_failure_detail(exchange_start_body))
        return
    shipment_exchange_version = exchange_start_body["version"]
    results.pass_("TC-1713C", "Ops starts the parallel order exchange", f"shipment#{shipment_id} version={shipment_exchange_version}")

    exchange_complete_status, exchange_complete_body = request_json(
        forwarder_api,
        "POST",
        f"/api/forwarder/me/shipments/{shipment_id}/order-exchange/complete",
        {"expectedVersion": shipment_exchange_version},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-order-exchange-complete"},
    )
    if exchange_complete_status != 200 or not isinstance(exchange_complete_body.get("version"), int):
        results.fail("TC-1713D", "Ops completes the parallel order exchange", api_failure_detail(exchange_complete_body))
        return
    shipment_exchange_version = exchange_complete_body["version"]
    results.pass_("TC-1713D", "Ops completes the parallel order exchange", f"shipment#{shipment_id} version={shipment_exchange_version}")

    paper_order_status, paper_order_body = request_json(
        forwarder_api,
        "POST",
        f"/api/forwarder/me/trips/{trip_id}/paper-order-collection",
        {"expectedVersion": trip_version},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-paper-order-handover"},
    )
    if paper_order_status != 200 or not isinstance(paper_order_body.get("version"), int):
        results.fail("TC-1713E", "Ops hands the original paper order to the driver", api_failure_detail(paper_order_body))
        return
    trip_version = paper_order_body["version"]
    results.pass_("TC-1713E", "Ops hands the original paper order to the driver", f"trip#{trip_id} version={trip_version}")

    progress_events = [
        ("ORDER_RECEIVED", "Đã nhận lệnh gốc", 1),
        ("PICKED_UP", "Đã lấy vỏ / Lấy hàng", 2),
        ("LOADING_OR_RETURNING", "Đang đóng / Trả hàng", 3),
        ("DELIVERED", "Đã hạ bãi / Giao hàng xong", 4),
    ]
    for index, (event_type, label, offset) in enumerate(progress_events, start=1):
        progress_payload = {
            "eventType": event_type,
            "occurredAt": iso_at(offset),
            "note": f"progress-{event_type.lower()}-{BOOKING_PREFIX}",
            "expectedVersion": trip_version,
        }
        status, body = request_json(
            driver_api,
            "POST",
            f"/api/driver/me/fulfillments/{fulfillment_id}/progress",
            progress_payload,
            headers={"Idempotency-Key": f"{BOOKING_PREFIX}-progress-{index}"},
        )
        if status not in (200, 201):
            results.fail(f"TC-1714-{index}", f"Driver records {label}", api_failure_detail(body))
            return
        results.pass_(f"TC-1714-{index}", f"Driver records {label}", f"event={event_type}")
        refreshed_status, refreshed_body = request_json(
            driver_api,
            "GET",
            f"/api/driver/me/fulfillments/{fulfillment_id}",
        )
        if refreshed_status != 200 or not isinstance(refreshed_body, dict) or not isinstance(refreshed_body.get("tripVersion"), int):
            results.fail(f"TC-1714-{index}V", f"Driver fulfillment detail refreshes after {label}", str(refreshed_body))
            return
        trip_version = refreshed_body["tripVersion"]
        if event_type == "ORDER_RECEIVED":
            if refreshed_body.get("trip", {}).get("status") != "IN_TRANSIT":
                results.fail("TC-1714-1B", "Driver acknowledgement activates the trip", str(refreshed_body))
                return
            results.pass_("TC-1714-1B", "Driver acknowledgement activates the trip", f"trip#{trip_id} version={trip_version}")

    pod_create_status, pod_create_body = request_json(
        driver_api,
        "POST",
        f"/api/driver/me/fulfillments/{fulfillment_id}/pod",
        {"expectedVersion": trip_version},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-pod-create"},
    )
    if pod_create_status not in (200, 201):
        results.fail("TC-1715", "Driver opens e-POD submission", api_failure_detail(pod_create_body))
        return
    submission = pod_create_body
    submission_id = submission["id"]
    submission_version = submission["version"]
    results.pass_("TC-1715", "Driver opens e-POD submission", f"submission#{submission_id} version={submission_version}")

    for index, (file_type, filename) in enumerate(
        [
            ("YARD_OR_DROP_RECEIPT", "phieu-ha-bai.pdf"),
            ("SIGNED_DELIVERY_NOTE", "bien-ban-giao-nhan.pdf"),
        ],
        start=1,
    ):
        upload_status, upload_body = request_multipart(
            driver_api,
            f"/api/driver/me/fulfillments/{fulfillment_id}/pod/{submission_id}/files",
            fields={
                "expectedVersion": str(submission_version),
                "fileType": file_type,
            },
            file_field="file",
            filename=filename,
            file_bytes=PDF_BYTES,
            content_type="application/pdf",
            idempotency_key=f"{BOOKING_PREFIX}-pod-file-{index}",
        )
        if upload_status not in (200, 201):
            results.fail(f"TC-1716-{index}", f"Driver uploads {file_type}", api_failure_detail(upload_body))
            return
        submission_version = upload_body.get("version", submission_version)
        results.pass_(f"TC-1716-{index}", f"Driver uploads {file_type}", f"submission version={submission_version}")

    submit_pod_status, submit_pod_body = request_json(
        driver_api,
        "POST",
        f"/api/driver/me/fulfillments/{fulfillment_id}/pod/{submission_id}/submit",
        {"expectedVersion": submission_version},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-pod-submit"},
    )
    if submit_pod_status not in (200, 201):
        results.fail("TC-1717", "Driver submits e-POD", api_failure_detail(submit_pod_body))
        return
    submission_version = submit_pod_body.get("version", submission_version)
    results.pass_("TC-1717", "Driver submits e-POD", f"status={submit_pod_body.get('status')}")

    complete_status, complete_body = request_json(
        driver_api,
        "POST",
        f"/api/driver/me/fulfillments/{fulfillment_id}/complete",
        {"expectedVersion": trip_version},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-complete"},
    )
    assert_ok(
        results,
        "TC-1718",
        "Driver completes the operational handoff after e-POD submission",
        complete_status in (200, 201)
        and complete_body.get("status") == "IN_TRANSIT"
        and complete_body.get("evidenceStatus", {}).get("latestSubmissionStatus") == "SUBMITTED",
        str(complete_body),
    )
    if isinstance(complete_body, dict) and isinstance(complete_body.get("version"), int):
        trip_version = complete_body["version"]

    completion_status, completion_body = request_json(
        forwarder_api,
        "PUT",
        f"/api/forwarder/me/trips/{trip_id}/expense-completion",
        {"tripContainerId": None, "completed": True},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-expense-completion"},
    )
    if completion_status != 200 or completion_body.get("status") != "COMPLETED":
        results.fail("TC-1718C", "Ops completes the general expense scope", api_failure_detail(completion_body))
        return
    results.pass_("TC-1718C", "Ops completes the general expense scope", f"trip#{trip_id}")

    forwarder_trip_response = forwarder_api.get(f"/api/forwarder/me/trips/{trip_id}")
    forwarder_trip_detail = forwarder_trip_response.get("data", forwarder_trip_response)
    completion_scopes = forwarder_trip_detail.get("completionScopes") or []
    pending_container_scope_ids = [
        scope.get("tripContainerId")
        for scope in completion_scopes
        if scope.get("tripContainerId") is not None and scope.get("status") != "COMPLETED"
    ]
    for index, trip_container_scope_id in enumerate(pending_container_scope_ids, start=1):
        scope_completion_status, scope_completion_body = request_json(
            forwarder_api,
            "PUT",
            f"/api/forwarder/me/trips/{trip_id}/expense-completion",
            {"tripContainerId": trip_container_scope_id, "completed": True},
            headers={"Idempotency-Key": f"{BOOKING_PREFIX}-expense-completion-container-{index}"},
        )
        if scope_completion_status != 200 or scope_completion_body.get("status") != "COMPLETED":
            results.fail(
                f"TC-1718D-{index}",
                "Ops completes every remaining container expense scope",
                api_failure_detail(scope_completion_body),
            )
            return
        results.pass_(
            f"TC-1718D-{index}",
            "Ops completes every remaining container expense scope",
            f"tripContainerId={trip_container_scope_id}",
        )

    forwarder_trip_response = forwarder_api.get(f"/api/forwarder/me/trips/{trip_id}")
    forwarder_trip_detail = forwarder_trip_response.get("data", forwarder_trip_response)
    remaining_completion_scopes = [
        scope for scope in (forwarder_trip_detail.get("completionScopes") or [])
        if scope.get("status") != "COMPLETED"
    ]
    if remaining_completion_scopes:
        results.fail(
            "TC-1718E",
            "Ops completion scopes are fully closed before accounting review",
            str(remaining_completion_scopes),
        )
        return
    shipment_detail = clerk_api.get(f"/api/shipments/{shipment_id}")
    shipment_payload = shipment_detail.get("data", shipment_detail)
    if shipment_payload.get("shipment", {}).get("status") != "PENDING_EXPENSE_APPROVAL":
        results.fail("TC-1718E", "Shipment moves to pending expense approval after full ops handoff", str(shipment_payload))
        return
    results.pass_("TC-1718E", "Shipment moves to pending expense approval after full ops handoff", f"shipment#{shipment_id}")

    driver_forbidden_export_status, driver_forbidden_export_body = request_json(
        driver_api,
        "POST",
        "/api/finance/billing-documents/generate",
        {
            "type": "DEBIT_NOTE",
            "entityType": "CUSTOMER",
            "entityId": customer["id"],
            "rangeFrom": month_from,
            "rangeTo": month_to,
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-driver-export-forbidden"},
    )
    assert_ok(
        results,
        "TC-1719",
        "Driver cannot generate debit notes",
        driver_forbidden_export_status == 403,
        api_failure_detail(driver_forbidden_export_body),
    )

    review_status, review_body = request_json(
        clerk_api,
        "POST",
        f"/api/shipments/{shipment_id}/pod-reviews/{submission_id}/review",
        {"expectedVersion": submission_version, "resolution": "ACCEPT", "podRecovered": True},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-review"},
    )
    if review_status not in (200, 201):
        results.fail("TC-1720", "Clerk accepts the e-POD", api_failure_detail(review_body))
        return
    if review_body.get("tripStatus") != "IN_TRANSIT" or review_body.get("shipment", {}).get("status") != "PENDING_EXPENSE_APPROVAL":
        results.fail("TC-1720", "Pending expense approval after e-POD acceptance", str(review_body))
        return
    results.pass_("TC-1720", "Clerk accepts the e-POD", f"trip={review_body.get('tripStatus')} shipment={review_body.get('shipment', {}).get('status')}")

    manager_replay_status, manager_replay_body = request_json(
        manager_api,
        "POST",
        f"/api/shipments/{shipment_id}/pod-reviews/{submission_id}/review",
        {"expectedVersion": submission_version, "resolution": "ACCEPT", "podRecovered": True},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-manager-replay"},
    )
    assert_ok(
        results,
        "TC-1721",
        "Manager remains blocked after POD approval",
        manager_replay_status == 403,
        api_failure_detail(manager_replay_body),
    )

    shipment_detail = clerk_api.get(f"/api/shipments/{shipment_id}")
    shipment_payload = shipment_detail.get("data", shipment_detail)
    if shipment_payload.get("shipment", {}).get("status") != "PENDING_EXPENSE_APPROVAL":
        results.fail("TC-1722", "Shipment is pending expense approval in persisted detail", str(shipment_payload))
        return
    if not shipment_payload.get("podReviews"):
        results.fail("TC-1722", "Shipment detail exposes POD review", str(shipment_payload))
        return
    results.pass_("TC-1722", "Shipment is pending expense approval in persisted detail", f"shipment#{shipment_id}")
    current_trip_version = shipment_payload.get("podReviews", [{}])[0].get("tripVersion")
    if isinstance(current_trip_version, int):
        trip_version = current_trip_version

    for index, photo_type in enumerate(("CONTAINER", "SEAL"), start=1):
        photo_status, photo_body = request_multipart(
            accountant_api,
            "/api/upload",
            fields={"trip_id": str(trip_id), "type": photo_type},
            file_field="file",
            filename=f"{photo_type.lower()}-{BOOKING_PREFIX}.png",
            file_bytes=sample_png_bytes(),
            content_type="image/png",
            idempotency_key=f"{BOOKING_PREFIX}-photo-{index}",
        )
        if photo_status not in (200, 201):
            results.fail(f"TC-1722-{index}", f"Office uploads {photo_type.lower()} evidence photo", api_failure_detail(photo_body))
            return
        results.pass_(f"TC-1722-{index}", f"Office uploads {photo_type.lower()} evidence photo", str(photo_body))

    shipment_version = shipment_payload.get("shipment", {}).get("version")
    close_request_status, close_request_body = request_json(
        accountant_api,
        "POST",
        f"/api/shipments/{shipment_id}/complete",
        {
            "expectedVersion": shipment_version,
            "vatRate": 0.08,
            "trips": [{"tripId": trip_id, "expectedVersion": trip_version}],
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-close-request"},
    )
    if close_request_status != 200:
        results.fail("TC-1723", "Accountant closes the shipment directly", api_failure_detail(close_request_body))
        return
    if close_request_body.get("shipment", {}).get("status") != "COMPLETED":
        results.fail("TC-1723", "Direct close returns completed shipment", str(close_request_body))
        return
    if close_request_body.get("completedTripIds") != [trip_id]:
        results.fail("TC-1723", "Direct close reports the completed trip ids", str(close_request_body))
        return
    results.pass_("TC-1723", "Accountant closes the shipment directly", f"shipment#{shipment_id} trip#{trip_id}")

    replay_status, replay_body = request_json(
        accountant_api,
        "POST",
        f"/api/shipments/{shipment_id}/complete",
        {
            "expectedVersion": shipment_version,
            "vatRate": 0.08,
            "trips": [{"tripId": trip_id, "expectedVersion": trip_version}],
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-close-request"},
    )
    if replay_status != 200:
        results.fail("TC-1724", "Replay returns the stored direct close result", api_failure_detail(replay_body))
        return
    if replay_body.get("replayed") is not True:
        results.fail("TC-1724", "Replay is marked explicitly", str(replay_body))
        return
    results.pass_("TC-1724", "Replay returns the stored direct close result", f"shipment#{shipment_id}")

    generate_status, generate_body = request_json(
        accountant_api,
        "POST",
        "/api/finance/billing-documents/generate",
        {
            "type": "DEBIT_NOTE",
            "entityType": "CUSTOMER",
            "entityId": customer["id"],
            "rangeFrom": month_from,
            "rangeTo": month_to,
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-generate"},
    )
    if generate_status != 200:
        results.fail("TC-1723", "Accountant generates the debit note draft", api_failure_detail(generate_body))
        return
    draft = generate_body
    if not draft.get("lines"):
        results.fail("TC-1723", "Debit note draft contains lines", str(draft))
        return
    selected_lines = [
        line for line in draft["lines"]
        if line.get("sourceType") == "TRIP" and line.get("sourceId") == trip_id
    ]
    if len(selected_lines) != 1:
        generated_trip_ids = [
            line.get("sourceId")
            for line in draft["lines"]
            if line.get("sourceType") == "TRIP"
        ]
        results.fail(
            "TC-1726",
            "Debit note draft includes the eligible Long Minh trip",
            f"targetTripId={trip_id}, generatedTripIds={generated_trip_ids}, eligibility={draft.get('eligibilitySummary')}",
        )
        return
    results.pass_("TC-1726", "Accountant generates the debit note draft", f"trip#{trip_id} is eligible")

    source_refs = []
    for line in selected_lines:
        if line.get("sourceType") == "TRIP":
            source_refs.append({
                "sourceType": "TRIP",
                "sourceId": line["sourceId"],
                "financialPostingId": line["financialPostingId"],
                "financialPostingVersion": line["financialPostingVersion"],
                "postingChecksum": line["postingChecksum"],
            })
        elif line.get("sourceType") == "EXPENSE":
            source_refs.append({
                "sourceType": "EXPENSE",
                "sourceId": line["sourceId"],
                "sourceVersion": line["renderData"]["sourceVersion"],
            })

    save_payload = {
        "type": draft["type"],
        "entityType": draft["entityType"],
        "entityId": draft["entityId"],
        "entityName": draft.get("entityName"),
        "rangeFrom": draft["rangeFrom"],
        "rangeTo": draft["rangeTo"],
        "note": draft.get("note"),
        "sourceRefs": source_refs,
        "debitNoteTemplateId": template["id"],
    }
    save_status, save_body = request_json(
        accountant_api,
        "POST",
        "/api/finance/billing-documents",
        save_payload,
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-save"},
    )
    if save_status not in (200, 201):
        results.fail("TC-1727", "Accountant saves the Long Minh debit note", api_failure_detail(save_body))
        return
    document_id = save_body["id"]
    results.pass_("TC-1727", "Accountant saves the Long Minh debit note", f"document#{document_id} template#{template['id']}")

    issue_status, issue_body = request_json(
        accountant_api,
        "POST",
        f"/api/finance/billing-documents/{document_id}/issue",
        {
            "expectedVersion": save_body["version"],
            "reason": "Phát hành để xác nhận khóa lô CUS.",
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-debit-issue"},
    )
    if issue_status != 201 or issue_body.get("status") != "PENDING_CHECK":
        results.fail("TC-1727A", "Accountant requests governed Debit Note issue", api_failure_detail(issue_body))
        return

    checked_status, checked_body = request_json(
        manager_api,
        "POST",
        f"/api/governance-actions/{issue_body['id']}/check",
        {"expectedVersion": issue_body["version"]},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-debit-check"},
    )
    if checked_status != 200 or checked_body.get("status") != "PENDING_APPROVAL":
        results.fail("TC-1727B", "Manager checks the Debit Note issue request", api_failure_detail(checked_body))
        return

    approved_status, approved_body = request_json(
        admin_api,
        "POST",
        f"/api/governance-actions/{issue_body['id']}/approve",
        {"expectedVersion": checked_body["version"]},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-debit-approve"},
    )
    if approved_status != 200 or approved_body.get("status") != "APPROVED":
        results.fail("TC-1727C", "Admin approves the Debit Note issue", api_failure_detail(approved_body))
        return
    results.pass_("TC-1727A", "Accountant requests governed Debit Note issue", f"action#{issue_body['id']}")
    results.pass_("TC-1727B", "Manager checks the Debit Note issue request", f"action#{issue_body['id']}")
    results.pass_("TC-1727C", "Admin approves the Debit Note issue", f"document#{document_id}")

    export_status, export_headers, export_blob = request_binary(
        accountant_api,
        f"/api/finance/billing-documents/{document_id}/export?format=xlsx",
    )
    if export_status != 200:
        results.fail("TC-1728", "Accountant exports the saved Long Minh debit note", f"status={export_status}")
        return
    ok, detail = workbook_has_expected_template(export_blob, "BẢNG KÊ XÁC NHẬN VẬN CHUYỂN HOÀN THÀNH / MẪU DEBIT LONG MINH", bl_number)
    if not ok:
        results.fail("TC-1728", "Exported workbook uses Long Minh template", detail)
        return
    results.pass_("TC-1728", "Accountant exports the saved Long Minh debit note", detail)

    workspace_status, workspace_body = request_json(
        accountant_api,
        "GET",
        f"/api/shipments/cus-workspace/{shipment_id}",
    )
    workspace_summary = workspace_body.get("summary", {}) if isinstance(workspace_body, dict) else {}
    if workspace_status != 200 or workspace_summary.get("debitNote", {}).get("billingDocumentId") != document_id:
        results.fail("TC-1730", "Accountant reads the qualifying Debit Note in CUS workspace", api_failure_detail(workspace_body))
        return

    confirm_payload = {
        "expectedVersion": workspace_summary["version"],
        "billingDocumentId": document_id,
        "reason": "Kế toán xác nhận số liệu để CUS khóa lô.",
    }
    confirm_status, confirm_body = request_json(
        accountant_api,
        "POST",
        f"/api/shipments/cus-workspace/{shipment_id}/finance-confirmations",
        confirm_payload,
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-cus-finance-confirm"},
    )
    confirm_replay_status, confirm_replay_body = request_json(
        accountant_api,
        "POST",
        f"/api/shipments/cus-workspace/{shipment_id}/finance-confirmations",
        confirm_payload,
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-cus-finance-confirm"},
    )
    confirmation = confirm_body.get("confirmation", {}) if isinstance(confirm_body, dict) else {}
    replay_confirmation = confirm_replay_body.get("confirmation", {}) if isinstance(confirm_replay_body, dict) else {}
    if (
        confirm_status != 201
        or confirm_replay_status not in (200, 201)
        or confirmation.get("status") != "CONFIRMED"
        or replay_confirmation.get("confirmationId") != confirmation.get("confirmationId")
    ):
        results.fail("TC-1730", "Accountant confirms the exact finance snapshot with replay", f"first={confirm_body}, replay={confirm_replay_body}")
        return
    results.pass_("TC-1730", "Accountant confirms the exact finance snapshot with replay", f"confirmation#{confirmation['confirmationId']}")

    cus_detail_status, cus_detail_body = request_json(
        clerk_api,
        "GET",
        f"/api/shipments/cus-workspace/{shipment_id}",
    )
    cus_summary = cus_detail_body.get("summary", {}) if isinstance(cus_detail_body, dict) else {}
    lock_payload = {
        "expectedVersion": cus_summary.get("version"),
        "confirmationId": confirmation.get("confirmationId"),
        "confirmationChecksum": confirmation.get("checksum"),
        "reason": "CUS đã kiểm tra và khóa lô.",
        "acknowledged": True,
    }
    lock_status, lock_body = request_json(
        clerk_api,
        "POST",
        f"/api/shipments/cus-workspace/{shipment_id}/lock",
        lock_payload,
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-cus-lock"},
    )
    lock_replay_status, lock_replay_body = request_json(
        clerk_api,
        "POST",
        f"/api/shipments/cus-workspace/{shipment_id}/lock",
        lock_payload,
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-cus-lock"},
    )
    lock = lock_body.get("lock", {}) if isinstance(lock_body, dict) else {}
    replay_lock = lock_replay_body.get("lock", {}) if isinstance(lock_replay_body, dict) else {}
    if (
        lock_status != 201
        or lock_replay_status not in (200, 201)
        or not isinstance(lock.get("id"), int)
        or replay_lock.get("id") != lock.get("id")
    ):
        results.fail("TC-1731", "CUS locks once and retry replays the same active lock", f"first={lock_body}, replay={lock_replay_body}")
        return
    results.pass_("TC-1731", "CUS locks once and retry replays the same active lock", f"lock#{lock['id']}")

    locked_detail_status, locked_detail_body = request_json(
        clerk_api,
        "GET",
        f"/api/shipments/cus-workspace/{shipment_id}",
    )
    locked_summary = locked_detail_body.get("summary", {}) if isinstance(locked_detail_body, dict) else {}
    denied_update_status, denied_update_body = request_json(
        clerk_api,
        "PUT",
        f"/api/shipments/{shipment_id}",
        {
            "expectedVersion": locked_summary.get("version"),
            "operationalNotes": "Không được ghi khi lô đã khóa",
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-locked-write-denied"},
    )
    if locked_detail_status != 200 or locked_summary.get("bucket") != "LOCKED" or denied_update_status != 409:
        results.fail("TC-1732", "Active lock is persisted and denies material shipment writes", f"detail={locked_detail_body}, update={denied_update_body}")
        return

    instructions_before = manager_api.get(f"/api/trips/{trip_id}/instructions")
    expenses_before = accountant_api.get(f"/api/trips/{trip_id}/expenses")
    shipment_before = clerk_api.get(f"/api/shipments/{shipment_id}")
    shipment_before_payload = shipment_before.get("data", shipment_before)
    guard_snapshot_before = {
        "shipmentVersion": locked_summary.get("version"),
        "containerCount": len(locked_detail_body.get("containers", [])),
        "documentCount": len(shipment_before_payload.get("documents", [])),
        "instructions": instructions_before,
        "expenseCount": len(expenses_before.get("items", [])),
    }

    denied_container_status, _ = request_json(
        clerk_api,
        "PUT",
        f"/api/shipments/{shipment_id}/containers",
        {
            "expectedVersion": locked_summary.get("version"),
            "containers": [{"containerTypeId": 1, "containerNumber": "MSCU6639870"}],
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-locked-container-denied"},
    )
    denied_trip_status, _ = request_json(
        manager_api,
        "PUT",
        f"/api/trips/{trip_id}/instructions",
        {"notes": "Không được ghi khi lô đã khóa"},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-locked-trip-denied"},
    )
    denied_expense_status, _ = request_json(
        admin_api,
        "POST",
        f"/api/trips/{trip_id}/expenses",
        {
            "expenseType": "OTHER",
            "buyAmount": 1,
            "sellAmount": 0,
            "settlementMethod": "COMPANY_DIRECT",
            "invoiceNumber": f"LOCK-{SEARCH_SUFFIX}",
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-locked-expense-denied"},
    )
    denied_document_status, _ = request_json(
        clerk_api,
        "POST",
        f"/api/shipments/{shipment_id}/documents",
        {"type": "OTHER", "storageKey": f"e2e/locked-{BOOKING_PREFIX}.pdf"},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-locked-document-denied"},
    )
    denied_upload_status, _ = request_multipart(
        accountant_api,
        "/api/upload",
        fields={"trip_id": str(trip_id), "type": "OTHER"},
        file_field="file",
        filename=f"locked-{BOOKING_PREFIX}.png",
        file_bytes=sample_png_bytes(),
        content_type="image/png",
        idempotency_key=f"{BOOKING_PREFIX}-locked-upload-denied",
    )

    locked_detail_after_status, locked_detail_after = request_json(
        clerk_api,
        "GET",
        f"/api/shipments/cus-workspace/{shipment_id}",
    )
    shipment_after = clerk_api.get(f"/api/shipments/{shipment_id}")
    shipment_after_payload = shipment_after.get("data", shipment_after)
    instructions_after = manager_api.get(f"/api/trips/{trip_id}/instructions")
    expenses_after = accountant_api.get(f"/api/trips/{trip_id}/expenses")
    guard_snapshot_after = {
        "shipmentVersion": locked_detail_after.get("summary", {}).get("version"),
        "containerCount": len(locked_detail_after.get("containers", [])),
        "documentCount": len(shipment_after_payload.get("documents", [])),
        "instructions": instructions_after,
        "expenseCount": len(expenses_after.get("items", [])),
    }
    denied_statuses = {
        "shipment": denied_update_status,
        "container": denied_container_status,
        "trip": denied_trip_status,
        "expense": denied_expense_status,
        "document": denied_document_status,
        "upload": denied_upload_status,
    }
    if (
        locked_detail_after_status != 200
        or any(status != 409 for status in denied_statuses.values())
        or guard_snapshot_after != guard_snapshot_before
    ):
        results.fail(
            "TC-1732",
            "Active lock denies shipment, container, trip, expense, document and upload writes",
            f"statuses={denied_statuses}, before={guard_snapshot_before}, after={guard_snapshot_after}",
        )
        return
    results.pass_(
        "TC-1732",
        "Active lock denies shipment, container, trip, expense, document and upload writes",
        f"shipment#{shipment_id}, statuses={denied_statuses}",
    )

    mobile_page = ctx.new_page({"width": 390, "height": 844})
    ctx.login_as("clerk", mobile_page)
    search_suffix = SEARCH_SUFFIX
    mobile_page.goto(f"{BASE_URL}/shipments?searchSuffix={search_suffix}")
    mobile_page.wait_for_load_state("networkidle")
    mobile_card = mobile_page.locator("article.cus-mobile-card").filter(has_text=bl_number)
    mobile_card.get_by_role("button", name="Xem chi tiết").click()
    mobile_page.locator('[role="dialog"]').first.wait_for(timeout=10_000)
    reopen_trigger = mobile_page.get_by_role("button", name="Đề nghị điều chỉnh")
    reopen_trigger.click()
    stacked_dialogs = mobile_page.locator('[role="dialog"]')
    stacked_dialogs.nth(1).wait_for(timeout=10_000)
    mobile_page.keyboard.press("Escape")
    mobile_page.wait_for_function(
        "document.querySelectorAll('[role=\"dialog\"]').length === 1",
        timeout=2_000,
    )
    focus_returned_to_action = mobile_page.evaluate(
        "document.activeElement?.textContent?.includes('Đề nghị điều chỉnh') === true"
    )
    if stacked_dialogs.count() != 1 or not focus_returned_to_action:
        results.fail(
            "TC-1732A",
            "Escape closes only the top mobile modal and restores its action focus",
            f"dialogs={stacked_dialogs.count()}, focusReturned={focus_returned_to_action}",
        )
        mobile_page.close()
        return
    ctx.screenshot(mobile_page, f"TC-1732A_stacked_overlay_{shipment_id}")
    results.pass_(
        "TC-1732A",
        "Escape closes only the top mobile modal and restores its action focus",
        f"shipment#{shipment_id}",
    )
    mobile_page.keyboard.press("Escape")
    mobile_page.close()

    first_request_status, first_request_body = request_json(
        clerk_api,
        "POST",
        f"/api/shipments/cus-workspace/{shipment_id}/reopen-requests",
        {
            "expectedShipmentVersion": locked_summary["version"],
            "activeLockId": lock["id"],
            "reason": "Cần điều chỉnh chứng từ sau khi đối chiếu.",
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-reopen-request-reject"},
    )
    first_action = first_request_body.get("action", {}) if isinstance(first_request_body, dict) else {}
    reject_status, reject_body = request_json(
        admin_api,
        "POST",
        f"/api/shipments/cus-workspace/{shipment_id}/reopen-requests/{first_action.get('id')}/decision",
        {
            "expectedVersion": first_action.get("version"),
            "decision": "REJECT",
            "reason": "Chưa đủ bằng chứng điều chỉnh.",
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-reopen-reject"},
    )
    if first_request_status != 201 or reject_status != 200 or reject_body.get("status") != "REJECTED":
        results.fail("TC-1733", "CUS request can be rejected by Admin without releasing lock", f"request={first_request_body}, decision={reject_body}")
        return

    after_reject_status, after_reject_body = request_json(
        clerk_api,
        "GET",
        f"/api/shipments/cus-workspace/{shipment_id}",
    )
    after_reject_summary = after_reject_body.get("summary", {}) if isinstance(after_reject_body, dict) else {}
    second_request_status, second_request_body = request_json(
        clerk_api,
        "POST",
        f"/api/shipments/cus-workspace/{shipment_id}/reopen-requests",
        {
            "expectedShipmentVersion": after_reject_summary.get("version"),
            "activeLockId": lock["id"],
            "reason": "Đã bổ sung bằng chứng, đề nghị mở để đối soát.",
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-reopen-request-approve"},
    )
    second_action = second_request_body.get("action", {}) if isinstance(second_request_body, dict) else {}
    approve_reopen_status, approve_reopen_body = request_json(
        admin_api,
        "POST",
        f"/api/shipments/cus-workspace/{shipment_id}/reopen-requests/{second_action.get('id')}/decision",
        {
            "expectedVersion": second_action.get("version"),
            "decision": "APPROVE",
            "reason": "Đủ bằng chứng, mở lô và yêu cầu đối soát lại.",
        },
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-reopen-approve"},
    )
    if second_request_status != 201 or approve_reopen_status != 200 or approve_reopen_body.get("status") != "APPROVED":
        results.fail("TC-1734", "Admin approves a new request and releases the active lock", f"request={second_request_body}, decision={approve_reopen_body}")
        return

    reopened_status, reopened_body = request_json(
        clerk_api,
        "GET",
        f"/api/shipments/cus-workspace/{shipment_id}",
    )
    reopened_summary = reopened_body.get("summary", {}) if isinstance(reopened_body, dict) else {}
    if (
        reopened_status != 200
        or reopened_summary.get("activeLock") is not None
        or reopened_summary.get("accountingConfirmation", {}).get("status") != "STALE"
        or reopened_summary.get("debitNote", {}).get("available") is not False
    ):
        results.fail("TC-1734", "Reopen preserves history and invalidates finance/billing authority", str(reopened_body))
        return
    results.pass_("TC-1733", "CUS request can be rejected by Admin without releasing lock", f"action#{first_action['id']}")
    results.pass_("TC-1734", "Admin reopen invalidates confirmation and billing authority", f"action#{second_action['id']}")

    page = ctx.new_page({"width": 1440, "height": 1000})
    def proxy_api(route):
        response = route.fetch(
            url=route.request.url.replace(BASE_URL, API_URL, 1),
        )
        route.fulfill(response=response)

    page.route(
        f"{BASE_URL}/api/**",
        proxy_api,
    )
    ctx.login_as("clerk", page)
    page.goto(f"{BASE_URL}/shipments/{shipment_id}")
    page.wait_for_load_state("networkidle")
    body_text = page.locator("body").inner_text()
    assert_ok(
        results,
        "TC-1729",
        "Shipment detail page shows the closed chain",
        booking_ref in body_text and customer["name"] in body_text,
        f"booking={booking_ref} customer={customer['name']}",
    )
    ctx.screenshot(page, f"TC-1729_shipment_{shipment_id}_closed")
    page.close()


if __name__ == "__main__":
    exit_code = 1
    try:
        exit_code = run_suite(TITLE, test_dispatch_persisted_chain)
    finally:
        cleanup_fleet_fixture()
    sys.exit(exit_code)
