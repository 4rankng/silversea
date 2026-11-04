#!/usr/bin/env python3
# Wave 7 BEFORE dump — reads the pair completed on the PRE-FIX build
# (merge-base e92f508b code served from this worktree on :3103).
# Usage: python3 before-dump-oldbuild.py
import json, subprocess, urllib.request, urllib.error

BASE = 'http://localhost:3103/api'
OUT = __file__.replace('.py', '.log')
A, B = 1310, 1311  # pair 34 legs completed on the pre-fix build

def call(method, path, token=None):
    req = urllib.request.Request(BASE + path, method=method,
        headers={**({'Authorization': f'Bearer {token}'} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}')
        except Exception:
            return e.code, {}

def psql(sql):
    out = subprocess.run(['docker','exec','ss-prod-db','psql','-U','postgres','-d','silversea','-At','-c',sql],
                         capture_output=True, text=True)
    return out.stdout.strip()

lines = []
def log(*p):
    lines.append(' '.join(map(str, p))); print(*p)

req = urllib.request.Request(BASE + '/auth/login', method='POST',
    data=json.dumps({'identifier': 'admin', 'password': 'Abc123'}).encode(),
    headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(req, timeout=30) as r:
    tok = json.loads(r.read())['token']

for tid in (A, B):
    fin = psql(f"SELECT coalesce(revenue,0)::text, coalesce(toll_cost,0)::text, coalesce(toll_deduction,0)::text, coalesce(driver_salary::text,'NULL'), coalesce(total_cost::text,'NULL') FROM trip_financial_state WHERE trip_id={tid}")
    meta = psql(f"SELECT status, active_trip_pair_id, active_trip_pair_order, tolls_stations FROM trips WHERE id={tid}")
    log(f'BEFORE trip {tid}: {meta} fin[revenue,toll,tollDed,salary,totalCost]={fin}')
log('pair 34:', psql("SELECT id, pair_kind, status, first_trip_id, second_trip_id FROM trip_pairs WHERE id=34"))
ledger_a = psql(f"SELECT count(*) FROM ledger WHERE txn_type='DRIVER_SALARY' AND txn_id={A} AND entity_type='DRIVER'")
ledger_b = psql(f"SELECT count(*) FROM ledger WHERE txn_type='DRIVER_SALARY' AND txn_id={B} AND entity_type='DRIVER'")
log(f'ledger DRIVER_SALARY entries: legA={ledger_a} legB={ledger_b}')
st, t = call('GET', f'/trips/{A}', tok)
log(f'GET /api/trips/{A} -> {st}; has costBreakdown key: {"costBreakdown" in t}; value={json.dumps(t.get("costBreakdown"))}')
st, s = call('GET', '/settlements', tok)
pairrows = [i for i in s.get('items', []) if i.get('source') == 'TRIP_PAIR']
log(f'GET /api/settlements -> {st}; items={len(s.get("items", []))}; TRIP_PAIR rows={len(pairrows)}')
with open(OUT, 'w') as f:
    f.write('\n'.join(lines) + '\n')
print('written', OUT)
