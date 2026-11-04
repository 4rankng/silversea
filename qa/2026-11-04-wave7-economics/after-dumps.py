#!/usr/bin/env python3
# Wave 7 — AFTER evidence dumps for pair 36 (trips 1321/1322, completed on the
# fix/sil-wave7-economics build :3102, no actuals save):
#   ledger-dump (DRIVER_SALARY postings), snapshot-dump (freight_rate_snapshots),
#   settlements-dump (GET /api/settlements admin read incl. OS-PAIR rows).
import json, subprocess, urllib.request

BASE = 'http://localhost:3102/api'
OUT = __file__.rsplit('/', 1)[0]
PAIR, A, B = 36, 1321, 1322

def psql(sql):
    out = subprocess.run(['docker','exec','ss-prod-db','psql','-U','postgres','-d','silversea','-At','-c',sql],
                         capture_output=True, text=True)
    return out.stdout.strip()

req = urllib.request.Request(BASE + '/auth/login', method='POST',
    data=json.dumps({'identifier': 'admin', 'password': 'Abc123'}).encode(),
    headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(req, timeout=30) as r:
    tok = json.loads(r.read())['token']

req = urllib.request.Request(BASE + '/settlements', headers={'Authorization': f'Bearer {tok}'})
with urllib.request.urlopen(req, timeout=30) as r:
    items = json.loads(r.read())['items']

lines = []
lines.append(f'# Wave7 AFTER dumps — pair {PAIR} (legs {A}/{B}), build fix/sil-wave7-economics :3102, {len(items)} settlements items')
lines.append('')
lines.append('## ledger DRIVER_SALARY postings (once per completed leg)')
for tid in (A, B):
    rows = psql(f"SELECT txn_type, txn_id, entity_type, entity_id, credit::text, debit::text, note FROM ledger WHERE txn_type='DRIVER_SALARY' AND txn_id={tid} AND entity_type='DRIVER'")
    lines.append(f'trip {tid}: {rows}')
lines.append('')
lines.append('## ledger full posting set (leg A)')
lines.append(psql(f"SELECT txn_type, entity_type, credit::text, debit::text FROM ledger WHERE txn_id={A} ORDER BY id"))
lines.append('')
lines.append('## freight_rate_snapshots (leg A latest)')
lines.append(psql(f"SELECT id, freight_amount, surcharge_amount, total_amount, rate_terms_id, pricing_table_id, fuel_norm_id, he_so, coalesce(formula_text,'') FROM freight_rate_snapshots WHERE trip_id={A} ORDER BY id DESC LIMIT 1"))
lines.append('')
lines.append('## trip_financial_state (both legs)')
for tid in (A, B):
    lines.append(f'trip {tid}: ' + psql(f"SELECT revenue::text, toll_cost::text, toll_deduction::text, driver_salary::text, trip_wage_days::text, total_cost::text, gross_profit::text FROM trip_financial_state WHERE trip_id={tid}"))
lines.append('')
lines.append('## GET /api/settlements (admin) — batch + TRIP_PAIR rows')
for item in items:
    if item.get('source') == 'TRIP_PAIR':
        lines.append(json.dumps(item, ensure_ascii=False))
    else:
        lines.append(json.dumps({k: item.get(k) for k in ('id', 'code', 'status', 'totalAmount', 'opsUserName', 'source')}, ensure_ascii=False))

with open(f'{OUT}/after-dumps-ledger-snapshot-settlements.log', 'w') as f:
    f.write('\n'.join(lines) + '\n')
print('\n'.join(lines[:24]))
print('written', f'{OUT}/after-dumps-ledger-snapshot-settlements.log')
