import puppeteer from 'puppeteer';
const API='https://vantai.tingting.vip/api';
const login=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'tiepvv',password:'Abc123'})});
const token=(await login.json()).token;
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1440,height:960});
await p.evaluateOnNewDocument((t,o)=>{if(location.origin===o)localStorage.setItem('token',t)},token,'https://vantai.tingting.vip');
await p.goto('https://vantai.tingting.vip/shipments-detail',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,3000));
const probe=await p.evaluate(()=>({ myLot: (document.body.innerText||'').includes('QAWA-W3A'),
  ledgerEls: [...document.querySelectorAll('[class*="shipment-container-ledger"]')].slice(0,10).map(e=>({cls:String(e.className).slice(0,70),tag:e.tagName})),
  cellTriggers: [...document.querySelectorAll('[id*="shipment-detail-edit"]')].map(e=>({id:e.id,tag:e.tagName,vis:!!e.offsetParent})).slice(0,12),
  buttons: [...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.textContent.trim().slice(0,30)).filter(t=>t).slice(0,30),
  hasQAWA: (document.body.innerText||'').includes('QAWA0000010'),
}));
console.log(JSON.stringify(probe,null,1));
await b.close();
