#!/usr/bin/env node
/** Addendum probe (READ-ONLY): confirm staging lot SHP-2610-00069 / id 133 shape. */
import { appendFileSync, mkdirSync } from 'node:fs';
import { login, api, DEFAULT_PASSWORD } from '../../../scripts/lib/http.mjs';

const BACKEND = process.env.BACKEND ?? 'https://vantai.tingting.vip/api';
const OUT = 'qa/2026-10-21-lcl01-lan2';
mkdirSync(OUT, { recursive: true });
const token = await login({ username: 'tiepvv', password: DEFAULT_PASSWORD }, { backend: BACKEND });
const call = (path) => api(token, 'GET', path, undefined, { backend: BACKEND });

const lines = [];
const log = (l) => { console.log(l); lines.push(l); };

for (const p of ['/shipments/SHP-2610-00069', '/shipments/133', '/shipments/cus-workspace/133']) {
  const res = await call(p);
  log(`${p} → ${res.status}`);
  if (res.status === 200) {
    const d = res.data;
    log(JSON.stringify({
      id: d.id ?? d.summary?.id,
      shipmentCode: d.shipmentCode ?? d.summary?.shipmentCode ?? d.raw?.shipmentCode,
      status: d.status ?? d.summary?.status,
      cargoMode: d.cargoMode ?? d.summary?.cargoMode,
      expectedDeliveryDate: d.expectedDeliveryDate ?? d.raw?.expectedDeliveryDate,
      containers: (d.containers ?? []).map((c) => ({
        id: c.id, no: c.containerNumber ?? c.containerNo, typeId: c.containerTypeId ?? c.containerType?.id,
        appointmentAt: c.customerAppointmentAt,
      })),
      customerId: d.customerId ?? d.raw?.customerId,
    }, null, 1));
    break;
  }
}
appendFileSync(`${OUT}/stg-lot-shp261000069.json`, lines.join('\n') + '\n');
