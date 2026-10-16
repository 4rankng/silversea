import puppeteer from 'puppeteer';
const API='https://vantai.tingting.vip/api';
const login=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'hoapt',password:'Abc123'})});
const token=(await login.json()).token;
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1440,height:960});
await p.evaluateOnNewDocument((t,o)=>{if(location.origin===o)localStorage.setItem('token',t)},token,'https://vantai.tingting.vip');
await p.goto('https://vantai.tingting.vip/salary',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,3000));
// click first driver
await p.evaluate(()=>{const row=[...document.querySelectorAll('tr,li,button,div')].filter(e=>e.offsetParent&&e.textContent.replace(/\s+/g,' ').trim()==='Nguyễn Văn Quỳnh')[0];if(row)row.click()});
await new Promise(r=>setTimeout(r,5000));
const probe=await p.evaluate(()=>{
  const body=document.body.innerText||'';
  const chipLike=[...document.querySelectorAll('*')].filter(e=>e.offsetParent&&e.children.length===0&&/chuyến/.test(e.textContent)&&e.textContent.trim().length<50).slice(0,6).map(e=>({t:e.textContent.trim().slice(0,40),cls:String(e.className).slice(0,50),h:Math.round(e.getBoundingClientRect().height)}));
  return {
    hasCalendar: /Th 1|Th 2|Thứ|CN|T2|T3/.test(body),
    chipLike,
    sample: body.replace(/\s+/g,' ').slice(0,500),
  };
});
console.log(JSON.stringify(probe,null,1).slice(0,1600));
await p.screenshot({path:'qa/2026-10-16_w3a-r17-verify/probe_salary_calendar.png'});
await b.close();
