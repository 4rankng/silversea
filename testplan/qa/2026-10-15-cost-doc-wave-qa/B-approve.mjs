import { login, session, goto, shot, sleep, mainText } from './qa-lib.mjs';
const tok = await login('hoapt');
const s = await session(tok);
const rq=[],e1=[];
s.page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))rq.push({m:r.method(),u:new URL(r.url()).pathname});});
s.page.on('response',async r=>{if(r.url().includes('/api/')&&r.status()>=400){let b='';try{b=(await r.text()).slice(0,250);}catch{}e1.push({s:r.status(),u:new URL(r.url()).pathname,b});}});
await goto(s.page,'/accounting/expenses?view=pending-advances');
await shot(s.page,'B6_pending_advances_queue',{full:true});
// find the smallest ancestor of MY reason that contains a "Phê duyệt" button
const ok = await s.page.evaluate(()=>{
  const reasonNode=[...document.querySelectorAll('*')].find(e=>e.children.length===0 && /cost-doc wave/i.test(e.textContent||''));
  if(!reasonNode) return 'no reason node';
  let n=reasonNode;
  for(let i=0;i<10;i++){ n=n.parentElement; if(!n) break;
    const b=[...n.querySelectorAll('button')].filter(x=>x.innerText.trim()==='Phê duyệt');
    if(b.length===1){ b[0].click(); return 'clicked-scoped'; } }
  return 'not scoped';
});
console.log('approve:',ok);
await sleep(2500);
console.log('REQS:',JSON.stringify(rq));
console.log('ERRS:',JSON.stringify(e1));
console.log('AFTER:\n'+(await mainText(s.page)).slice(0,700));
await shot(s.page,'B12_after_approve_mine',{full:true});
await s.browser.close();
