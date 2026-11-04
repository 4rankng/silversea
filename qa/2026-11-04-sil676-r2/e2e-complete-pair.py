#!/usr/bin/env python3
# SIL-676 E2E — complete a dispatched+paired KEP pair end-to-end.
# Usage: python3 e2e-complete-pair.py TRIP_A TRIP_B
# Drives (on the FIXED backend :3102): user-shipment link for the OPS account,
# OPS expense-completion scopes, IN_TRANSIT transition, driver e-POD
# (create/attach/submit), ORDER_RECEIVED milestone, driver full-close,
# accountant actuals save, then prints the pair economics.
import json, subprocess, sys, urllib.request, urllib.error, uuid, struct, zlib
from datetime import datetime, timezone

BASE = 'http://localhost:3102/api'
TRIP_A, TRIP_B = int(sys.argv[1]), int(sys.argv[2])

def call(method, path, token=None, body=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4()),
                 **({'Authorization': f'Bearer {token}'} if token else {})})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

def psql(sql):
    out = subprocess.run(['docker', 'exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea',
                          '-At', '-c', sql], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f'psql failed: {out.stderr}')
    return out.stdout.strip()

def multipart(path, token, fields, filename, content):
    boundary = '----sil676qa' + uuid.uuid4().hex[:8]
    parts = b''
    for name, value in fields.items():
        parts += (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n').encode()
    parts += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
              f'Content-Type: image/png\r\n\r\n').encode() + content + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(BASE + path, method='POST', data=parts,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}',
                 'Idempotency-Key': str(uuid.uuid4()), 'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

def png_bytes():
    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00'))
    return b'\x89PNG\r\n\x1a\n' + ihdr + idat + chunk(b'IEND', b'')

def login(u):
    st, j = call('POST', '/auth/login', body={'identifier': u, 'password': 'Abc123'})
    assert st == 200, f'login {u} {st}'
    return j['token']

tok, tok_close, tok_driver, tok_ops = login('admin'), login('ketoan'), login('nvquynh'), login('giaonhan')

for tid in (TRIP_A, TRIP_B):
    ship = int(psql(f'SELECT shipment_id FROM trips WHERE id={tid}'))
    psql(f'INSERT INTO user_shipment_links (user_id, shipment_id) SELECT 151, {ship} WHERE NOT EXISTS (SELECT 1 FROM user_shipment_links WHERE user_id=151 AND shipment_id={ship})')
    for tcid in [None] + [int(x) for x in psql(f'SELECT id FROM trip_containers WHERE trip_id={tid}').split() if x]:
        st, out = call('PUT', f'/forwarder/me/trips/{tid}/expense-completion', tok_ops,
                       {'tripContainerId': tcid, 'completed': True})
        assert st == 200, f'scope {tid}/{tcid} {st} {out}'
    st, disp = call('POST', f'/trips/{tid}/dispatch', tok, {'expectedVersion': int(psql(f'SELECT version FROM trips WHERE id={tid}'))})
    assert st in (200, 201, 409), f'in-transit {tid} {st} {disp}'
    fid = int(psql(f'SELECT fulfillment_id FROM trips WHERE id={tid}'))
    st, sub = call('POST', f'/driver/me/fulfillments/{fid}/pod', tok_driver,
                   {'expectedVersion': int(psql(f'SELECT version FROM trips WHERE id={tid}'))})
    assert st in (200, 201, 409), f'pod create {tid} {st} {sub}'
    sid = int(psql(f'SELECT id FROM trip_pod_submissions WHERE fulfillment_id={fid} ORDER BY id DESC LIMIT 1'))
    st, up = multipart(f'/driver/me/fulfillments/{fid}/pod/{sid}/files', tok_driver,
                       {'expectedVersion': str(psql(f'SELECT version FROM trip_pod_submissions WHERE id={sid}')),
                        'fileType': 'SIGNED_DELIVERY_NOTE'}, 'pod.png', png_bytes())
    assert st in (200, 201), f'pod attach {tid} {st} {up}'
    st, done = call('POST', f'/driver/me/fulfillments/{fid}/pod/{sid}/submit', tok_driver,
                    {'expectedVersion': int(psql(f'SELECT version FROM trip_pod_submissions WHERE id={sid}'))})
    assert st in (200, 201), f'pod submit {tid} {st} {done}'
    st, prog = call('POST', f'/driver/me/trips/{tid}/progress', tok_driver,
                    {'eventType': 'ORDER_RECEIVED',
                     'occurredAt': datetime.now(timezone.utc).isoformat(), 'note': 'SIL-676 QA'})
    assert st in (200, 201, 409), f'progress {tid} {st} {prog}'
    st, comp = call('POST', f'/driver/me/fulfillments/{fid}/complete', tok_driver,
                    {'expectedVersion': int(psql(f'SELECT version FROM trips WHERE id={tid}'))})
    assert st in (200, 201), f'driver close {tid} {st} {comp}'
    st, act = call('PUT', f'/trips/{tid}/actuals', tok_close,
                   {'version': int(psql(f'SELECT version FROM trips WHERE id={tid}')), 'legs': [], 'fuelMode': 'AUTO'})
    assert st in (200, 201), f'actuals {tid} {st} {json.dumps(act)[:300]}'
    row = psql(f"SELECT revenue::text, toll_cost::text, toll_deduction::text, driver_salary::text, total_cost::text "
               f"FROM trip_financial_state WHERE trip_id={tid}").split('|')
    meta = psql(f'SELECT tolls_stations, active_trip_pair_id, active_trip_pair_order, status FROM trips WHERE id={tid}').split('|')
    snap = psql(f'SELECT total_amount, rate_terms_id, pricing_table_id FROM freight_rate_snapshots WHERE trip_id={tid} ORDER BY id DESC LIMIT 1')
    print(f'ECON trip {tid}: tollsStations={meta[0]} pair={meta[1]} order={meta[2]} status={meta[3]}')
    print(f'      snapshot(total/rateTerms/pricingTable)={snap}')
    print(f'      revenue={row[0]} tollCost={row[1]} tollDeduction={row[2]} driverSalary={row[3]} totalCost={row[4]}')
print('PAIR COMPLETE DONE')
