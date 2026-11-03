#!/usr/bin/env python3
# SIL-676 E2E final mile: fresh-version reads -> IN_TRANSIT -> driver close -> actuals.
import json, subprocess, urllib.request, urllib.error, uuid

BASE = 'http://localhost:3102/api'

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

def login(u):
    st, j = call('POST', '/auth/login', body={'identifier': u, 'password': 'Abc123'})
    assert st == 200, f'login {u} {st}'
    return j['token']

tok, tok_close, tok_driver = login('admin'), login('ketoan'), login('tdtrung')

for tid, fid in ((856, 1461), (857, 1462)):
    status = psql(f'SELECT status FROM trips WHERE id={tid}')
    if status != 'IN_TRANSIT':
        tv = int(psql(f'SELECT version FROM trips WHERE id={tid}'))
        st, disp = call('POST', f'/trips/{tid}/dispatch', tok, {'expectedVersion': tv})
        print(f'trip {tid} in-transit -> {st} {json.dumps(disp)[:120]}')
    # explicit ORDER_RECEIVED milestone — never auto-recorded on close
    tv = int(psql(f'SELECT version FROM trips WHERE id={tid}'))
    st, prog = call('POST', f'/driver/me/trips/{tid}/progress', tok_driver,
                    {'eventType': 'ORDER_RECEIVED', 'occurredAt': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(), 'note': 'SIL-676 QA'})
    print(f'trip {tid} order-received -> {st} {json.dumps(prog)[:120]}')
    tv = int(psql(f'SELECT version FROM trips WHERE id={tid}'))
    st, comp = call('POST', f'/driver/me/fulfillments/{fid}/complete', tok_driver, {'expectedVersion': tv})
    print(f'trip {tid} driver close -> {st} {json.dumps(comp)[:200]}')
    tv = int(psql(f'SELECT version FROM trips WHERE id={tid}'))
    st, act = call('PUT', f'/trips/{tid}/actuals', tok_close, {'version': tv, 'legs': [], 'fuelMode': 'AUTO'})
    print(f'trip {tid} actuals -> {st} {json.dumps(act)[:160]}')

for tid in (856, 857):
    row = psql(f"SELECT revenue::text, toll_cost::text, driver_salary::text, total_cost::text, toll_deduction::text "
               f"FROM trip_financial_state WHERE trip_id={tid}").split('|')
    meta = psql(f"SELECT active_trip_pair_id, active_trip_pair_order, status FROM trips WHERE id={tid}").split('|')
    print(f'ECON trip {tid}: revenue={row[0]} tollCost={row[1]} tollsDiscount={row[4]} driverSalary={row[2]} '
          f'totalCost={row[3]} tollDeduction={row[4]} pair={meta[0]} order={meta[1]} status={meta[2]}')
print('FINAL MILE DONE')
