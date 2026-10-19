// One-off: clear orphan QA pricing lanes left by earlier wave runs (428 cleanup misses).
import { login, api } from './fullguide-lib.mjs';
const admin = await login('admin');
for (const id of [314, 315]) {
  const g = await api(admin.token, 'GET', `/pricing-tables/${id}`);
  if (!g.json?.id) { console.log('cleanup', id, '-> already gone', g.status); continue; }
  const d = await api(admin.token, 'DELETE', `/pricing-tables/${id}`, null, { 'If-Unmodified-Since': g.json.updatedAt });
  console.log('cleanup', id, '->', d.status, (d.text ?? '').slice(0, 120));
}
