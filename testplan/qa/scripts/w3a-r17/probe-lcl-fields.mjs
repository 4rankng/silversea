import puppeteer from 'puppeteer';
const API='https://vantai.tingting.vip/api', BASE='httpsvantai.tingting.vip'.replace('https','https:');
const login=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'tiepvv',password:'Abc123'})});
const token=(await login.json()).token;
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1440,height:960});
await p.evaluateOnNewDocument((t,o)=>{if(location.origin===o)localStorage.setItem('token',t)},token,'https://vantai.tingting.vip');
await p.goto('https://vantai.tingting.vip/shipments/new',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,3000));
await p.evaluate(()=>{const el=[...document.querySelectorAll('label,button')].find(e=>e.offsetParent&&e.textContent.replace(/\s+/g,' ').trim().startsWith('Hàng lẻ'));if(el)el.click()});
await new Promise(r=>setTimeout(r,1200));
const fields=await p.evaluate(()=>{
  const clean=s=>s.textContent.trim().replace(/\s+/g,' ').replace(/\*+$/,'');
  const out={};
  for(const want of ['Tuyến đường','Kho lấy hàng','Khách hàng','Hình thức xuất nhập khẩu']){
    const label=[...document.querySelectorAll('label')].find(l=>l.offsetParent&&clean(l)===want);
    if(!label){out[want]={found:false};continue}
    const forId=label.getAttribute('for');
    let el=forId?document.getElementById(forId):(label.parentElement.querySelector('input,select,textarea')??label.nextElementSibling?.querySelector('input,select,textarea'));
    if(!el){out[want]={found:true,noControl:true,parentCls:String(label.parentElement.className).slice(0,80),sibling:label.nextElementSibling?.tagName};continue}
    out[want]={found:true,tag:el.tagName,id:el.id,role:el.getAttribute('role'),aria:el.getAttribute('aria-label'),cls:String(el.className).slice(0,70),hasList:!!el.getAttribute('aria-controls'),parentCls:String(el.parentElement.className).slice(0,60)};
  }
  return out;
});
console.log(JSON.stringify(fields,null,1));
await b.close();
