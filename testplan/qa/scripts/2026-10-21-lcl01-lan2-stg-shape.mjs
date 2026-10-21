#!/usr/bin/env node
/** Inspect the shape of specific lots on staging (READ-ONLY). */
import { login, api, DEFAULT_PASSWORD } from '../../../scripts/lib/http.mjs';

const BACKEND = process.env.BACKEND ?? 'https://vantai.tingting.vip/api';
const QA_USER = process.env.QA_USER ?? 'tiepvv';
const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

const token = await login({ username: QA_USER, password: DEFAULT_PASSWORD }, { backend: BACKEND });
const call = (path) => api(token, 'GET', path, undefined, { backend: BACKEND });

const overview = await call(`/shipments/cus-workspace?page=1&limit=200`);
const dd = await call(`/shipments/cus-workspace/containers?page=1&limit=200&transportDateFrom=${today}&transportDateTo=${today}`);
const detailDefaultIds = new Set(dd.data.items.map((r) => r.shipmentId));

const interesting = overview.data.items.filter((r) => r.cargoMode !== 'FCL');
for (const r of interesting) {
  const shape = {
    id: r.id,
    cargoMode: r.cargoMode,
    transportDate: r.transportDate,
    billOrBook: r.billOrBookNumber,
    shipmentCode: r.shipmentCode,
    status: r.status,
    bucket: r.bucket,
    customerName: r.customerName,
    inDetailDefault: detailDefaultIds.has(r.id),
  };
  console.log(JSON.stringify(shape));
  // Full workspace detail for non-FCL lots: containers? package data?
  const det = await call(`/shipments/cus-workspace/${r.id}`);
  if (det.status === 200) {
    const d = det.data;
    console.log(JSON.stringify({
      id: r.id,
      containerCount: d.containers?.length ?? null,
      packageCount: d.raw?.packageCount ?? d.packageCount ?? null,
      packageType: d.raw?.packageType ?? d.packageType ?? null,
      cargoWeightKg: d.raw?.cargoWeightKg ?? d.cargoWeightKg ?? null,
      cargoVolumeCbm: d.raw?.cargoVolumeCbm ?? d.cargoVolumeCbm ?? null,
      edd: d.raw?.expectedDeliveryDate ?? d.expectedDeliveryDate ?? null,
      isAdHoc: d.raw?.isAdHoc ?? d.isAdHoc ?? null,
      direction: d.raw?.tradeDirection ?? d.tradeDirection ?? null,
      createdAt: d.raw?.createdAt ?? d.createdAt ?? null,
    }));
  } else {
    console.log(`  detail status=${det.status}`);
  }
}
// How many detail-default rows are NOT LCL lots?
for (const row of dd.data.items) {
  console.log(`DETAIL-DEFAULT row shipmentId=${row.shipmentId} classification=${row.classification} containerNumber=${row.containerNumber} transportDate=${row.transportDate}`);
}
