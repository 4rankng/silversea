import puppeteer from 'puppeteer';
const API='https://vantai.tingting.vip/api';
const login=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'hoapt',password:'Abc123'})});
const token=(await login.json()).token;
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1440,height:960});
await p.evaluateOnNewDocument((t,o)=>{if(location.origin===o)localStorage.setItem('token',t)},token,'https://vantai.tingting.vip');
await p.goto('https://vantai.tingting.vip/debt',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,2500));
await p.evaluate(()=>{const tr=[...document.querySelectorAll('tbody tr')].find(r=>r.offsetParent);if(tr)tr.click()});
await new Promise(r=>setTimeout(r,2500));
console.log('url:',await p.evaluate(()=>location.href));
// open the payment modal via the REAL header button (real mouse)
const openBtn=await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent&&/Ghi nhận thanh toán/.test(b.textContent));if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}});
await p.mouse.move(openBtn.x,openBtn.y);await p.mouse.down();await p.mouse.up();
await new Promise(r=>setTimeout(r,1200));
console.log('modal open:',await p.evaluate(()=>!!document.querySelector('#pay-amount')));
// submit empty via the modal's Ghi nhận (real mouse at coords)
const subBtn=await p.evaluate(()=>{const bs=[...document.querySelectorAll('button')].filter(b=>b.offsetParent&&b.textContent.trim()==='Ghi nhận');const b=bs[bs.length-1];if(!b)return null;const r=b.getBoundingClientRect();const cx=Math.round(r.x+r.width/2),cy=Math.round(r.y+r.height/2);const hit=document.elementFromPoint(cx,cy);b.addEventListener('click',()=>{window.__btnClicked=true});return {x:cx,y:cy,count:bs.length,hit:hit?{tag:hit.tagName,txt:(hit.textContent||'').trim().slice(0,20),isBtn:hit.closest('button')===b}:null,disabled:b.disabled,type:b.type}});
console.log('submit btn:',JSON.stringify(subBtn));
await p.mouse.move(subBtn.x,subBtn.y);await p.mouse.down();await p.mouse.up();
await new Promise(r=>setTimeout(r,600));
console.log('btn received click:',await p.evaluate(()=>window.__btnClicked??false));
await new Promise(r=>setTimeout(r,1000));
const state=await p.evaluate(()=>{
  const amt=document.querySelector('#pay-amount');
  const rec=document.querySelector('#pay-receipt');
  const banner=document.querySelector('#pay-error,[role="alert"]');
  return {
    bannerText: banner?banner.textContent.trim():null,
    amtInvalid: amt?.getAttribute('aria-invalid'),
    amtBorder: amt?getComputedStyle(amt).borderColor:null,
    recInvalid: rec?.getAttribute('aria-invalid'),
    recBorder: rec?getComputedStyle(rec).borderColor:null,
  };
});
console.log('AFTER EMPTY SUBMIT:',JSON.stringify(state,null,1));
await p.screenshot({path:'qa/2026-10-16_w3a-r17-verify/probe_fb048_after_submit.png'});
await b.close();
