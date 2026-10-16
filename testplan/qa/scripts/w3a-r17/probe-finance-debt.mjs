import puppeteer from 'puppeteer';
const API='https://vantai.tingting.vip/api';
const login=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'hoapt',password:'Abc123'})});
const token=(await login.json()).token;
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1440,height:960});
await p.evaluateOnNewDocument((t,o)=>{if(location.origin===o)localStorage.setItem('token',t)},token,'https://vantai.tingting.vip');
await p.goto('https://vantai.tingting.vip/finance',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,3500));
const fin=await p.evaluate(()=>({
  headings: [...document.querySelectorAll('h1,h2,h3,[class*="card-title"],[class*="heading"]')].filter(e=>e.offsetParent).map(e=>e.textContent.trim().slice(0,50)).slice(0,12),
  bodySample: (document.body.innerText||'').replace(/\s+/g,' ').slice(0,600),
  canvas: document.querySelectorAll('canvas').length,
  charts: document.querySelectorAll('[class*="chart"],[class*="recharts"],[class*="bar"]').length,
}));
console.log('FINANCE:',JSON.stringify(fin,null,1).slice(0,1200));
await p.goto('https://vantai.tingting.vip/debt',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,3000));
const debt=await p.evaluate(()=>({
  rows: [...document.querySelectorAll('tbody tr,a[href*="/debt/"]')].filter(e=>e.offsetParent).slice(0,6).map(e=>({tag:e.tagName,href:e.getAttribute('href'),txt:e.textContent.trim().replace(/\s+/g,' ').slice(0,60)})),
}));
console.log('DEBT:',JSON.stringify(debt,null,1));
await b.close();
