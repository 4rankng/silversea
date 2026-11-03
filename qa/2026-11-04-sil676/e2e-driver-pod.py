#!/usr/bin/env python3
# SIL-676 E2E: drive the DRIVER e-POD flow for trips 856/857 (fulfillments
# 1461/1462, driver 39 = user tdtrung) so the governed close passes its valid
# e-POD gate. multipart file attach rides POD files route.
import json, subprocess, urllib.request, urllib.error, uuid, struct, zlib

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

def multipart(path, token, fields, filename, content):
    boundary = '----sil676qa' + uuid.uuid4().hex[:8]
    parts = b''
    for name, value in fields.items():
        parts += (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n').encode()
    parts += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
              f'Content-Type: image/png\r\n\r\n').encode() + content + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(BASE + path, method='POST', data=parts,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}',
                 'Idempotency-Key': str(uuid.uuid4()), 'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

def png_bytes():
    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00'))
    return b'\x89PNG\r\n\x1a\n' + ihdr + idat + chunk(b'IEND', b'')

def psql(sql):
    out = subprocess.run(['docker', 'exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea',
                          '-At', '-c', sql], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f'psql failed: {out.stderr}')
    return out.stdout.strip()

st, j = call('POST', '/auth/login', body={'identifier': 'tdtrung', 'password': 'Abc123'})
print('driver login', st)
assert st == 200, f'driver login {st} {j}'
tok = j['token']

for tid, fid in ((856, 1461), (857, 1462)):
    tver = int(psql(f'SELECT version FROM trips WHERE id={tid}'))
    st, sub = call('POST', f'/driver/me/fulfillments/{fid}/pod', tok, {'expectedVersion': tver})
    assert st in (200, 201, 409), f'pod create {st} {sub}'
    if st == 409:
        # an open DRAFT exists — reuse it
        sid = int(psql(f"SELECT id FROM trip_pod_submissions WHERE fulfillment_id={fid} ORDER BY id DESC LIMIT 1"))
        print(f'pod reuse open submission {sid}')
    else:
        sid = (sub.get('submission') or sub)['id']
    sver = int(psql(f'SELECT version FROM trip_pod_submissions WHERE id={sid}'))
    st, up = multipart(f'/driver/me/fulfillments/{fid}/pod/{sid}/files', tok, {'expectedVersion': str(sver), 'fileType': 'SIGNED_DELIVERY_NOTE'}, 'pod.png', png_bytes())
    assert st in (200, 201), f'pod file attach {st} {up}'
    sver = int(psql(f'SELECT version FROM trip_pod_submissions WHERE id={sid}'))
    st, done = call('POST', f'/driver/me/fulfillments/{fid}/pod/{sid}/submit', tok, {'expectedVersion': sver})
    assert st in (200, 201), f'pod submit {st} {done}'
    print(f'fulfillment {fid} (trip {tid}): e-POD {sid} submitted ({st})')
print('POD DONE')
