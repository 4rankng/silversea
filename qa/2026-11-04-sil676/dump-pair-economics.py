#!/usr/bin/env python3
# SIL-676 QA evidence dump — reads the completed pair 29 (trips 858/859)
# economics from trip_financial_state + the frozen snapshots. Read-only.
import subprocess

def psql(sql):
    out = subprocess.run(['docker', 'exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea',
                          '-At', '-c', sql], capture_output=True, text=True)
    return out.stdout.strip()

lines = []
lines.append('SIL-676 local E2E pair economics — pair 29 (KEP), trips 858/859, 2026-11-04')
lines.append('Backend under test: :3102 (fixed worktree build). Snapshot money law:')
lines.append('  freight = pricing_tables 33 (CONT20 3.800.000) x (1 + sharePct 4.00 of freight_rate_terms 1)')
for tid in (858, 859):
    row = psql(f"SELECT t.trip_code, t.status, t.tolls_stations, "
               f"f.revenue::text, f.toll_cost::text, f.toll_deduction::text, f.driver_salary::text, f.total_cost::text "
               f"FROM trips t JOIN trip_financial_state f ON f.trip_id = t.id WHERE t.id = {tid}").split('|')
    snap = psql(f'SELECT total_amount, rate_terms_id, pricing_table_id, share_pct FROM freight_rate_snapshots WHERE trip_id={tid} ORDER BY id DESC LIMIT 1').split('|')
    pair = psql(f'SELECT pair_kind, status FROM trip_pairs WHERE id = (SELECT active_trip_pair_id FROM trips WHERE id={tid})')
    lines.append(f'trip {tid} ({row[0]}): status={row[1]} tolls_stations={row[2]} pair={pair}')
    lines.append(f'  snapshot: total={snap[0]} rate_terms_id={snap[1]} pricing_table_id={snap[2]} share_pct={snap[3]}')
    lines.append(f'  financial_state: revenue(override slot)={row[3]} toll_cost={row[4]} toll_deduction={row[5]} driver_salary={row[6]} total_cost={row[7]}')
out = '\n'.join(lines) + '\n'
open('qa/2026-11-04-sil676/e2e-pair29-economics.txt', 'w').write(out)
print(out)
