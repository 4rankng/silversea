import puppeteer from 'puppeteer';
const API='https://vantai.tingting.vip/api';
const login=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'tiepvv',password:'Abc123'})});
const token=(await login.json()).token;
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1440,height:960});
await p.evaluateOnNewDocument((t,o)=>{if(location.origin===o)localStorage.setItem('token',t)},token,'https://vantai.tingting.vip');
await p.goto('https://vantai.tingting.vip/shipments/new',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,3000));
await p.evaluate(()=>{const el=[...document.querySelectorAll('label,button')].find(e=>e.offsetParent&&e.textContent.replace(/\s+/g,' ').trim().startsWith('Hàng lẻ'));if(el)el.click()});
await new Promise(r=>setTimeout(r,1000));
const clean=s=>s&&s.textContent.trim().replace(/\s+/g,' ').replace(/\*+$/,'');
const fld=await p.evaluate(()=>{
  const clean=s=>s.textContent.trim().replace(/\s+/g,' ').replace(/\*+$/,'');
  const label=[...document.querySelectorAll('label')].find(l=>l.offsetParent&&clean(l)==='Tuyến đường');
  const el=label?document.getElementById(label.getAttribute('for')):null;
  return el?{id:el.id}:null;
});
console.log('field',fld);
await p.click(`[id="${fld.id}"]`); await new Promise(r=>setTimeout(r,800));
console.log('after-click',await p.evaluate(()=>({expanded:document.activeElement?.getAttribute('aria-expanded'),options:document.querySelectorAll('[role="option"]').length,listboxes:document.querySelectorAll('[role="listbox"]').length})));
await p.keyboard.type('LOG',{delay:60}); await new Promise(r=>setTimeout(r,2500));
console.log('after-type',await p.evaluate((fid)=>({
  options:[...document.querySelectorAll('[role="option"]')].map(o=>o.textContent.trim().slice(0,50)),
  focused:document.activeElement?.id===fid,
}),fld.id));
// pick first option if any
const picked=await p.evaluate(()=>{const o=[...document.querySelectorAll('[role="option"]')].find(x=>x.offsetParent);if(o){o.click();return o.textContent.trim().slice(0,60)}return null});
console.log('picked',picked);
await new Promise(r=>setTimeout(r,500));
console.log('trigger-now',await p.evaluate(()=>{const el=document.getElementById(fld.id);const trig=el.closest('[class*="combobox"]');return trig?trig.textContent.trim().slice(0,60):null}));
await b.close();
