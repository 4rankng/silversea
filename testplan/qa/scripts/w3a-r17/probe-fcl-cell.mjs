import puppeteer from 'puppeteer';
const API='https://vantai.tingting.vip/api';
const login=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'admin',password:'Abc123'})});
const token=(await login.json()).token;
// cleanup lot 576 as admin
const del=await fetch(`${API}/shipments/576`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`,'Idempotency-Key':crypto.randomUUID()}}).then(r=>r.status);
console.log('delete-576-as-admin:',del);
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1440,height:960});
await p.evaluateOnNewDocument((t,o)=>{if(location.origin===o)localStorage.setItem('token',t)},token,'https://vantai.tingting.vip');
await p.goto('https://vantai.tingting.vip/shipments/new',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,4000));
const cells=await p.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>({t:b.textContent.trim().slice(0,35),cls:String(b.className).slice(0,50)})).filter(x=>/20|40|chọn|loại|cont/i.test(x.t)));
console.log('candidate cells:',JSON.stringify(cells.slice(0,12)));
await b.close();
