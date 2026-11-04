#!/usr/bin/env python3
# SIL-676 R2 AFTER — GET /api/settlements role matrix against the FIXED local
# build :3102. Expected (each half mirrors an existing endpoint's policy):
#   ADMIN     -> 200 full office list (the /api/ops/admin/settlements policy)
#   OPS       -> 200 self-scoped  (the /api/ops/settlements policy)
#   DISPATCHER/CUS/DRIVER -> 403 (kept from /api/ops/settlements)
# Canonical /api/ops/settlements must stay OPS-only (admin 403 there is the
# unchanged policy; admin's read lives on the admin view).
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

ACCOUNTS = [
    ('admin', 'ADMIN', 200),
    ('giaonhan', 'OPS', 200),
    ('dungnv', 'DISPATCHER', 403),
    ('tiepvv', 'CUS', 403),
    ('bqhuong', 'DRIVER', 403),
]
failures = 0
print('SIL-676 R2 AFTER (local build :3102):')
for user, role, expect in ACCOUNTS:
    st, j = call('POST', '/auth/login', body={'identifier': user, 'password': 'Abc123'})
    assert st == 200, f'login {user} {st}'
    tok = j['token']
    st, body = call('GET', '/settlements', tok)
    ok = 'PASS' if st == expect else 'FAIL'
    if st != expect:
        failures += 1
    items = body.get('items')
    n = len(items) if isinstance(items, list) else None
    print(f'  [{ok}] {user:8s} {role:11s} GET /api/settlements -> {st} (expect {expect}) items={n}')
    if st == 200 and n is not None:
        # OPS self-scoping proof: every returned row belongs to this ops user.
        mine = j.get('user', {}).get('id')
        scoped = all(row.get('opsUserId') == mine for row in items)
        print(f'         self-scoped rows only: {scoped}')

print('canonical /api/ops/settlements (policy unchanged):')
for user, role, expect in [('giaonhan', 'OPS', 200), ('admin', 'ADMIN', 403)]:
    st, j = call('POST', '/auth/login', body={'identifier': user, 'password': 'Abc123'})
    st, body = call('GET', '/ops/settlements', j['token'])
    ok = 'PASS' if st == expect else 'FAIL'
    if st != expect:
        failures += 1
    print(f'  [{ok}] {user:8s} {role:11s} GET /api/ops/settlements -> {st} (expect {expect})')

print('MATRIX FAILURES:', failures)
raise SystemExit(1 if failures else 0)
