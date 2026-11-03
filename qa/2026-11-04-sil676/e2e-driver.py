#!/usr/bin/env python3
# SIL-676 E2E driver — AC2/AC3 local verification against the FIXED backend :3102.
# Creates two CONT20 lots on customer 1 × route 6, dispatches them (pricingRateKey
# CONT20), pairs them KEP, completes + saves actuals, then prints the economics.
# Writes qa/2026-11-04-sil676/e2e-driver.log. Local-QA data seeded up front:
#   road_config(toll_per_station=55000), routes.tolls_stations=2 (route 6),
#   app_settings salary.pair_surcharge_kep=200000  — mirrors the staging
#   config the ticket presumes; documented in the QA artifact.
import json, subprocess, sys, urllib.request, urllib.error, uuid
from datetime import datetime, timedelta, timezone

BASE = 'http://localhost:3102/api'
LOG = []
def log(*parts):
    line = ' '.join(str(p) for p in parts)
    LOG.append(line); print(line)

def call(method, path, token=None, body=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json',
                 'Idempotency-Key': str(uuid.uuid4()),
                 **({'Authorization': f'Bearer {token}'} if token else {})})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

def psql(sql):
    out = subprocess.run(['docker','exec','ss-prod-db','psql','-U','postgres','-d','silversea','-At','-c',sql],
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f'psql failed: {out.stderr}')
    return out.stdout.strip()

# ── 0. Local QA config data (recorded in the artifact) ──────────────────────
psql("INSERT INTO road_config (toll_per_station, return_cargo_bonus, default_driver_salary, two_point_delivery_bonus, vehicle_shift_default) SELECT 55000, 0, 0, 0, 0 WHERE NOT EXISTS (SELECT 1 FROM road_config)")
psql("UPDATE routes SET tolls_stations = 2 WHERE id = 6 AND (tolls_stations IS NULL OR tolls_stations = 0)")
psql("INSERT INTO app_settings (setting_key, setting_value) VALUES ('salary.pair_surcharge_kep','200000') ON CONFLICT (setting_key) DO UPDATE SET setting_value='200000'")
log('qa-config: road_config toll_per_station=55000; route 6 tolls_stations=2; salary.pair_surcharge_kep=200000')

# ── 1. Login + catalog facts ────────────────────────────────────────────────
st, j = call('POST', '/auth/login', body={'identifier':'admin','password':'Abc123'})
assert st == 200, f'login {st}'
tok = j['token']; log('login admin', st)
# POST /trips/:id/complete is an EXCLUSIVE authz grant (authz-grants.ts):
# only ACCOUNTANT + CUS may drive the governed close. Use ketoan for it.
st, j = call('POST', '/auth/login', body={'identifier':'ketoan','password':'Abc123'})
assert st == 200, f'login ketoan {st}'
tok_close = j['token']; log('login ketoan', st)
CT20 = int(psql("SELECT id FROM container_types WHERE code='20DC' LIMIT 1"))
RIGS = [r.split('|') for r in psql("""SELECT t.id, t.license_plate, a.driver_id FROM trucks t
JOIN truck_driver_assignments a ON a.truck_id = t.id AND a.ends_at IS NULL
JOIN drivers d ON d.id = a.driver_id AND d.deleted_at IS NULL
WHERE t.deleted_at IS NULL AND (t.status IS NULL OR t.status = 'ACTIVE') AND t.id NOT IN (
  SELECT truck_id FROM trips WHERE deleted_at IS NULL AND truck_id IS NOT NULL
    AND status IN ('DISPATCHED', 'IN_TRANSIT')
) LIMIT 1""").splitlines()]
assert len(RIGS) >= 1, f'need a free rig, got {RIGS}'
log('catalog: containerType 20DC =', CT20, '| rigs:', [(r[0], r[1], r[2]) for r in RIGS])

now = datetime.now(timezone.utc)
appt = (now + timedelta(hours=2)).isoformat()
vn_appt_date = (now + timedelta(hours=2 + 7)).strftime('%Y-%m-%d')
today = now.strftime('%Y-%m-%d')
# ISO 6346 check digit so the intake validator accepts the QA container numbers.
LETTER_VALUES = {c: v for c, v in zip('ABCDEFGHIJKLMN', [10,12,13,14,15,16,17,18,19,20,21,23,24,25])}
LETTER_VALUES.update({c: v for c, v in zip('OPQRSTUVWXYZ', [26,27,28,29,30,31,32,34,35,36,37,38])})
def iso6346(owner: str, serial: str) -> str:
    chars = owner + serial
    total = sum((LETTER_VALUES.get(ch, int(ch) if ch.isdigit() else 0)) * (2 ** i) for i, ch in enumerate(chars))
    check = total % 11
    return f'{owner}{serial}{0 if check == 10 else check}'

plans = {}
trip_ids = {}
RUN_TAG = now.strftime('%H%M%S')
CONT_A = iso6346('SILU', '676001')
CONT_B = iso6346('SILU', '676002')
for suffix, cont_no in (('A', CONT_A), ('B', CONT_B)):
    leg_offset = 0 if suffix == 'A' else 1.5  # explicit sequential windows, one rig (pair law: same plate)
    leg_appt = (now + timedelta(hours=2 + leg_offset)).isoformat()
    st, created = call('POST', '/shipments', tok, {
        'customerId': 1, 'routeId': 6, 'cargoMode': 'FCL', 'tradeDirection': 'IMPORT',
        'blNumber': f'SIL676QA{RUN_TAG}{suffix}', 'shippingLineName': 'QA SIL676',
        'expectedDeliveryDate': today, 'closingAt': leg_appt, 'customerNotes': 'SIL-676 QA lot ' + suffix,
    })
    assert st in (200, 201), f'lot {suffix} create {st} {created}'
    ship_id = created['id']; ver = created.get('version', 1)
    log(f'lot{suffix}: shipment id={ship_id} version={ver}')
    st, up = call('PUT', f'/shipments/{ship_id}/containers', tok, {
        'expectedVersion': ver,
        'containers': [{'containerTypeId': CT20, 'containerNumber': cont_no, 'cargoWeightKg': 21000, 'customerAppointmentAt': leg_appt, 'routeId': 6, 'rawPickupPortName': 'Cang Cat Lai', 'rawDropoffPortName': 'KCN Que Vo', 'classification': 'DOUBLE'}],
    })
    assert st in (200, 201), f'lot {suffix} containers {st} {up}'
    log(f'lot{suffix}: container upsert ok ({st})')
    st, alloc = call('POST', f'/shipments/{ship_id}/carrier-allocations', tok, {
        'expectedVersion': int(psql(f'SELECT version FROM shipments WHERE id={ship_id}')),
        'carrierAllocations': [{'carrierType': 'OWN', 'count20': 1, 'count40': 0, 'appointmentDate': (now + timedelta(hours=9)).strftime('%Y-%m-%d')}],
    })
    assert st in (200, 201), f'lot {suffix} carrier-allocations {st} {alloc}'
    log(f'lot{suffix}: carrier allocated (OWN 1×20\')')
    st, h = call('POST', f'/shipments/{ship_id}/dispatch-handoffs', tok, {})
    assert st in (200, 201, 409), f'handoff {st} {h}'
    if st == 409:
        st, h = call('GET', f'/shipments/{ship_id}/dispatch-handoff', tok)
    row = h.get('handoff') or h
    handoff_version = int(psql(f'SELECT handoff_version FROM dispatch_handoffs WHERE id={row["id"]}'))
    st, r = call('POST', f"/shipments/{ship_id}/dispatch-handoffs/{row['id']}/resolve", tok,
                 {'resolution': 'ACCEPTED', 'expectedVersion': handoff_version})
    if st not in (200, 201):
        st, r = call('POST', f"/shipments/{ship_id}/dispatch-handoffs/{row['id']}/resolve", tok,
                     {'resolution': 'ACCEPTED', 'expectedVersion': int(psql(f'SELECT version FROM dispatch_handoffs WHERE id={row["id"]}'))})
    assert st in (200, 201), f'handoff accept {st} {r}'
    ful = psql(f"SELECT id, version FROM shipment_fulfillments WHERE shipment_id={ship_id} ORDER BY id DESC LIMIT 1").split('|')
    fid, fver = int(ful[0]), int(ful[1])
    rig = RIGS[0]  # one rig, sequential legs — the pair law requires one plate
    st, issued = call('POST', f'/shipments/{ship_id}/dispatch', tok, {
        'fulfillmentId': fid, 'expectedVersion': fver,
        'plannedStartAt': leg_appt, 'plannedEndAt': (now + timedelta(hours=2 + leg_offset + 1)).isoformat(), 'endTimeConfirmed': True, 'carrierType': 'OWN',
        'truckId': int(rig[0]), 'driverId': int(rig[2]), 'containerTypeId': CT20,
        'pricingRateKey': 'CONT20', 'rigOverlapCompletedConfirmed': True, 'kepWeightWarningConfirmed': True,
    })
    assert st in (200, 201), f'lot {suffix} dispatch {st} {issued}'
    tid = psql(f"SELECT id FROM trips WHERE shipment_id={ship_id} AND deleted_at IS NULL ORDER BY id DESC LIMIT 1")
    trip_ids[suffix] = int(tid)
    plans[trip_ids[suffix]] = {
        'plannedStartAt': leg_appt,
        'plannedEndAt': (now + timedelta(hours=2 + leg_offset + 6)).isoformat(),
        'canonicalOrigin': 'Cang Cat Lai', 'canonicalDestination': 'KCN Que Vo Bac Ninh',
        'cargoWeightKg': 21000, 'vehicleCapacityKg': None,
    }
    log(f'lot{suffix}: dispatched -> trip {tid}')
    st, snap = call('GET', f'/shipments/{ship_id}', tok)
    # snapshot from DB view instead — API detail shape varies; read the frozen row:
    snaprow = psql(f"SELECT id, total_amount, rate_terms_id, pricing_table_id, left(formula_text,80) FROM freight_rate_snapshots WHERE trip_id={tid} ORDER BY id DESC LIMIT 1").split('|')
    log(f'lot{suffix}: snapshot id={snaprow[0]} total={snaprow[1]} rateTermsId={snaprow[2]} pricingTableId={snaprow[3]} formula={snaprow[4] if len(snaprow) > 4 else ""} (trip {tid})')

# ── 2. Pair KEP ─────────────────────────────────────────────────────────────
A, B = trip_ids['A'], trip_ids['B']
def plan_draft(tid):
    # trips.planned_* are timestamp WITHOUT time zone, stored in UTC; to_json
    # emits them offset-less — mark Z so the API's Date comparison matches.
    row = psql(f"SELECT to_json(planned_start_at)#>>'{{}}', to_json(planned_end_at)#>>'{{}}', cargo_weight_kg::text, vehicle_capacity_kg::text, coalesce(canonical_origin,''), coalesce(canonical_destination,'') FROM trips WHERE id={tid}").split('|')
    fixed = [v if ('+' in v or v.endswith('Z')) else v + 'Z' for v in row[:2]]
    return {'plannedStartAt': fixed[0], 'plannedEndAt': fixed[1],
            'canonicalOrigin': row[4], 'canonicalDestination': row[5],
            'cargoWeightKg': float(row[2]), 'vehicleCapacityKg': float(row[3]) if row[3] not in ('', None) else None}
st, pair = call('POST', '/trips/pairs', tok, {
    'firstTripId': A, 'secondTripId': B, 'pairKind': 'KEP',
    'firstTrip': plan_draft(A), 'secondTrip': plan_draft(B),
})
assert st in (200, 201), f'pair {st} {pair}'
log('pair created:', pair.get('id'), pair.get('pairKind'))

# ── 3. Complete both (POD) then save actuals ────────────────────────────────
for suffix, tid in trip_ids.items():
    tv = int(psql(f'SELECT version FROM trips WHERE id={tid}'))
    st, disp = call('POST', f'/trips/{tid}/dispatch', tok, {'expectedVersion': tv})
    assert st in (200, 201), f'trip {tid} in-transit {st} {disp}'
    tv = int(psql(f'SELECT version FROM trips WHERE id={tid}'))
    st, comp = call('POST', f'/trips/{tid}/complete', tok_close, {'expectedVersion': tv, 'reason': 'SIL-676 QA pair completion (local)'})
    assert st in (200, 201), f'trip {tid} complete {st} {comp}'
    tv2 = int(psql(f'SELECT version FROM trips WHERE id={tid}'))
    st, act = call('PUT', f'/trips/{tid}/actuals', tok_close, {'version': tv2})
    assert st in (200, 201), f'trip {tid} actuals {st} {json.dumps(act)[:300]}'
    log(f'trip {tid} ({suffix}): completed + actuals saved')

# ── 4. Economics proof ──────────────────────────────────────────────────────
for suffix, tid in trip_ids.items():
    row = psql(f"SELECT t.id, t.revenue::text, t.toll_cost::text, t.driver_salary::text, t.total_cost::text, t.active_trip_pair_id, t.active_trip_pair_order FROM trips t WHERE t.id={tid}").split('|')
    log(f'ECON trip {tid} ({suffix}): revenue={row[1]} tollCost={row[2]} driverSalary={row[3]} totalCost={row[4]} pairId={row[5]} pairOrder={row[6]}')

open(__file__.replace('.py', '.log'), 'w').write('\n'.join(LOG) + '\n')
print('E2E DONE')
