import puppeteer from 'puppeteer';
const API='https://vantai.tingting.vip/api', BASE='https://vantai.tingting.vip';
const login=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'tiepvv',password:'Abc123'})});
const token=(await login.json()).token;
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1440,height:960});
await p.evaluateOnNewDocument((t,o)=>{if(location.origin===o)localStorage.setItem('token',t)},token,new URL(BASE).origin);
await p.goto(BASE+'/shipments',{waitUntil:'networkidle2'}); await new Promise(r=>setTimeout(r,2500));
const rows=await p.evaluate(()=>{
  const trs=[...document.querySelectorAll('tbody tr')].filter(r=>r.offsetParent);
  return trs.slice(0,20).map(tr=>{
    const cells=[...tr.querySelectorAll('td')].slice(0,4);
    const lineBoxes=cells.map(td=>{const range=document.createRange();range.selectNodeContents(td);return range.getClientRects().length});
    return {h:Math.round(tr.getBoundingClientRect().height*10)/10, cells:cells.map(td=>(td.textContent||'').trim().slice(0,24)), lines:lineBoxes};
  });
});
console.log(JSON.stringify(rows,null,1).slice(0,3000));
await b.close();
