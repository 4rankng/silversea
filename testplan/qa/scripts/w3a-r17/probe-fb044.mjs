import puppeteer from 'puppeteer';
const API='https://vantai.tingting.vip/api';
const login=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'tiepvv',password:'Abc123'})});
const token=(await login.json()).token;
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1440,height:960});
await p.evaluateOnNewDocument((t,o)=>{if(location.origin===o)localStorage.setItem('token',t)},token,'https://vantai.tingting.vip');
await p.goto('https://vantai.tingting.vip/shipments/new',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,4000));
// FCL is the default mode; find the container row's type cell picker
const cell=await p.evaluate(()=>{
  const clean=s=>(s||'').replace(/\s+/g,' ').trim();
  // candidate triggers inside the container table area
  const area=[...document.querySelectorAll('table,tbody,[class*="container"]')].filter(e=>e.offsetParent);
  const btns=[...document.querySelectorAll('button,[role="combobox"],[role="button"]')].filter(e=>e.offsetParent&&/container|loại|chọn|20|40/i.test(clean(e.textContent)+clean(e.getAttribute('aria-label'))+clean(e.placeholder)));
  return btns.slice(0,10).map(e=>({tag:e.tagName,txt:clean(e.textContent).slice(0,30),aria:clean(e.getAttribute('aria-label')),cls:String(e.className).slice(0,50)}));
});
console.log(JSON.stringify(cell,null,1));
await b.close();
