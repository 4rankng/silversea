/**
 * Card 081026212500 + 071026212510 — create ONE driver-owned draft e-POD with a
 * file, so the driver screen can finally be rendered and screenshotted.
 *
 * Why this exists: staging had three DRAFT e-POD submissions, but every one of
 * them belonged to a user whose role is ACCOUNTANT, not DRIVER. No DRIVER
 * account owned a draft with a file, so /my-trips/:id/pod could not be opened
 * at all — which is what blocked the badge card for two days. Rather than
 * promoting someone's role (a permissions change on shared data), seed a fresh
 * submission under a driver account that owns a trip.
 *
 * The file carries a unique marker so it is identifiable and removable. It
 * touches only rows this script created; it does not mutate another lane's
 * fixture.
 */
import { execFileSync } from 'node:child_process';

const B = 'https://vantai.tingting.vip/api';
const DRIVER = process.argv[2] || 'lvlo';
const TRIP_ID = Number(process.argv[3] || 126);
const MARKER = `QA-MINIMAX-212510-${Date.now()}`;

function api(method, path, { body, token, idempotencyKey, form } = {}) {
  const args = ['curl', '-s', '--max-time', '40', '-X', method, B + path];
  if (token) args.push('-H', `Authorization: Bearer ${token}`);
  if (idempotencyKey) args.push('-H', `Idempotency-Key: ${idempotencyKey}`);
  if (body) args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(body));
  if (form) {
    // Each field needs its own -F; one '-F a=1 -F b=2' packed into a single arg
    // is silently read by curl as a single malformed field.
    for (const f of form.fields || []) args.push('-F', f);
    args.push('-F', `file=@${form.file}`);
  }
  const out = execFileSync(args[0], args.slice(1), { encoding: 'utf8' });
  return out;
}

const login = JSON.parse(api('POST', '/auth/login', { body: { identifier: DRIVER, password: 'Abc123' } }));
const token = login.token;
if (!token) { console.error('login failed'); process.exit(2); }
console.log(`driver=${DRIVER} role=${(login.user || {}).role}`);

// The driver trip summary carries no version; the fulfillment detail carries
// `tripVersion`, and that is what the app sends as expectedVersion.
const trip = JSON.parse(api('GET', `/driver/me/trips/${TRIP_ID}`, { token }));
const fulfillmentId = trip.fulfillmentId;
if (!fulfillmentId) { console.error('trip has no fulfillmentId', JSON.stringify(trip).slice(0, 200)); process.exit(2); }
const detail = JSON.parse(api('GET', `/driver/me/fulfillments/${fulfillmentId}`, { token }));
const tripVersion = detail.tripVersion;
if (!Number.isInteger(tripVersion)) {
  console.error('no tripVersion on the fulfillment detail:', JSON.stringify(detail).slice(0, 200));
  process.exit(2);
}
console.log(`trip=${TRIP_ID} fulfillmentId=${fulfillmentId} tripVersion=${tripVersion} status=${trip.status}`);

// 1 — create the DRAFT submission
const existing = JSON.parse(api('GET', `/driver/me/fulfillments/${fulfillmentId}/pod`, { token }));
const openDraft = (existing.items || []).find((s) => s.status === 'DRAFT');
let submission;
if (openDraft) {
  submission = openDraft;
  console.log(`reusing open draft submission=${submission.id} version=${submission.version}`);
} else {
  const created = JSON.parse(api('POST', `/driver/me/fulfillments/${fulfillmentId}/pod`, {
    token,
    idempotencyKey: `minimax-212510-create-${MARKER}`,
    body: { expectedVersion: tripVersion },
  }));
  submission = created.submission || created;
  if (created.error) { console.error('create failed:', created); process.exit(3); }
  console.log(`created submission=${submission.id} status=${submission.status} version=${submission.version}`);
}

// 2 — attach ONE file into the "Phiếu bãi / phiếu hạ" slot so the slot count badge renders
const png = '/Volumes/LexarSSD/projects/silversea-prod/qa/minimax-fixture-toll.png';
execFileSync('python3', ['-c', `
import struct, zlib, sys
w,h=400,260
rows=b''
for y in range(h):
    rows+=b'\\x00'+bytes([ (x*255)//w if y<40 else ((y*255)//h) for x in range(w) for _ in range(3)])
def chunk(t,d):
    c=t+d
    return struct.pack('>I',len(d))+c+struct.pack('>I',zlib.crc32(c)&0xffffffff)
png=b'\\x89PNG\\r\\n\\x1a\\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
open(${JSON.stringify(png)},'wb').write(png)
`]);
const attached = JSON.parse(api('POST', `/driver/me/fulfillments/${fulfillmentId}/pod/${submission.id}/files`, {
  token,
  idempotencyKey: `minimax-212510-attach-${MARKER}`,
  // driverPodFileAttachSchema is multipart: expectedVersion + fileType + file.
  form: {
    fields: ['fileType=YARD_OR_DROP_RECEIPT', `expectedVersion=${submission.version}`],
    file: png,
  },
}));
if (attached.error) { console.error('attach failed:', attached); process.exit(4); }
console.log(`attached -> files=${(attached.files || []).map((f) => `${f.fileType}:${f.originalFileName}`).join(', ')}`);
console.log(`MARKER=${MARKER}`);
console.log(`OPEN=/my-trips/${TRIP_ID}/pod  (driver ${DRIVER})`);