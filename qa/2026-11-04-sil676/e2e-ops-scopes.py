#!/usr/bin/env python3
# SIL-676 E2E: OPS (giaonhan) confirms the expense-declaration completion
# scopes (general + each trip container) for trips 856/857 — the last gate
# before the governed close (trip-close-readiness.service).
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

st, j = call('POST', '/auth/login', body={'identifier': 'giaonhan', 'password': 'Abc123'})
print('ops login', st)
assert st == 200, f'ops login {st} {j}'
tok = j['token']

for tid in (856, 857):
    container_ids = [int(x) for x in psql(f'SELECT id FROM trip_containers WHERE trip_id={tid}').split()] if psql(f'SELECT count(*) FROM trip_containers WHERE trip_id={tid}') else []
    for tcid in [None] + container_ids:
        st, out = call('PUT', f'/forwarder/me/trips/{tid}/expense-completion', tok,
                       {'tripContainerId': tcid, 'completed': True})
        print(f'trip {tid} scope tripContainerId={tcid}: {st} {json.dumps(out)[:120]}')
print('OPS SCOPES DONE')
