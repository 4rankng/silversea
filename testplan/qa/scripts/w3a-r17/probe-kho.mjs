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
const labelId=async (name)=>p.evaluate((n)=>{
  const clean=s=>s.textContent.trim().replace(/\s+/g,' ').replace(/\*+$/,'');
  const label=[...document.querySelectorAll('label')].find(l=>l.offsetParent&&clean(l)===n);
  return label?label.getAttribute('for'):null;
},name);
// pick customer YUANFANG via real mouse
const cid=await labelId('Khách hàng');
await p.click(`[id="${cid}"]`); await new Promise(r=>setTimeout(r,700));
await p.keyboard.type('YUAN',{delay:60}); await new Promise(r=>setTimeout(r,1800));
const loc=await p.evaluate(()=>{const o=[...document.querySelectorAll('[role="option"]')].filter(x=>x.offsetParent)[0];if(!o)return null;const r=o.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),t:o.textContent.trim().slice(0,40)}});
if(loc){await p.mouse.move(loc.x,loc.y);await p.mouse.down();await p.mouse.up();}
await new Promise(r=>setTimeout(r,900));
console.log('customer picked:',loc&&loc.t);
// now the warehouse combobox
const kid=await labelId('Kho lấy hàng');
await p.click(`[id="${kid}"]`); await new Promise(r=>setTimeout(r,1500));
let opts=await p.evaluate(()=>[...document.querySelectorAll('[role="option"]')].filter(o=>o.offsetParent).map(o=>o.textContent.trim().slice(0,50)));
console.log('kho options (no query):',JSON.stringify(opts));
await p.keyboard.type('KCN',{delay:60}); await new Promise(r=>setTimeout(r,2000));
opts=await p.evaluate(()=>[...document.querySelectorAll('[role="option"]')].filter(o=>o.offsetParent).map(o=>o.textContent.trim().slice(0,50)));
console.log('kho options (KCN):',JSON.stringify(opts));
await b.close();
