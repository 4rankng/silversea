import puppeteer from 'puppeteer';
const API='https://vantai.tingting.vip/api';
const login=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'hoapt',password:'Abc123'})});
const token=(await login.json()).token;
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1440,height:960});
await p.evaluateOnNewDocument((t,o)=>{if(location.origin===o)localStorage.setItem('token',t)},token,'https://vantai.tingting.vip');
await p.goto('https://vantai.tingting.vip/finance',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,3500));
const chart=await p.evaluate(()=>{
  const cards=[...document.querySelectorAll('h1,h2,h3,div,section')].filter(e=>e.offsetParent && /Phân tích lãi gộp theo phương tiện/.test(e.textContent||''));
  const card=cards[cards.length-1];
  if(!card) return {found:false};
  // label-ish leaves inside the card
  const leaves=[...card.querySelectorAll('*')].filter(e=>e.offsetParent && e.children.length===0 && e.textContent.trim().length>0 && e.textContent.trim().length<30);
  const clipped=leaves.filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>({t:e.textContent.trim().slice(0,30),sw:e.scrollWidth,cw:e.clientWidth,cls:String(e.className).slice(0,40)}));
  const texts=[...new Set(leaves.map(e=>e.textContent.trim()))].slice(0,30);
  return {found:true,clipped:clipped.slice(0,8),texts};
});
console.log('VEHICLE-CHART:',JSON.stringify(chart,null,1).slice(0,1500));
// debt detail buttons
await p.goto('https://vantai.tingting.vip/debt',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,2500));
await p.evaluate(()=>{const tr=[...document.querySelectorAll('tbody tr')].find(r=>r.offsetParent);if(tr)tr.click()});
await new Promise(r=>setTimeout(r,2500));
console.log('URL-NOW:',await p.evaluate(()=>location.href));
const btns=await p.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.textContent.trim()).filter(t=>t&&t.length<35).slice(0,20));
console.log('DEBT-DETAIL-BUTTONS:',JSON.stringify(btns));
await b.close();
