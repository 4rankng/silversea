#!/usr/bin/env python3
# SIL-676 R2 — driver earnings surface (round-1's accepted CHECK: /my-earnings
# shows the pair salary). Driver nvquynh closed pair 32 legs 1271 (salary
# 192.308) + 1272 (200.000).
import json, urllib.request, urllib.error, uuid

BASE = 'http://localhost:3102/api'

def call(method, path, token=None, body=None):
    import uuid as _uuid
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', 'Idempotency-Key': str(_uuid.uuid4()),
                 **({'Authorization': f'Bearer {token}'} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}')
        except Exception:
            return e.code, {}

st, j = call('POST', '/auth/login', None, {'identifier': 'nvquynh', 'password': 'Abc123'})
tok = j['token']
st, e = call('GET', '/driver/me/earnings?month=11&year=2026', tok)
print(f'GET /api/driver/me/earnings -> {st} {json.dumps(e)[:400]}')
st, p = call('GET', '/driver/me/payslips', tok)
print(f'GET /api/driver/me/payslips -> {st} {json.dumps(p)[:400]}')
