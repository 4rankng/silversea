import puppeteer from 'puppeteer';
const API='https://vantai.tingting.vip/api';
const login=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'tiepvv',password:'Abc123'})});
const token=(await login.json()).token;
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1440,height:960});
await p.evaluateOnNewDocument((t,o)=>{if(location.origin===o)localStorage.setItem('token',t)},token,'https://vantai.tingting.vip');
const net=[];
p.on('response',async (r)=>{
  if(r.url().includes('cus-workspace')){net.push({url:r.url().replace('https://vantai.tingting.vip',''),status:r.status()});}
});
p.on('pageerror',e=>net.push({pageerror:String(e).slice(0,150)}));
await p.goto('https://vantai.tingting.vip/shipments-detail?searchSuffix=QA-W3A-cus-fcl-261016045600',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,6000));
console.log(JSON.stringify({net,rows:await p.evaluate(()=>document.querySelectorAll('tbody tr').length),hasLot:await p.evaluate(()=>(document.body.innerText||'').includes('QA-W3A-cus-fcl'))},null,1));
await b.close();
