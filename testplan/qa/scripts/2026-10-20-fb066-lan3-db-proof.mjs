// QA R27 / FB-066 lần 3 — DB side-effect proof: the quick-added plates land in
// the own-fleet truck catalog (POST /api/trucks). Pages through the list and
// prints only the matching rows.
const API = process.env.QA_API || 'http://localhost:3002/api';
const run = async () => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }),
  });
  const { token } = await res.json();
  const matches = [];
  for (let page = 1; page <= 40; page += 1) {
    const list = await fetch(`${API}/trucks?page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await list.json();
    const items = body.items ?? [];
    if (!body.items) { console.log('RAW:', JSON.stringify(body).slice(0, 300)); break; }
    if (page === 1) {
      console.log('TOTAL:', body.total, 'PAGE_SIZE:', body.pageSize,
        'SAMPLE:', JSON.stringify(items.slice(0, 3).map((t) => t.licensePlate)));
    }
    for (const t of items) {
      if (String(t.licensePlate ?? '').startsWith('29C-066')) {
        matches.push({ id: t.id, licensePlate: t.licensePlate, isActive: t.isActive });
      }
    }
    if (page * (body.pageSize ?? 50) >= (body.total ?? 0)) break;
  }
  console.log(JSON.stringify(matches, null, 2));
};
run();
