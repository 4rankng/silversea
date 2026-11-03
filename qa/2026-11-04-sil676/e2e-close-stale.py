#!/usr/bin/env python3
# SIL-676 local QA housekeeping: close the stale 09/2026 BULK fixture trip 6
# (IN_TRANSIT since September on truck 18) so the rig is free for the KEP-pair
# E2E. Accountant token: POST /trips/:id/complete is an ACCOUNTANT/CUS
# exclusive authz grant (backend/src/middleware/authz-grants.ts).
import json, urllib.request, urllib.error, uuid, subprocess

def call(method, path, token=None, body=None):
    req = urllib.request.Request('http://localhost:3102/api' + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4()),
                 **({'Authorization': f'Bearer {token}'} if token else {})})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

st, j = call('POST', '/auth/login', body={'identifier': 'admin', 'password': 'Abc123'})
assert st == 200, f'login {st}'
tok = j['token']
ver = int(subprocess.run(['docker', 'exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea',
                          '-At', '-c', 'select version from trips where id=6'],
                         capture_output=True, text=True).stdout.strip())
st, out = call('POST', '/trips/6/cancel', tok, {
    'expectedVersion': ver,
    'reason': 'SIL-676 local QA: huy cuoc BULK cu 09/2026 treo IN_TRANSIT de giai phong xe 18 cho test cap Kep',
})
print(st, json.dumps(out)[:200])
