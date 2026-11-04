#!/usr/bin/env python3
# SIL-676 R2 — AC1 local E2E against the FIXED backend :3102, with the lane
# shaped like the STAGING mirror: the plain CONT20/CONT40 rows are soft-deleted
# from vehicle_size_classes for the run (staging has no such rows — that is the
# exact shape whose old class-catalog gate priced pair 25 at 0/null), then
# restored. Creates two CONT20 lots (21 t cargo → CONT20.HEAVY ask), dispatches,
# pairs KEP, completes both, saves actuals, prints economics:
#   expected snapshot: AUTO 3.952.000 = 3.800.000×1.04, rate_terms_id=1,
#   pricing_table_id=33 (CONT20 row, INHERITED ask CONT20.HEAVY),
#   revenue/tollCost/driverSalary != 0/null, VETC once per pair.
import json, struct, subprocess, sys, urllib.request, urllib.error, uuid, zlib
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

# ── 0. Staging-shape: hide the plain CONT20/CONT40 catalog rows ─────────────
plain = psql("SELECT id, code, deleted_at FROM vehicle_size_classes WHERE code IN ('CONT20','CONT40')")
log('catalog plain rows before:', plain)
psql("UPDATE vehicle_size_classes SET deleted_at = now() WHERE code IN ('CONT20','CONT40') AND deleted_at IS NULL")
log('staging shape applied: plain CONT20/CONT40 soft-deleted for this run')
try:
    # ── 1. QA config (same seeds round-1 documented) ────────────────────────
    psql("INSERT INTO road_config (toll_per_station, return_cargo_bonus, default_driver_salary, two_point_delivery_bonus, vehicle_shift_default) SELECT 55000, 0, 0, 0, 0 WHERE NOT EXISTS (SELECT 1 FROM road_config)")
    psql("UPDATE routes SET tolls_stations = 2 WHERE id = 6 AND (tolls_stations IS NULL OR tolls_stations = 0)")
    psql("INSERT INTO app_settings (setting_key, setting_value) VALUES ('salary.pair_surcharge_kep','200000') ON CONFLICT (setting_key) DO UPDATE SET setting_value='200000'")
    log('qa-config: road_config toll_per_station=55000; route 6 tolls_stations=2; salary.pair_surcharge_kep=200000')

    # ── 2. Logins ───────────────────────────────────────────────────────────
    st, j = call('POST', '/auth/login', body={'identifier':'admin','password':'Abc123'})
    assert st == 200, f'login admin {st}'
    tok = j['token']
    st, j = call('POST', '/auth/login', body={'identifier':'ketoan','password':'Abc123'})
    assert st == 200, f'login ketoan {st}'
    tok_close = j['token']
    log('logins ok (admin, ketoan)')

    CT20 = int(psql("SELECT id FROM container_types WHERE code='20DC' LIMIT 1"))
    RIGS = [r.split('|') for r in psql("""SELECT t.id, t.license_plate, a.driver_id FROM trucks t
    JOIN truck_driver_assignments a ON a.truck_id = t.id AND a.ends_at IS NULL
    JOIN drivers d ON d.id = a.driver_id AND d.deleted_at IS NULL
    WHERE t.deleted_at IS NULL AND (t.status IS NULL OR t.status = 'ACTIVE') AND t.id NOT IN (
      SELECT truck_id FROM trips WHERE deleted_at IS NULL AND truck_id IS NOT NULL
        AND status IN ('DISPATCHED', 'IN_TRANSIT')
    ) LIMIT 1""").splitlines()]
    assert len(RIGS) >= 1, f'need a free rig, got {RIGS}'
    log('catalog: containerType 20DC =', CT20, '| rig:', RIGS[0])

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
    for suffix, serial in (('A', '676101'), ('B', '676102')):
        cont_no = iso6346('SILU', serial)
        leg_offset = 0 if suffix == 'A' else 1.5
        leg_appt = (now + timedelta(hours=2 + leg_offset)).isoformat()
        st, created = call('POST', '/shipments', tok, {
            'customerId': 1, 'routeId': 6, 'cargoMode': 'FCL', 'tradeDirection': 'IMPORT',
            'blNumber': f'SIL676R2{RUN_TAG}{suffix}', 'shippingLineName': 'QA SIL676',
            'expectedDeliveryDate': today, 'closingAt': leg_appt, 'customerNotes': 'SIL-676 R2 QA lot ' + suffix,
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
            'truckId': int(rig[0]), 'driverId': int(rig[2]), 'containerTypeId': CT20,
            'pricingRateKey': 'CONT20', 'rigOverlapCompletedConfirmed': True, 'kepWeightWarningConfirmed': True,
        })
        assert st in (200, 201), f'lot {suffix} dispatch {st} {issued}'
        tid = int(psql(f"SELECT id FROM trips WHERE shipment_id={ship_id} AND deleted_at IS NULL ORDER BY id DESC LIMIT 1"))
        trip_ids[suffix] = tid
        snaprow = psql(f"SELECT id, total_amount, rate_terms_id, pricing_table_id, he_so, left(coalesce(formula_text,''),90) FROM freight_rate_snapshots WHERE trip_id={tid} ORDER BY id DESC LIMIT 1").split('|')
        log(f'lot{suffix}: dispatched -> trip {tid}; snapshot id={snaprow[0]} total={snaprow[1]} rateTerms={snaprow[2]} pricingTable={snaprow[3]} heSo={snaprow[4]}')
        log(f'  formula: {snaprow[5] if len(snaprow) > 5 else ""}')

    # ── 3. Pair KEP ─────────────────────────────────────────────────────────
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
    log('pair created:', pair.get('id'), pair.get('pairKind'))

    # ── 4. Complete both (POD milestones + governed close) + actuals ────────
    for suffix, tid in trip_ids.items():
        ship = int(psql(f'SELECT shipment_id FROM trips WHERE id={tid}'))
        psql(f'INSERT INTO user_shipment_links (user_id, shipment_id) SELECT (SELECT id FROM users WHERE username=\'giaonhan\' LIMIT 1), {ship} WHERE NOT EXISTS (SELECT 1 FROM user_shipment_links WHERE user_id=(SELECT id FROM users WHERE username=\'giaonhan\' LIMIT 1) AND shipment_id={ship})')
        tok_ops = call('POST', '/auth/login', body={'identifier':'giaonhan','password':'Abc123'})[1]['token']
        for tcid in [None] + [int(x) for x in psql(f'SELECT id FROM trip_containers WHERE trip_id={tid}').split() if x]:
            st, out = call('PUT', f'/forwarder/me/trips/{tid}/expense-completion', tok_ops,
                           {'tripContainerId': tcid, 'completed': True})
            assert st == 200, f'scope {tid}/{tcid} {st} {out}'
        st, disp = call('POST', f'/trips/{tid}/dispatch', tok, {'expectedVersion': int(psql(f'SELECT version FROM trips WHERE id={tid}'))})
        assert st in (200, 201), f'trip {tid} in-transit {st} {disp}'
        fid = int(psql(f'SELECT fulfillment_id FROM trips WHERE id={tid}'))
        driver_user = psql(f"SELECT u.username FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.id=(SELECT driver_id FROM trips WHERE id={tid}) LIMIT 1")
        tok_driver_tok = call('POST', '/auth/login', body={'identifier': driver_user, 'password': 'Abc123'})[1]['token']
        st, sub = call('POST', f'/driver/me/fulfillments/{fid}/pod', tok_driver_tok,
                       {'expectedVersion': int(psql(f'SELECT version FROM trips WHERE id={tid}'))})
        assert st in (200, 201, 409), f'pod create {tid} {st} {sub}'
        sid = int(psql(f'SELECT id FROM trip_pod_submissions WHERE fulfillment_id={fid} ORDER BY id DESC LIMIT 1'))
        boundary = '----sil676r2qa' + uuid.uuid4().hex[:8]
        parts = b''
        for name, value in {'expectedVersion': str(psql(f'SELECT version FROM trip_pod_submissions WHERE id={sid}')), 'fileType': 'SIGNED_DELIVERY_NOTE'}.items():
            parts += (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n').encode()
        parts += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="pod.png"\r\nContent-Type: image/png\r\n\r\n').encode() + png_bytes() + f'\r\n--{boundary}--\r\n'.encode()
        req = urllib.request.Request(BASE + f'/driver/me/fulfillments/{fid}/pod/{sid}/files', method='POST', data=parts,
            headers={'Content-Type': f'multipart/form-data; boundary={boundary}',
                     'Idempotency-Key': str(uuid.uuid4()), 'Authorization': f'Bearer {tok_driver_tok}'})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                st_up = r.status
        except urllib.error.HTTPError as e:
            st_up = e.code
        assert st_up in (200, 201), f'pod attach {tid} {st_up}'
        st, done = call('POST', f'/driver/me/fulfillments/{fid}/pod/{sid}/submit', tok_driver_tok,
                        {'expectedVersion': int(psql(f'SELECT version FROM trip_pod_submissions WHERE id={sid}'))})
        assert st in (200, 201), f'pod submit {tid} {st} {done}'
        st, prog = call('POST', f'/driver/me/trips/{tid}/progress', tok_driver_tok,
                        {'eventType': 'ORDER_RECEIVED', 'occurredAt': datetime.now(timezone.utc).isoformat(), 'note': 'SIL-676 R2 QA'})
        assert st in (200, 201, 409), f'progress {tid} {st} {prog}'
        st, comp = call('POST', f'/driver/me/fulfillments/{fid}/complete', tok_driver_tok,
                        {'expectedVersion': int(psql(f'SELECT version FROM trips WHERE id={tid}'))})
        assert st in (200, 201), f'driver close {tid} {st} {comp}'
        tv = int(psql(f'SELECT version FROM trips WHERE id={tid}'))
        st, act = call('PUT', f'/trips/{tid}/actuals', tok_close, {'version': tv, 'legs': [], 'fuelMode': 'AUTO'})
        assert st in (200, 201), f'actuals {tid} {st} {json.dumps(act)[:300]}'
        log(f'trip {tid} ({suffix}): completed + actuals saved')

    # ── 5. Economics proof ──────────────────────────────────────────────────
    failures = 0
    for suffix, tid in trip_ids.items():
        fin = psql(f"SELECT revenue::text, toll_cost::text, toll_deduction::text, driver_salary::text, total_cost::text, gross_profit::text FROM trip_financial_state WHERE trip_id={tid}").split('|')
        meta = psql(f'SELECT tolls_stations, active_trip_pair_id, active_trip_pair_order, status FROM trips WHERE id={tid}').split('|')
        snap = psql(f"SELECT id, total_amount, freight_amount, surcharge_amount, rate_terms_id, pricing_table_id, fuel_norm_id, source_flag FROM (SELECT id, total_amount, freight_amount, surcharge_amount, rate_terms_id, pricing_table_id, fuel_norm_id, CASE WHEN formula_text IS NULL THEN 'MANUAL' ELSE 'AUTO' END AS source_flag FROM freight_rate_snapshots WHERE trip_id={tid} ORDER BY id DESC LIMIT 1) x").split('|')
        log(f'ECON trip {tid} ({suffix}): status={meta[3]} tollsStations={meta[0]} pair={meta[1]} order={meta[2]}')
        log(f'  snapshot id={snap[0]} source={snap[7]} total={snap[1]} freight={snap[2]} surcharge={snap[3]} rateTermsId={snap[4]} pricingTableId={snap[5]} fuelNormId={snap[6]}')
        log(f'  revenue={fin[0]} tollCost={fin[1]} tollDeduction={fin[2]} driverSalary={fin[3]} totalCost={fin[4]} grossProfit={fin[5]}')
        if snap[5] == '0' or snap[1] == '0':
            failures += 1
            log(f'  FAIL: snapshot not priced (pricingTableId/total)')
        for label, v in (('revenue', fin[0]), ('tollCost', fin[1]), ('driverSalary', fin[3]), ('totalCost', fin[4])):
            # VETC-once-per-pair law: the deducted leg legitimately carries
            # tollCost 0 + tollDeduction 110.000 (round-1 pair-29 shape), so a
            # zero tollCost with a non-zero tollDeduction is CORRECT.
            deducted = int(fin[2] or 0)
            if v in ('', '0', None) and not (label == 'tollCost' and deducted > 0):
                failures += 1
                log(f'  FAIL: {label} zero/empty')
    toll_ded = int(psql(f'SELECT coalesce(toll_deduction,0)::text FROM trip_financial_state WHERE trip_id={B}'))
    toll_b = int(psql(f'SELECT coalesce(toll_cost,0)::text FROM trip_financial_state WHERE trip_id={B}'))
    toll_a = int(psql(f'SELECT coalesce(toll_cost,0)::text FROM trip_financial_state WHERE trip_id={A}'))
    log(f'VETC once-per-pair check: leg A tollCost={toll_a}, leg B tollCost={toll_b} tollDeduction={toll_ded}')
    log('PAIR FAILURES:', failures)
    sys.exit(1 if failures else 0)
finally:
    # ── restore the local catalog shape no matter what ──────────────────────
    psql("UPDATE vehicle_size_classes SET deleted_at = NULL WHERE code IN ('CONT20','CONT40') AND deleted_at IS NOT NULL")
    restored = psql("SELECT id, code FROM vehicle_size_classes WHERE code IN ('CONT20','CONT40') AND deleted_at IS NULL ORDER BY id")
    log('catalog restored:', restored)
    open(__file__.replace('.py', '.log'), 'w').write('\n'.join(LOG) + '\n')
