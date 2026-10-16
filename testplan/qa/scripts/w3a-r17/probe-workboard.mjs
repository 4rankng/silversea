import puppeteer from 'puppeteer';
const API='https://vantai.tingting.vip/api';
const login=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'tiepvv',password:'Abc123'})});
const token=(await login.json()).token;
// find the BL via API list first
const lst=await fetch(`${API}/shipments?q=QA-W3A&limit=5`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json());
console.log('api q search:',JSON.stringify((lst.items??lst).slice?(lst.items??lst).map(x=>({id:x.id,bl:x.blNumber,code:x.shipmentCode})).slice(0,3):lst).slice(0,300));
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1440,height:960});
await p.evaluateOnNewDocument((t,o)=>{if(location.origin===o)localStorage.setItem('token',t)},token,'https://vantai.tingting.vip');
await p.goto('https://vantai.tingting.vip/shipments-detail?searchSuffix=QA-W3A-cus-fcl-261016045600',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,5000));
const probe=await p.evaluate(()=>({
  rows: document.querySelectorAll('tbody tr').length,
  hasMyLot: (document.body.innerText||'').includes('QA-W3A-cus-fcl'),
  triggers: document.querySelectorAll('[id*="shipment-detail-edit"]').length,
  buttons: [...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.textContent.trim().slice(0,25)).filter(t=>t).slice(0,20),
  tables: document.querySelectorAll('table').length,
}));
console.log(JSON.stringify(probe,null,1));
await b.close();
