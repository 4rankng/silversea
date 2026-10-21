#!/usr/bin/env node
/** Audit window 2026-10-21 09:30Z..11:30Z — shipment lifecycle events (READ-ONLY). */
import { login, api, DEFAULT_PASSWORD } from '../../../scripts/lib/http.mjs';

const BACKEND = process.env.BACKEND ?? 'https://vantai.tingting.vip/api';
const token = await login({ username: 'admin', password: DEFAULT_PASSWORD }, { backend: BACKEND });
const call = (path) => api(token, 'GET', path, undefined, { backend: BACKEND });

const all = [];
for (let page = 1; page <= 12; page += 1) {
  const res = await call(`/audit-logs?page=${page}&limit=100`);
  if (res.status !== 200) break;
  const items = res.data?.items ?? [];
  all.push(...items);
  if (res.data?.totalPages != null && page >= res.data.totalPages) break;
}
console.log(`fetched=${all.length}`);
const FROM = Date.parse('2026-10-21T09:00:00Z');
const TO = Date.parse('2026-10-21T11:30:00Z');
const win = all
  .filter((a) => {
    const t = Date.parse(a.timestamp);
    return t >= FROM && t <= TO;
  })
  .filter((a) => a.action !== 'USER_LOGIN' && a.action !== 'LOGIN_FAILED');
for (const a of win) {
  const body = a.payload?.body ?? {};
  console.log(`${a.timestamp} ${a.action} user=${a.userName} path=${a.path} id=${a.id}`, 
    a.action === 'ENTITY_CREATED' || a.action.startsWith('SHIPMENT') ? JSON.stringify(body).slice(0, 260) : '');
}
