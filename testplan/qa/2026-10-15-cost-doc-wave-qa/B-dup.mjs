import { login, session, goto, shot, sleep } from './qa-lib.mjs';
const OPS2 = process.argv[2] ?? 'hungld';
const tok = await login(OPS2);
const s = await session(tok);
const claimants=[];
s.page.on('response',async r=>{const u=new URL(r.url()).pathname; if(u.includes('cont-claimants')){try{claimants.push({s:r.status(),b:(await r.text()).slice(0,400)});}catch{}}});
await goto(s.page,'/ops/orders');
for (const inp of await s.page.$$('input')) { const i=await inp.evaluate(e=>({v:e.value,t:e.type})); if(i.v==='15'&&i.t==='text'){await inp.click();await inp.evaluate(e=>e.select?.());await s.page.keyboard.press('Backspace');await s.page.keyboard.type('16');await s.page.keyboard.press('Enter');break;} }
await sleep(2200);
await s.page.evaluate(()=>{const tr=[...document.querySelectorAll('tbody tr')].find(r=>/DNKM13336/.test(r.innerText)); if(!tr) throw new Error('no row'); [...tr.querySelectorAll('button')].find(x=>/Khai chi phí/i.test(x.innerText)).click();});
await sleep(1600);
await s.page.selectOption('select','MSDU1245780');
await sleep(2000);
const warn = await s.page.evaluate(()=>{
  const d=document.querySelector('[role="dialog"], .modal, dialog');
  const all=[...document.querySelectorAll('[role=alert], .alert, .warn, .modal, dialog, [class*=warn]')]
    .filter(e=>{const r=e.getBoundingClientRect(); return r.width>0&&r.height>0;})
    .map(e=>({role:e.getAttribute('role')||'',cls:(e.className||'').toString().slice(0,40),t:e.innerText.trim().replace(/\s+/g,' ').slice(0,220)}))
    .filter(x=>/đã có|nhập trước|tiếp tục/i.test(x.t));
  const nestedDialogs=[...document.querySelectorAll('[role=dialog]')].length;
  return {matches:all, dialogCount:nestedDialogs, modalText: d?d.innerText.replace(/\n{2,}/g,' | ').slice(0,700):null};
});
console.log('WARN:',JSON.stringify(warn,null,1));
console.log('CLAIMANTS API:',JSON.stringify(claimants,null,1));
await shot(s.page,'B5_dup_warning_second_ops',{full:true});
await s.browser.close();
