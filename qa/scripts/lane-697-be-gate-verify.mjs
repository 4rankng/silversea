// Lane SIL-697 BE gate — the submit endpoint must REFUSE a draft missing
// either required file type with a Vietnamese 409 naming the missing type.
// Runs against the lane backend (:3004). Uses trip 1308 (IN_TRANSIT).
const API = process.env.LANE_API || 'http://localhost:3004/api';
const TRIP = Number(process.env.LANE_TRIP || 1308);
const FULFILLMENT = Number(process.env.LANE_FULFILLMENT || 2054);
const DRIVER = process.env.LANE_DRIVER || 'nvquynh';

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  return (await res.json()).token;
};
const call = async (tok, method, path, payload, key) => {
  const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: payload == null ? undefined : JSON.stringify(payload) });
  let body; try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
};

const token = await login(DRIVER);
if (!token) throw new Error('login failed');
const detail = await call(token, 'GET', `/driver/me/fulfillments/${FULFILLMENT}`);
const tripVersion = detail.body?.tripVersion ?? detail.body?.version;
console.log('trip', TRIP, 'version', tripVersion, 'detail keys', Object.keys(detail.body ?? {}).slice(0, 10).join(','));

const created = await call(token, 'POST', `/driver/me/fulfillments/${FULFILLMENT}/pod`, { expectedVersion: tripVersion }, `lane697be-draft-${Date.now()}`);
console.log('ensure-draft', created.status);
const items = (await call(token, 'GET', `/driver/me/fulfillments/${FULFILLMENT}/pod`)).body?.items ?? [];
const latest = [...items].sort((a, b) => (b.submissionVersion ?? 0) - (a.submissionVersion ?? 0))[0];
console.log('latest submission', latest?.id, 'status', latest?.status, 'files', JSON.stringify((latest?.files ?? []).map((f) => f.fileType)));
if (latest?.status !== 'DRAFT') throw new Error('expected a DRAFT to probe');
for (const file of latest.files ?? []) {
  const removed = await call(token, 'DELETE', `/driver/me/fulfillments/${FULFILLMENT}/pod/${latest.id}/files/${file.id}`, null, `lane697be-rm-${file.id}-${Date.now()}`);
  console.log('removed file', file.fileType, removed.status);
}

const refused = await call(token, 'POST', `/driver/me/fulfillments/${FULFILLMENT}/pod/${latest.id}/submit`, { expectedVersion: latest.version }, `lane697be-submit-refused-${Date.now()}`);
console.log('submit refused:', refused.status, JSON.stringify(refused.body));
const ok = refused.status === 409
  && typeof refused.body?.error === 'string'
  && refused.body.error.includes('Chưa đủ chứng từ giao hàng')
  && refused.body.error.includes('Phiếu hạ bãi / trả hàng')
  && refused.body.error.includes('Biên bản giao nhận đã ký');
console.log(ok ? 'BE GATE VERIFIED: incomplete draft submit → 409 naming both missing types.' : 'BE GATE FAILED');
process.exitCode = ok ? 0 : 1;
