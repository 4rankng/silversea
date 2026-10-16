import puppeteer from 'puppeteer';
const API='https://vantai.tingting.vip/api', BASE='https://vantai.tingting.vip';
const login=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'tiepvv',password:'Abc123'})});
const token=(await login.json()).token;
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1440,height:960});
await p.evaluateOnNewDocument((t,o)=>{if(location.origin===o)localStorage.setItem('token',t)},token,new URL(BASE).origin);
await p.goto(BASE+'/shipments/new',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,5000));
const info=await p.evaluate(()=>({
  url: location.href,
  title: document.title,
  labels: [...document.querySelectorAll('label')].filter(l=>l.offsetParent).map(l=>l.textContent.trim().replace(/\s+/g,' ')).slice(0,40),
  buttons: [...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.textContent.trim()).filter(t=>t&&t.length<35).slice(0,25),
  h1: (document.querySelector('h1,h2,[class*="title"]')?.textContent||'').slice(0,80),
}));
console.log(JSON.stringify(info,null,1));
await p.screenshot({path:'qa/2026-10-16_w3a-r17-verify/probe_create_page.png'});
await b.close();
