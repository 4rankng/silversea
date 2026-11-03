#!/usr/bin/env python3
# SIL-676 QA probe: which driver-portal calls 403 for tdtrung?
import json, urllib.request, urllib.error, uuid

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

st, j = call('POST', '/auth/login', body={'identifier': 'tdtrung', 'password': 'Abc123'})
tok = j['token']
print('login', st, j.get('user', {}).get('role'))
for m, p in [('GET', '/driver/me/trips'), ('GET', '/driver/me/fulfillments/1461/pod'),
             ('POST', '/fulfillments/1461/complete')]:
    st, out = call(m, f'/driver/me{p}' if not p.startswith('/driver') else p, tok,
                   {'expectedVersion': 1} if m == 'POST' else None)
    print(m, p, '->', st, json.dumps(out)[:160])
