#!/usr/bin/env python3
# SIL-676 R2 — BEFORE evidence from STAGING (vantai.tingting.vip, build 386477c2):
# GET /api/settlements as admin + the QA trio (dungnv DISPATCHER, tiepvv CUS,
# bqhuong DRIVER) — round-3c's complaint is all-403-including-admin.
# Read-only: logins + GETs only. Accounts/passwords from testplan/testaccounts.txt
# (staging rule: every staging account uses Abc123).
import json, ssl, sys, urllib.request, urllib.error

BASE = 'https://vantai.tingting.vip/api'
CTX = ssl.create_default_context()

def call(method, path, token=None, body=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json',
                 **({'Authorization': f'Bearer {token}'} if token else {})})
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=20) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}')
        except Exception:
            return e.code, {}

ACCOUNTS = [('admin', 'ADMIN'), ('dungnv', 'DISPATCHER'), ('tiepvv', 'CUS'), ('bqhuong', 'DRIVER')]
rows = []
for user, role in ACCOUNTS:
    st, j = call('POST', '/auth/login', body={'identifier': user, 'password': 'Abc123'})
    if st != 200:
        rows.append(f'{user:8s} {role:11s} login={st}')
        continue
    tok = j.get('token')
    me_role = j.get('user', {}).get('role', '?')
    st, body = call('GET', '/settlements', tok)
    body_s = json.dumps(body)[:60]
    rows.append(f'{user:8s} {role:11s} actual_role={me_role:11s} GET /api/settlements -> {st} {body_s}')
    st2, body2 = call('GET', '/ops/settlements', tok)
    rows.append(f'{user:8s} {"":11s} GET /api/ops/settlements -> {st2} {json.dumps(body2)[:60]}')

print('SIL-676 R2 BEFORE (staging vantai.tingting.vip):')
for r in rows:
    print(' ', r)
