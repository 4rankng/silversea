// Poll staging health until buildHash starts with TARGET (default 19ed100f) or timeout.
const TARGET = (process.env.TARGET || '19ed100f').slice(0, 8);
const url = 'https://vantai.tingting.vip/api/health';
const deadline = Date.now() + 25 * 60 * 1000;
let n = 0;
while (Date.now() < deadline) {
  n += 1;
  try {
    const r = await fetch(url);
    const j = await r.json();
    const h = String(j.buildHash || '');
    console.log(`[${new Date().toISOString()}] poll ${n}: buildHash=${h}`);
    if (h.startsWith(TARGET)) { console.log('READY ' + h); process.exit(0); }
  } catch (e) {
    console.log(`[${new Date().toISOString()}] poll ${n}: ERR ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 60000));
}
console.log('TIMEOUT still-old-build');
process.exit(2);
