#!/usr/bin/env python3
# SIL-676 R2 — round-1 pin: the pricing lookup must keep returning the sheet
# price (3.800.000) on the fixed build, catalog shaped either way.
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

st, j = call('POST', '/auth/login', body={'identifier': 'admin', 'password': 'Abc123'})
assert st == 200, f'login {st}'
tok = j['token']
variants = [
    '/pricing?customerId=1&routeId=6',
    '/pricing?customerId=1&routeId=6&pricingRateKey=CONT20',
    '/pricing?customerId=1&routeId=6&pricingRateKey=CONT40',
]
for v in variants:
    st, body = call('GET', v, tok)
    print(f'GET {v} -> {st} {json.dumps(body)}')
