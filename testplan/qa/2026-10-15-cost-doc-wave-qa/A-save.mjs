import { login, session, goto, shot, fields, log, sleep, mainText } from './qa-lib.mjs';
import { writeFileSync } from 'node:fs';
const tok = await login('bqhuong');
const s = await session(tok);
const reqs=[];
s.page.on('request', r=>{ if(r.method()!=='GET'&&r.url().includes('/api/')) reqs.push({m:r.method(),u:new URL(r.url()).pathname,b:r.postData()?.slice(0,600)}); });
const resps=[];
s.page.on('response', async r=>{ if(!r.url().includes('/api/')) return; const u=new URL(r.url()).pathname; if(!u.includes('photo')&&!u.includes('auth')) resps.push({s:r.status(),u}); });

await goto(s.page,'/my-trips/123');
await s.page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>/Thêm chi phí/.test(b.innerText)).click());
await sleep(900);

// fill amount
await s.page.evaluate(()=>{
  const set=(el,v)=>{const p=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;p.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
  const amt=[...document.querySelectorAll('input')].find(i=>/Thực chi/.test((document.querySelector(`label[for="${CSS.escape(i.id)}"]`)?.innerText)||''));
  if(amt) set(amt,'120000');
});
await sleep(400);
await shot(s.page,'A4_form_filled_before_save',{full:true});
// Save
await s.page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>/Lưu tất cả/.test(b.innerText)).click());
await sleep(2000);
const txt = await mainText(s.page);
console.log('=== AFTER SAVE ===');
console.log(txt.slice(-1500));
console.log('=== REQUESTS ==='); console.log(JSON.stringify(reqs,null,1).slice(0,2000));
console.log('=== RESPONSES ==='); console.log(JSON.stringify(resps.filter(r=>r.s>=400)));
await shot(s.page,'A5_after_save_result',{full:true});
await s.browser.close();
