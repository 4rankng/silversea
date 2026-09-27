import { chromium } from '@playwright/test';
const FE='http://localhost:7175';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
for (const w of [390,768,1024,1440]) {
  const ctx=await b.newContext({viewport:{width:w,height:w<600?844:1024},hasTouch:w<=1024,deviceScaleFactor:2});
  const p=await ctx.newPage();
  await p.goto(`${FE}/login`,{waitUntil:'networkidle'});
  await p.fill('input[name="username"]','dieuvan');await p.fill('input[name="password"]','Abc123');
  await p.locator('button[type="submit"]').first().click();
  await p.waitForURL(u=>!u.pathname.includes('login'),{timeout:20000}).catch(()=>{});
  for (const [name,path] of [['dispatch','/dispatch'],['dispatch-detail','/dispatch-detail']]) {
    await p.goto(`${FE}${path}`,{waitUntil:'networkidle'});
    await p.waitForTimeout(900);
    const m = await p.evaluate(()=>{
      const th=document.querySelector('.detailed-plan-grid thead, .master-plan-grid thead');
      const dth=document.querySelector('.master-plan-grid thead');
      const first=document.querySelector('.detailed-plan-grid__row,.master-plan-grid__row');
      const anyInline=document.querySelector('.master-plan-grid__line');
      return {ovf:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        theadDisplay: th?getComputedStyle(th).display:null,
        masterThead: dth?getComputedStyle(dth).display:null,
        cardH: first?Math.round(first.getBoundingClientRect().height):null,
        lineDisplay: anyInline?getComputedStyle(anyInline).display:null};
    });
    console.log(w, name, JSON.stringify(m));
    await p.screenshot({path:`../qa/matrix/${name}-${w}.png`, fullPage:false});
  }
  await ctx.close();
}
await b.close();
