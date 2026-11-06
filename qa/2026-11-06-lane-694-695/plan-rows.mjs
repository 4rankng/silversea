// Fetch dispatch detail plan rows for a plate — prints id/version/status per row.
const API = 'http://localhost:3002/api';
const PASSWORD = 'Abc123';

const login = async (username) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password: PASSWORD }),
  });
  return (await res.json()).token;
};

const token = await login('dungnv');
const res = await fetch(`${API}/shipments/dispatch-detail-plan-rows?truckPlate=15H-154.26&limit=50`, {
  headers: { Authorization: `Bearer ${token}` },
});
const body = await res.json();
const rows = (body.items ?? []).filter((r) => r.dispatch?.assignedPlate === '15H-154.26');
for (const r of rows) {
  console.log(JSON.stringify({
    shipmentId: r.shipmentId,
    shipmentCode: r.shipmentCode,
    fulfillmentId: r.fulfillmentId,
    version: r.version,
    taskStatus: r.taskStatus,
    tripId: r.dispatch?.tripId,
    tripStatus: r.dispatch?.tripStatus,
    plate: r.dispatch?.assignedPlate,
    carrierType: r.dispatch?.carrierType,
    time: r.time,
  }));
}
