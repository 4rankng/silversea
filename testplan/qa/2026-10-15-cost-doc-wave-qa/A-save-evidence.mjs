import { login, session, goto, shot, sleep, mainText } from './qa-lib.mjs';
import { writeFileSync } from 'node:fs';
const tok = await login('bqhuong');
const s = await session(tok);
const errs=[];
s.page.on('response',async r=>{if(r.url().includes('/api/')&&r.status()>=400){try{errs.push({status:r.status(),url:new URL(r.url()).pathname,body:(await r.text()).slice(0,300)});}catch{}}});
await goto(s.page,'/my-trips/123');
await s.page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>/Thêm chi phí/.test(b.innerText)).click());
await sleep(1000);
await s.page.evaluate(()=>{const set=(el,v)=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
  const a=[...document.querySelectorAll('input')].find(i=>/Thực chi/.test(document.querySelector(`label[for="${CSS.escape(i.id)}"]`)?.innerText||'')); if(a) set(a,'120000');});
await sleep(300);
const h = await s.page.$$('input[type=file]');
await h[3].setInputFiles('/tmp/receipt.png');
await sleep(1200);
await shot(s.page,'A-03-form-phinhan');
await s.page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>/Lưu tất cả/.test(b.innerText)).click());
await sleep(2200);
// capture the VISIBLE error
const errUi = await s.page.evaluate(()=>{
  const cands=[...document.querySelectorAll('[role=alert], [role=status], .toast, .alert, [class*=error], [class*=toast], [class*=alert]')]
    .filter(e=>{const r=e.getBoundingClientRect(); return r.width>0&&r.height>0 && r.top < window.innerHeight && r.bottom > 0;})
    .map(e=>({role:e.getAttribute('role')||'',cls:(e.className||'').toString().slice(0,50),txt:(e.innerText||'').trim().replace(/\s+/g,' ').slice(0,250)}))
    .filter(x=>x.txt);
  return cands;
});
console.log('VISIBLE ERROR ELEMENTS:',JSON.stringify(errUi,null,1));
await shot(s.page,'A-04-loi-400-pho-nang');
// scroll to the error region
await s.page.evaluate(()=>{const e=[...document.querySelectorAll('[role=alert],[class*=error],[class*=toast]')].find(x=>/hóa đơn/i.test(x.innerText||'')); if(e) e.scrollIntoView({block:'center'});});
await sleep(600);
await shot(s.page,'A-05-loi-400-scroll');
writeFileSync('testplan/qa/2026-10-15-cost-doc-wave-qa/A-04-error-evidence.json', JSON.stringify({apiErrors:errs, visibleErrors:errUi},null,2));
console.log('API ERRORS:',JSON.stringify(errs,null,1));
await s.browser.close();
