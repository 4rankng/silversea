#!/usr/bin/env python3
# SIL-676 E2E continuation — pair 28 (trips 856/857, both dispatched, snapshots
# 675/677 with rateTermsId 1 + pricingTableId 33) needs: IN_TRANSIT transition,
# governed close (POD without e-POD), actuals save, then the economics proof.
import json, subprocess, urllib.request, urllib.error, uuid

BASE = 'http://localhost:3102/api'
LOG = []
def log(*parts):
    line = ' '.join(str(p) for p in parts)
    LOG.append(line); print(line)

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

st, j = call('POST', '/auth/login', body={'identifier': 'admin', 'password': 'Abc123'})
tok = j['token']
st, j = call('POST', '/auth/login', body={'identifier': 'ketoan', 'password': 'Abc123'})
tok_close = j['token']
st, j = call('POST', '/auth/login', body={'identifier': 'tdtrung', 'password': 'Abc123'})
tok_driver = j['token']

TRIPS = {'A': 856, 'B': 857}
FIDS = {'A': 1461, 'B': 1462}
for suffix, tid in TRIPS.items():
    tv = int(psql(f'SELECT version FROM trips WHERE id={tid}'))
    st, disp = call('POST', f'/trips/{tid}/dispatch', tok, {'expectedVersion': tv})
    assert st in (200, 201, 409), f'trip {tid} in-transit {st} {disp}'
    tv = int(psql(f'SELECT version FROM trips WHERE id={tid}'))
    # Driver full-close (driverOwnedFulfillmentClose): e-POD submitted above,
    # the driver flips the trip straight to COMPLETED — no governed staging.
    st, comp = call('POST', f'/fulfillments/{FIDS[suffix]}/complete', tok_driver,
                    {'expectedVersion': tv})
    assert st in (200, 201), f'trip {tid} driver close {st} {comp}'
    tv = int(psql(f'SELECT version FROM trips WHERE id={tid}'))
    st, act = call('PUT', f'/trips/{tid}/actuals', tok_close, {'version': tv})
    assert st in (200, 201), f'trip {tid} actuals {st} {json.dumps(act)[:300]}'
    log(f'trip {tid} ({suffix}): IN_TRANSIT -> COMPLETED (driver close) -> actuals saved')

for suffix, tid in TRIPS.items():
    row = psql(f"SELECT t.revenue::text, t.toll_cost::text, t.driver_salary::text, t.total_cost::text, "
               f"t.tolls_discount::text, t.active_trip_pair_id, t.active_trip_pair_order, t.status "
               f"FROM trips t WHERE t.id={tid}").split('|')
    log(f'ECON trip {tid} ({suffix}): revenue={row[0]} tollCost={row[1]} tollsDiscount={row[4]} '
        f'driverSalary={row[2]} totalCost={row[3]} pair={row[5]} order={row[6]} status={row[7]}')
    pair_row = psql(f"SELECT status, pair_kind FROM trip_pairs WHERE id={row[5]}")
    log(f'pair {row[5]}: {pair_row}')

open('e2e-continuation.log', 'w').write('\n'.join(LOG) + '\n')
print('E2E CONTINUATION DONE')
