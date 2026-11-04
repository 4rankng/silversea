#!/usr/bin/env python3
# SIL-676 R2 — driver cost surface (QA round-3c CHECK 4: driver detail of
# COMPLETED trips must not show "Chi phí 0"). Reads the driver trip detail for
# pair 32's completed legs (1271/1272, driver nvquynh) and the trip composite
# the ops/accounting surfaces read.
import json, urllib.request, urllib.error, uuid

BASE = 'http://localhost:3102/api'

def call(method, path, token=None, body=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4()),
                 **({'Authorization': f'Bearer {token}'} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}')
        except Exception:
            return e.code, {}

def login(u):
    st, j = call('POST', '/auth/login', body={'identifier': u, 'password': 'Abc123'})
    assert st == 200, f'login {u} {st}'
    return j['token']

tok_driver = login('nvquynh')
st, trips = call('GET', '/driver/me/trips', tok_driver)
print(f'GET /driver/me/trips -> {st}')
items = trips.get('items', []) if isinstance(trips, dict) else []
for tid in (1271, 1272):
    match = [t for t in items if t.get('id') == tid]
    if match:
        t = match[0]
        print(f"  driver trip {tid}: status={t.get('status')} totalCost={t.get('totalCost')} driverSalary={t.get('driverSalary')} tollCost={t.get('tollCost')} keys={sorted(k for k in t.keys() if 'ost' in k or 'alary' in k or 'oll' in k)}")
    else:
        print(f'  driver trip {tid}: NOT in list (list len={len(items)})')

st, detail = call('GET', f'/driver/me/trips/1271', tok_driver)
print(f'GET /driver/me/trips/1271 -> {st}')
if st == 200:
    t = detail.get('trip', detail)
    print(f"  detail: status={t.get('status')} totalCost={t.get('totalCost')} driverSalary={t.get('driverSalary')} tollCost={t.get('tollCost')}")

tok_admin = login('admin')
st, comp = call('GET', '/trips/1271', tok_admin)
print(f'GET /api/trips/1271 -> {st}')
if st == 200:
    t = comp.get('trip', comp)
    print(f"  composite: revenue={t.get('revenue')} totalCost={t.get('totalCost')} driverSalary={t.get('driverSalary')} tollCost={t.get('tollCost')} costBreakdown={json.dumps(t.get('costBreakdown'))[:120]}")
