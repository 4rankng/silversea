// Staging health probe — prints buildHash (wave: must start with 19ed100f)
const url = process.env.HEALTH_URL || 'https://vantai.tingting.vip/api/health';
const r = await fetch(url);
const j = await r.json();
console.log(JSON.stringify(j));
