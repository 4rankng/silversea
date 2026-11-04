#!/usr/bin/env python3
# SIL-676 r4 + SIL-638 TC3-T3 — pair economics E2E on the r4 build (local,
# ss-prod-db, backend :3103 = this branch fix/econ-r4-vetc-salary).
#
# Two scenarios, one fresh pair each, BOTH completed through the DRIVER-APP
# flow only (no actuals save — the exact staging pair-30 completion shape):
#
#   python3 e2e-pair-econ-r4.py staging      # staging pair-30 SHAPE: route 6
#                                            # tolls_stations NULL, no pair
#                                            # surcharge setting, driver base 0
#   python3 e2e-pair-econ-r4.py configured   # fully configured: 2 stations ×
#                                            # 55.000, kep surcharge 200.000,
#                                            # driver base 5.000.000
#
# staging asserts the r4 marker law: driverSalary/tollCost become EXPLICIT
# computed 0 (never NULL), settlements OS-PAIR carries tollOnceLeg=1 +
# tollAmount=0 + tollZeroReason='route_chua_cau_hinh_tram' + the owner warning
# in the note; driver detail costBreakdown carries the same marker.
# configured asserts the TC3-T3 acceptance: VETC 110.000 once, base
# 192.308 + phụ phí 200.000, header totalCost 302.308 ≠ 0, ledger both legs,
# snapshot 3.952.000/pricingTable 33, pricing lookup 3.800.000 — no marker.
import json, struct, subprocess, sys, urllib.request, urllib.error, uuid, zlib
from datetime import datetime, timedelta, timezone

MODE = sys.argv[1] if len(sys.argv) > 1 else 'configured'
PORT = sys.argv[2] if len(sys.argv) > 2 else '3103'
BASE = f'http://localhost:{PORT}/api'
LOG = []
FAILURES = []

def log(*parts):
    line = ' '.join(str(p) for p in parts)
    LOG.append(line); print(line)

def fail(msg):
    FAILURES.append(msg); log('  FAIL:', msg)

def call(method, path, token=None, body=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4()),
                 **({'Authorization': f'Bearer {token}'} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}')
        except Exception:
            return e.code, {}

def psql(sql):
    out = subprocess.run(['docker','exec','ss-prod-db','psql','-U','postgres','-d','silversea','-At','-c',sql],
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f'psql failed: {out.stderr}')
    return out.stdout.strip()

def png_bytes():
    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00'))
    return b'\x89PNG\r\n\x1a\n' + ihdr + idat + chunk(b'IEND', b'')

def multipart(path, token, fields, filename, content):
    boundary = '----r4qa' + uuid.uuid4().hex[:8]
    parts = b''
    for name, value in fields.items():
        parts += (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n').encode()
    parts += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
              f'Content-Type: image/png\r\n\r\n').encode() + content + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(BASE + path, method='POST', data=parts,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}',
                 'Idempotency-Key': str(uuid.uuid4()), 'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, {}

# ── Staging-shape mutations (bounded, backed up, restored in finally) ──────
route_backup = setting_backup = driver_salary_backup = None
assigned_driver_id = None
try:
    plain = psql("SELECT id, code, deleted_at FROM vehicle_size_classes WHERE code IN ('CONT20','CONT40')")
    log('catalog plain rows before:', plain)
    psql("UPDATE vehicle_size_classes SET deleted_at = now() WHERE code IN ('CONT20','CONT40') AND deleted_at IS NULL")
    log('staging shape applied: plain CONT20/CONT40 soft-deleted for this run')

    if MODE == 'staging':
        route_backup = psql('SELECT coalesce(tolls_stations::text,\'NULL\') FROM routes WHERE id=6')
        setting_backup = psql("SELECT coalesce(setting_value,'ABSENT') FROM app_settings WHERE setting_key='salary.pair_surcharge_kep'")
        psql('UPDATE routes SET tolls_stations = NULL WHERE id = 6')
        psql("DELETE FROM app_settings WHERE setting_key='salary.pair_surcharge_kep'")
        log(f'staging shape: route 6 tolls_stations NULL (was {route_backup}); salary.pair_surcharge_kep removed (was {setting_backup})')
    else:
        psql("INSERT INTO road_config (toll_per_station, return_cargo_bonus, default_driver_salary, two_point_delivery_bonus, vehicle_shift_default) SELECT 55000, 0, 0, 0, 0 WHERE NOT EXISTS (SELECT 1 FROM road_config)")
        psql("UPDATE routes SET tolls_stations = 2 WHERE id = 6")
        psql("INSERT INTO app_settings (setting_key, setting_value) VALUES ('salary.pair_surcharge_kep','200000') ON CONFLICT (setting_key) DO UPDATE SET setting_value='200000'")
        log('configured shape: road_config toll 55000; route 6 tolls_stations=2; salary.pair_surcharge_kep=200000')

    st, j = call('POST', '/auth/login', body={'identifier':'admin','password':'Abc123'})
    assert st == 200, f'login admin {st}'
    tok = j['token']
    log(f'login admin ok against :{PORT}')

    CT20 = int(psql("SELECT id FROM container_types WHERE code='20DC' LIMIT 1"))
    RIGS = [r.split('|') for r in psql("""SELECT t.id, t.license_plate, a.driver_id FROM trucks t
    JOIN truck_driver_assignments a ON a.truck_id = t.id AND a.ends_at IS NULL
    JOIN drivers d ON d.id = a.driver_id AND d.deleted_at IS NULL
    WHERE t.deleted_at IS NULL AND (t.status IS NULL OR t.status = 'ACTIVE') AND t.id NOT IN (
      SELECT truck_id FROM trips WHERE deleted_at IS NULL AND truck_id IS NOT NULL
        AND status IN ('DISPATCHED', 'IN_TRANSIT')
    ) LIMIT 1""").splitlines()]
    assert len(RIGS) >= 1, f'need a free rig, got {RIGS}'
    assigned_driver_id = int(RIGS[0][2])
    driver_salary_backup = psql(f'SELECT base_salary FROM drivers WHERE id={assigned_driver_id}')
    base_for_run = 0 if MODE == 'staging' else 5000000
    psql(f'UPDATE drivers SET base_salary = {base_for_run} WHERE id={assigned_driver_id}')
    log('catalog: containerType 20DC =', CT20, '| rig:', RIGS[0], f'(driver base_salary {base_for_run} for the run, was {driver_salary_backup})')

    now = datetime.now(timezone.utc)
    today = now.strftime('%Y-%m-%d')
    RUN_TAG = now.strftime('%H%M%S')
    LETTER_VALUES = {c: v for c, v in zip('ABCDEFGHIJKLMN', [10,12,13,14,15,16,17,18,19,20,21,23,24,25])}
    LETTER_VALUES.update({c: v for c, v in zip('OPQRSTUVWXYZ', [26,27,28,29,30,31,32,34,35,36,37,38])})
    def iso6346(owner, serial):
        chars = owner + serial
        total = sum((LETTER_VALUES.get(ch, int(ch) if ch.isdigit() else 0)) * (2 ** i) for i, ch in enumerate(chars))
        check = total % 11
        return f'{owner}{serial}{0 if check == 10 else check}'

    trip_ids = {}
    for suffix, serial in (('A', '678801'), ('B', '678802')):
        cont_no = iso6346('SILU', serial)
        leg_offset = 0 if suffix == 'A' else 1.5
        leg_appt = (now + timedelta(hours=2 + leg_offset)).isoformat()
        st, created = call('POST', '/shipments', tok, {
            'customerId': 1, 'routeId': 6, 'cargoMode': 'FCL', 'tradeDirection': 'IMPORT',
            'blNumber': f'SILR4{RUN_TAG}{suffix}', 'shippingLineName': 'QA R4',
            'expectedDeliveryDate': today, 'closingAt': leg_appt, 'customerNotes': 'r4 economics QA lot ' + suffix,
        })
        assert st in (200, 201), f'lot {suffix} create {st} {created}'
        ship_id = created['id']; ver = created.get('version', 1)
        st, up = call('PUT', f'/shipments/{ship_id}/containers', tok, {
            'expectedVersion': ver,
            'containers': [{'containerTypeId': CT20, 'containerNumber': cont_no, 'cargoWeightKg': 21000, 'customerAppointmentAt': leg_appt, 'routeId': 6, 'rawPickupPortName': 'Cang Cat Lai', 'rawDropoffPortName': 'KCN Que Vo', 'classification': 'DOUBLE'}],
        })
        assert st in (200, 201), f'lot {suffix} containers {st} {up}'
        st, alloc = call('POST', f'/shipments/{ship_id}/carrier-allocations', tok, {
            'expectedVersion': int(psql(f'SELECT version FROM shipments WHERE id={ship_id}')),
            'carrierAllocations': [{'carrierType': 'OWN', 'count20': 1, 'count40': 0, 'appointmentDate': (now + timedelta(hours=9)).strftime('%Y-%m-%d')}],
        })
        assert st in (200, 201), f'lot {suffix} carrier-allocations {st} {alloc}'
        st, h = call('POST', f'/shipments/{ship_id}/dispatch-handoffs', tok, {})
        if st == 409:
            st, h = call('GET', f'/shipments/{ship_id}/dispatch-handoff', tok)
        row = h.get('handoff') or h
        hv = int(psql(f'SELECT handoff_version FROM dispatch_handoffs WHERE id={row["id"]}'))
        st, r = call('POST', f"/shipments/{ship_id}/dispatch-handoffs/{row['id']}/resolve", tok,
                     {'resolution': 'ACCEPTED', 'expectedVersion': hv})
        if st not in (200, 201):
            st, r = call('POST', f"/shipments/{ship_id}/dispatch-handoffs/{row['id']}/resolve", tok,
                         {'resolution': 'ACCEPTED', 'expectedVersion': int(psql(f'SELECT version FROM dispatch_handoffs WHERE id={row["id"]}'))})
        assert st in (200, 201), f'handoff accept {st} {r}'
        fid, fver = map(int, psql(f"SELECT id, version FROM shipment_fulfillments WHERE shipment_id={ship_id} ORDER BY id DESC LIMIT 1").split('|'))
        rig = RIGS[0]
        st, issued = call('POST', f'/shipments/{ship_id}/dispatch', tok, {
            'fulfillmentId': fid, 'expectedVersion': fver,
            'plannedStartAt': leg_appt, 'plannedEndAt': (now + timedelta(hours=2 + leg_offset + 1)).isoformat(), 'endTimeConfirmed': True, 'carrierType': 'OWN',
            'truckId': int(rig[0]), 'driverId': assigned_driver_id, 'containerTypeId': CT20,
            'pricingRateKey': 'CONT20', 'rigOverlapCompletedConfirmed': True, 'kepWeightWarningConfirmed': True,
        })
        assert st in (200, 201), f'lot {suffix} dispatch {st} {issued}'
        tid = int(psql(f"SELECT id FROM trips WHERE shipment_id={ship_id} AND deleted_at IS NULL ORDER BY id DESC LIMIT 1"))
        trip_ids[suffix] = tid
        snaprow = psql(f"SELECT id, total_amount, rate_terms_id, pricing_table_id, he_so FROM freight_rate_snapshots WHERE trip_id={tid} ORDER BY id DESC LIMIT 1").split('|')
        log(f'lot{suffix}: dispatched -> trip {tid}; snapshot id={snaprow[0]} total={snaprow[1]} rateTerms={snaprow[2]} pricingTable={snaprow[3]} heSo={snaprow[4]}')

    # ── Pair KẸP ────────────────────────────────────────────────────────────
    A, B = trip_ids['A'], trip_ids['B']
    def plan_draft(tid):
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
    PAIR_ID = pair.get('id')
    log('pair created:', PAIR_ID, pair.get('pairKind'))

    # ── Complete BOTH legs through the driver-app flow ONLY (no actuals) ────
    driver_tokens = {}
    driver_username = None
    for suffix, tid in trip_ids.items():
        ship = int(psql(f'SELECT shipment_id FROM trips WHERE id={tid}'))
        psql(f"INSERT INTO user_shipment_links (user_id, shipment_id) SELECT (SELECT id FROM users WHERE username='giaonhan' LIMIT 1), {ship} WHERE NOT EXISTS (SELECT 1 FROM user_shipment_links WHERE user_id=(SELECT id FROM users WHERE username='giaonhan' LIMIT 1) AND shipment_id={ship})")
        tok_ops = call('POST', '/auth/login', body={'identifier':'giaonhan','password':'Abc123'})[1]['token']
        for tcid in [None] + [int(x) for x in psql(f'SELECT id FROM trip_containers WHERE trip_id={tid}').split() if x]:
            st, out = call('PUT', f'/forwarder/me/trips/{tid}/expense-completion', tok_ops,
                           {'tripContainerId': tcid, 'completed': True})
            assert st == 200, f'scope {tid}/{tcid} {st} {out}'
        st, disp = call('POST', f'/trips/{tid}/dispatch', tok, {'expectedVersion': int(psql(f'SELECT version FROM trips WHERE id={tid}'))})
        assert st in (200, 201), f'trip {tid} in-transit {st} {disp}'
        fid = int(psql(f'SELECT fulfillment_id FROM trips WHERE id={tid}'))
        driver_username = psql(f"SELECT u.username FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.id=(SELECT driver_id FROM trips WHERE id={tid}) LIMIT 1")
        if driver_username not in driver_tokens:
            driver_tokens[driver_username] = call('POST', '/auth/login', body={'identifier': driver_username, 'password': 'Abc123'})[1]['token']
        tok_driver = driver_tokens[driver_username]
        st, sub = call('POST', f'/driver/me/fulfillments/{fid}/pod', tok_driver,
                       {'expectedVersion': int(psql(f'SELECT version FROM trips WHERE id={tid}'))})
        assert st in (200, 201, 409), f'pod create {tid} {st} {sub}'
        sid = int(psql(f'SELECT id FROM trip_pod_submissions WHERE fulfillment_id={fid} ORDER BY id DESC LIMIT 1'))
        st_up, up = multipart(f'/driver/me/fulfillments/{fid}/pod/{sid}/files', tok_driver,
             {'expectedVersion': str(psql(f'SELECT version FROM trip_pod_submissions WHERE id={sid}')),
              'fileType': 'SIGNED_DELIVERY_NOTE'}, 'pod.png', png_bytes())
        assert st_up in (200, 201), f'pod attach {tid} {st_up} {up}'
        st, done = call('POST', f'/driver/me/fulfillments/{fid}/pod/{sid}/submit', tok_driver,
                        {'expectedVersion': int(psql(f'SELECT version FROM trip_pod_submissions WHERE id={sid}'))})
        assert st in (200, 201), f'pod submit {tid} {st} {done}'
        st, prog = call('POST', f'/driver/me/trips/{tid}/progress', tok_driver,
                        {'eventType': 'ORDER_RECEIVED', 'occurredAt': datetime.now(timezone.utc).isoformat(), 'note': 'r4 QA'})
        assert st in (200, 201, 409), f'progress {tid} {st} {prog}'
        st, comp = call('POST', f'/driver/me/fulfillments/{fid}/complete', tok_driver,
                        {'expectedVersion': int(psql(f'SELECT version FROM trips WHERE id={tid}'))})
        assert st in (200, 201), f'driver close {tid} {st} {comp}'
        log(f'trip {tid} ({suffix}): COMPLETED via driver-app close (no actuals save)')

    # ── Economics reads (immediately after completion) ──────────────────────
    log('--- ASSERTIONS ---')
    first_leg = int(psql(f'SELECT first_trip_id FROM trip_pairs WHERE id={PAIR_ID}'))
    legA, legB = (A, B) if first_leg == A else (B, A)
    fin = {}
    for label, tid in (('A', legA), ('B', legB)):
        raw = psql(f"SELECT coalesce(driver_salary::text,'NULL'), coalesce(toll_cost::text,'NULL'), coalesce(toll_deduction,0)::text, coalesce(total_cost::text,'NULL') FROM trip_financial_state WHERE trip_id={tid}").split('|')
        fin[label] = raw
        log(f'ECON trip {tid} (leg {label}): driverSalary={raw[0]} tollCost={raw[1]} tollDeduction={raw[2]} totalCost={raw[3]}')

    if MODE == 'staging':
        # r4 law: NEVER a NULL gap — explicit computed 0 on both legs.
        for label in ('A', 'B'):
            if fin[label][0] == 'NULL': fail(f'leg {label} driverSalary is NULL (must be explicit 0)')
            if fin[label][1] == 'NULL': fail(f'leg {label} tollCost is NULL (must be explicit 0)')
        if fin['A'][0] not in ('', '0'): fail(f"leg A driverSalary {fin['A'][0]} != 0 (staging shape: nothing configured)")
        if fin['B'][0] not in ('', '0'): fail(f"leg B driverSalary {fin['B'][0]} != 0")
        log(f'1. staging shape: driverSalary A={fin["A"][0]} B={fin["B"][0]} — explicit 0, never NULL')
    else:
        # Wage days follow the existing completedTripWageDays law: departure
        # (UTC midnight of the date-only string) → completion,
        # round(diffMs / 86_400_000) + 1 — an afternoon completion is 2 days
        # by that law, morning 1.
        exp_days = max(1, round((now.timestamp() - datetime(now.year, now.month, now.day, tzinfo=timezone.utc).timestamp()) * 1000 / 86_400_000) + 1)
        exp_base = round(5_000_000 / 26 * exp_days)
        log(f'wage law: days={exp_days} expected base={exp_base} (departure {today}, completed {now.isoformat()})')
        if fin['A'][0] != str(exp_base): fail(f"leg A driverSalary {fin['A'][0]} != {exp_base} (base/26×{exp_days})")
        if fin['B'][0] != '200000': fail(f"leg B driverSalary {fin['B'][0]} != 200000 (phụ phí settings)")
        if fin['A'][1] != '110000': fail(f"leg A tollCost {fin['A'][1]} != 110000 (2×55000)")
        if fin['B'][1] != '0': fail(f"leg B tollCost {fin['B'][1]} != 0")
        if fin['B'][2] != '110000': fail(f"leg B tollDeduction {fin['B'][2]} != 110000")
        log(f'1. configured: salary A={exp_base} B=200.000; VETC once A=110.000 / B=0 + deduction 110.000')

    # costBreakdown on trips composite + driver detail (the header surfaces)
    st, tripA = call('GET', f'/trips/{legA}', tok)
    cbA = tripA.get('costBreakdown') if st == 200 else None
    log(f'2a. GET /api/trips/{legA} -> {st} costBreakdown={json.dumps(cbA)}')
    if st != 200 or not cbA: fail('trips composite costBreakdown missing')
    driver_user_row = psql(f"SELECT u.username FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.id={assigned_driver_id} LIMIT 1")
    tok_driver = driver_tokens.get(driver_user_row)
    st, det = call('GET', f'/driver/me/trips/{legA}', tok_driver)
    cbd = det.get('costBreakdown') if st == 200 else None
    log(f'2b. GET /api/driver/me/trips/{legA} -> {st} costBreakdown={json.dumps(cbd)}')
    if st != 200 or not cbd: fail('driver detail costBreakdown missing')

    # Settlements OS-PAIR record
    st, settlements = call('GET', '/settlements', tok)
    items = settlements.get('items') if st == 200 else None
    pair_rows = [i for i in (items or []) if i.get('source') == 'TRIP_PAIR' and i.get('pairId') == PAIR_ID]
    log(f'3. GET /api/settlements -> {st} items={len(items or [])} pairRecord={json.dumps(pair_rows)[:500]}')
    if st != 200: fail(f'settlements admin {st}')
    if len(pair_rows) != 1: fail(f'expected exactly 1 OS-PAIR-{PAIR_ID} record, got {len(pair_rows)}')
    else:
        econ = pair_rows[0].get('economics') or {}
        if econ.get('tollOnceLeg') != 1: fail(f"tollOnceLeg {econ.get('tollOnceLeg')} != 1")
        if MODE == 'staging':
            if econ.get('tollAmount') != 0: fail(f"tollAmount {econ.get('tollAmount')} != 0")
            if econ.get('tollZeroReason') != 'route_chua_cau_hinh_tram': fail(f"tollZeroReason {econ.get('tollZeroReason')} != route_chua_cau_hinh_tram")
            if 'Route chưa cấu hình trạm thu VETC — cần nhập để tính' not in (pair_rows[0].get('note') or ''): fail('warning missing from settlement note')
            if cbd and cbd.get('tollZeroReason') != 'route_chua_cau_hinh_tram': fail(f"driver detail tollZeroReason {cbd.get('tollZeroReason')}")
            log('4. staging marker: settlements + driver detail carry route_chua_cau_hinh_tram + warning')
        else:
            if econ.get('tollAmount') != 110000: fail(f"tollAmount {econ.get('tollAmount')} != 110000")
            if econ.get('tollZeroReason') is not None: fail(f"tollZeroReason {econ.get('tollZeroReason')} != null (configured route)")
            if econ.get('baseSalary') != int(fin['A'][0]): fail(f"baseSalary {econ.get('baseSalary')} != {fin['A'][0]}")
            if econ.get('surcharge') != 200000: fail(f"surcharge {econ.get('surcharge')} != 200000")
            if cbd:
                if not cbd.get('totalCost'): fail(f"header totalCost {cbd.get('totalCost')} must be non-zero")
                if cbd.get('tollZeroReason') is not None: fail(f"driver tollZeroReason {cbd.get('tollZeroReason')} != null")
            log(f'4. configured: OS-PAIR tollOnceLeg=1 amount=110.000, no marker; header totalCost {cbd.get("totalCost") if cbd else "?"}')

    if MODE == 'configured':
        ledger_a = psql(f"SELECT count(*) FROM ledger WHERE txn_type='DRIVER_SALARY' AND txn_id={legA} AND entity_type='DRIVER'")
        ledger_b = psql(f"SELECT count(*) FROM ledger WHERE txn_type='DRIVER_SALARY' AND txn_id={legB} AND entity_type='DRIVER'")
        log(f'5. ledger DRIVER_SALARY entries: legA={ledger_a} legB={ledger_b}')
        if ledger_a == '0': fail('leg A DRIVER_SALARY ledger entry missing')
        if ledger_b == '0': fail('leg B DRIVER_SALARY ledger entry missing')
        snap = psql(f"SELECT total_amount, pricing_table_id, rate_terms_id FROM freight_rate_snapshots WHERE trip_id={legA} ORDER BY id DESC LIMIT 1").split('|')
        log(f'REG snapshot: total={snap[0]} (expect 3952000) pricingTableId={snap[1]} (expect 33) rateTermsId={snap[2]}')
        if snap[0] != '3952000' or snap[1] != '33': fail(f'snapshot regression: {snap}')
        st, price = call('GET', '/pricing?customerId=1&routeId=6&containerCount=1&rateKey=CONT20', tok)
        log(f'REG pricing lookup -> {st} {json.dumps(price)[:120]}')
        if price.get('price') != 3800000: fail(f"pricing lookup {price.get('price')} != 3800000")

    log(f'R4 MODE={MODE} FAILURES:', len(FAILURES))
    log(f'DRIVER_USER={driver_username} TRIPS_A_B={legA}|{legB} PAIR={PAIR_ID}')
    sys.exit(1 if FAILURES else 0)
finally:
    psql("UPDATE vehicle_size_classes SET deleted_at = NULL WHERE code IN ('CONT20','CONT40') AND deleted_at IS NOT NULL")
    if MODE == 'staging':
        if route_backup is not None:
            val = 'NULL' if route_backup == 'NULL' else route_backup
            psql(f'UPDATE routes SET tolls_stations = {val} WHERE id = 6')
        if setting_backup is not None:
            if setting_backup == 'ABSENT':
                psql("DELETE FROM app_settings WHERE setting_key='salary.pair_surcharge_kep'")
            else:
                psql(f"INSERT INTO app_settings (setting_key, setting_value) VALUES ('salary.pair_surcharge_kep','{setting_backup}') ON CONFLICT (setting_key) DO UPDATE SET setting_value='{setting_backup}'")
    if assigned_driver_id is not None and driver_salary_backup not in (None, ''):
        psql(f'UPDATE drivers SET base_salary = {driver_salary_backup} WHERE id={assigned_driver_id}')
    log('cleanup: catalog restored; route 6 tolls_stations restored' if MODE == 'staging'
        else 'cleanup: catalog restored; settings kept (wave7 values)')
    safe_mode = ''.join(ch if ch.isalnum() else '_' for ch in MODE)
    open(__file__.replace('.py', f'-{safe_mode}.log'), 'w').write('\n'.join(LOG) + '\n')
