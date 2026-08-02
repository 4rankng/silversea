#!/usr/bin/env python3
"""Persisted cross-role dispatch chain: intake → dispatch → driver → review → debit export."""

from __future__ import annotations

from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import *  # noqa: E402,F403


TITLE = "17-dispatch-persisted-chain"
BOOKING_PREFIX = f"E2E-LM-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
REPO_ROOT = Path(__file__).resolve().parent.parent
PDF_BYTES = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


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


def bootstrap_master_data_fixture(truck_id: int) -> None:
    trailer_plate = f"LM-TR-{BOOKING_PREFIX[-6:]}"
    script = r"""
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from './src/db';
import * as s from './src/db/schema';
import { seedCustomers } from './src/seed/seed-customers';

const truckId = __TRUCK_ID__;
const trailerPlate = __TRAILER_PLATE__;
const now = new Date();

async function main() {
await seedCustomers();
const [customerExisting] = await db.select({ id: s.customers.id })
  .from(s.customers)
  .where(and(
    isNull(s.customers.deletedAt),
    eq(s.customers.taxCode, '2300540419'),
  ))
  .limit(1);
const customerValues = {
  name: 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH',
  taxCode: '2300540419',
  contactPerson: 'Ms.Vân',
  phone: '',
  contactInfo: 'longminh.logistic@gmail.com; account1@longminhbn.com.vn',
  status: 'ACTIVE',
  debitNoteMode: 'MONTHLY',
  creditLimit: '1000000000',
  updatedAt: now,
};
let customerId;
if (customerExisting) {
  customerId = customerExisting.id;
  await db.update(s.customers)
    .set(customerValues)
    .where(eq(s.customers.id, customerExisting.id));
} else {
  const [createdCustomer] = await db.insert(s.customers).values(customerValues).returning({ id: s.customers.id });
  customerId = createdCustomer.id;
}

const [clerkUser] = await db.select({ id: s.users.id })
  .from(s.users)
  .where(and(eq(s.users.username, 'cus'), eq(s.users.role, 'CLERK')))
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
if (routeExisting) {
  await db.update(s.routes)
    .set(routeValues)
    .where(eq(s.routes.id, routeExisting.id));
} else {
  await db.insert(s.routes).values(routeValues);
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

const [truckExisting] = await db.select({ id: s.trucks.id })
  .from(s.trucks)
  .where(and(isNull(s.trucks.deletedAt), eq(s.trucks.id, truckId)))
  .limit(1);
if (!truckExisting) throw new Error(`Truck ${truckId} missing`);
await db.update(s.trucks)
  .set({
    currentTrailerId: trailerId,
    trailerPlateNumber: trailerPlate,
    trailerType: '40FT',
    status: 'ACTIVE',
    updatedAt: now,
  })
  .where(eq(s.trucks.id, truckId));

console.log(JSON.stringify({
  customerId,
  truckId,
  trailerId,
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
        .replace("__TRUCK_ID__", str(truck_id))
        .replace("__TRAILER_PLATE__", json.dumps(trailer_plate))
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
    print(f"🧱 Bootstrapped Long Minh master data fixture for truck #{truck_id}")


def ensure_master_data_loaded(admin_api: ApiClient, truck_id: int) -> None:
    bootstrap_master_data_fixture(truck_id)
    customers = first_items(get_with_query(admin_api, "/api/customers", {"search": "Long Minh", "page": 1, "pageSize": 25}))
    if not customers:
        raise RuntimeError("Long Minh customer missing after bootstrap")


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
    truck_id = driver_profile["assignedTruckId"]
    ensure_master_data_loaded(admin_api, truck_id)
    # Scope bootstrap invalidates the clerk's prior token by design.
    clerk_api = login_api("clerk")

    customers = require_json_array(
        results,
        "TC-1701",
        "Seed customers include Long Minh",
        get_with_query(admin_api, "/api/customers", {"search": "Long Minh", "page": 1, "pageSize": 25}),
    )
    if not customers:
        return
    customer = next((item for item in customers if item.get("taxCode") == "2300540419"), None) or pick_named(customers, "name", "Long Minh")
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

    booking_ref = f"{BOOKING_PREFIX}-BOOKING"
    bl_number = f"BL-{BOOKING_PREFIX}"
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
        results.fail("TC-1707", "Clerk creates a draft shipment", api_failure_detail(create_body))
        return
    shipment = create_body
    if shipment.get("status") != "DRAFT":
        results.fail("TC-1707", "Draft shipment status", str(shipment))
        return
    shipment_id = shipment["id"]
    shipment_version = shipment["version"]
    results.pass_("TC-1707", "Clerk creates a draft shipment", f"shipment#{shipment_id} version={shipment_version}")

    forbidden_dispatch_status, forbidden_dispatch_body = request_json(
        clerk_api,
        "POST",
        f"/api/shipments/{shipment_id}/dispatch",
        {
            "fulfillmentId": 1,
            "expectedVersion": 1,
            "plannedStartAt": iso_at(1),
            "plannedEndAt": iso_at(3),
            "endTimeConfirmed": True,
            "carrierType": "OWN",
            "truckId": truck_id,
            "driverId": driver_record_id,
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
        {"expectedVersion": 1, "resolution": "ACCEPT"},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-manager-review-forbidden"},
    )
    assert_ok(
        results,
        "TC-1710",
        "Manager cannot review a non-existent POD",
        manager_forbidden_review_status == 404,
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
            "plannedStartAt": iso_at(1),
            "plannedEndAt": iso_at(3),
            "endTimeConfirmed": True,
            "carrierType": "OWN",
            "truckId": truck_id,
            "driverId": driver_record_id,
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

    progress_events = [
        ("PICKED_UP", "Đã lấy vỏ / Lấy hàng", 1),
        ("LOADING_OR_RETURNING", "Đang đóng / Trả hàng", 2),
        ("DELIVERED", "Đã hạ bãi / Giao hàng xong", 3),
    ]
    for index, (event_type, label, offset) in enumerate(progress_events, start=1):
        status, body = request_json(
            driver_api,
            "POST",
            f"/api/driver/me/fulfillments/{fulfillment_id}/progress",
            {
                "eventType": event_type,
                "occurredAt": iso_at(offset),
                "note": f"progress-{event_type.lower()}-{BOOKING_PREFIX}",
                "expectedVersion": trip_version,
            },
            headers={"Idempotency-Key": f"{BOOKING_PREFIX}-progress-{index}"},
        )
        if status not in (200, 201):
            results.fail(f"TC-1714-{index}", f"Driver records {label}", api_failure_detail(body))
            return
        results.pass_(f"TC-1714-{index}", f"Driver records {label}", f"event={event_type}")

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
    if complete_status not in (200, 201):
        results.fail("TC-1718", "Driver completes the trip", api_failure_detail(complete_body))
        return
    if complete_body.get("status") != "COMPLETED":
        results.fail("TC-1718", "Completed trip status", str(complete_body))
        return
    results.pass_("TC-1718", "Driver completes the trip", f"trip#{trip_id} status={complete_body['status']}")

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
        {"expectedVersion": submission_version, "resolution": "ACCEPT"},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-review"},
    )
    if review_status not in (200, 201):
        results.fail("TC-1720", "Clerk accepts the e-POD", api_failure_detail(review_body))
        return
    if review_body.get("tripStatus") != "COMPLETED" or review_body.get("shipment", {}).get("status") != "CLOSED":
        results.fail("TC-1720", "Complete/close after e-POD acceptance", str(review_body))
        return
    results.pass_("TC-1720", "Clerk accepts the e-POD", f"trip={review_body.get('tripStatus')} shipment={review_body.get('shipment', {}).get('status')}")

    manager_replay_status, manager_replay_body = request_json(
        manager_api,
        "POST",
        f"/api/shipments/{shipment_id}/pod-reviews/{submission_id}/review",
        {"expectedVersion": submission_version, "resolution": "ACCEPT"},
        headers={"Idempotency-Key": f"{BOOKING_PREFIX}-manager-replay"},
    )
    assert_ok(
        results,
        "TC-1721",
        "Second POD approval is rejected after lock",
        manager_replay_status == 409,
        api_failure_detail(manager_replay_body),
    )

    shipment_detail = clerk_api.get(f"/api/shipments/{shipment_id}")
    shipment_payload = shipment_detail.get("data", shipment_detail)
    if shipment_payload.get("shipment", {}).get("status") != "CLOSED":
        results.fail("TC-1722", "Shipment is closed in persisted detail", str(shipment_payload))
        return
    if not shipment_payload.get("podReviews"):
        results.fail("TC-1722", "Shipment detail exposes POD review", str(shipment_payload))
        return
    results.pass_("TC-1722", "Shipment is closed in persisted detail", f"shipment#{shipment_id}")

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
            "TC-1723",
            "Debit note draft includes the closed Long Minh trip",
            f"targetTripId={trip_id}, generatedTripIds={generated_trip_ids}, eligibility={draft.get('eligibilitySummary')}",
        )
        return
    results.pass_("TC-1723", "Accountant generates the debit note draft", f"trip#{trip_id} is eligible")

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
        results.fail("TC-1724", "Accountant saves the Long Minh debit note", api_failure_detail(save_body))
        return
    document_id = save_body["id"]
    results.pass_("TC-1724", "Accountant saves the Long Minh debit note", f"document#{document_id} template#{template['id']}")

    export_status, export_headers, export_blob = request_binary(
        accountant_api,
        f"/api/finance/billing-documents/{document_id}/export?format=xlsx",
    )
    if export_status != 200:
        results.fail("TC-1725", "Accountant exports the saved Long Minh debit note", f"status={export_status}")
        return
    ok, detail = workbook_has_expected_template(export_blob, "BẢNG KÊ XÁC NHẬN VẬN CHUYỂN HOÀN THÀNH / MẪU DEBIT LONG MINH", bl_number)
    if not ok:
        results.fail("TC-1725", "Exported workbook uses Long Minh template", detail)
        return
    results.pass_("TC-1725", "Accountant exports the saved Long Minh debit note", detail)

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
        "TC-1726",
        "Shipment detail page shows the closed chain",
        booking_ref in body_text and customer["name"] in body_text,
        f"booking={booking_ref} customer={customer['name']}",
    )
    ctx.screenshot(page, f"TC-1726_shipment_{shipment_id}_closed")
    page.close()


if __name__ == "__main__":
    sys.exit(run_suite(TITLE, test_dispatch_persisted_chain))
