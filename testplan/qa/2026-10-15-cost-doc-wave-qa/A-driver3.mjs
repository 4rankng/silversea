import { login, session, goto, mainText, shot, fields, log, sleep } from './qa-lib.mjs';
const tok = await login('bqhuong');
const s = await session(tok);
await goto(s.page, '/my-trips/123');
await s.page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>/Thêm chi phí/.test(b.innerText)).click());
await sleep(1000);

const sel = await s.page.evaluate(()=>{
  const e=[...document.querySelectorAll('select')].find(x=>/Loại chứng từ|chứng từ/i.test(
    (document.querySelector(`label[for="${CSS.escape(x.id)}"]`)?.innerText||'')+' '+(x.getAttribute('aria-label')||'')+' '+x.name));
  if(!e) return null;
  return {value:e.value, dis:e.disabled, opts:[...e.options].map(o=>({v:o.value,t:o.text.trim(),sel:o.selected,dis:o.disabled}))};
});
console.log('EVIDENCE SELECT:', JSON.stringify(sel,null,1));

// Switch fee type to an INVOICED catalog fee and re-check
const changed = await s.page.evaluate(async ()=>{
  const cb=[...document.querySelectorAll('input')].find(i=>/Loại chi phí/i.test(
    (document.querySelector(`label[for="${CSS.escape(i.id)}"]`)?.innerText||'')+' '+(i.getAttribute('aria-label')||'')));
  if(!cb) return 'no combobox';
  cb.focus();
  cb.setAttribute('data-qa','fee');
  return 'focused';
});
console.log('combobox:',changed);
await s.page.keyboard.type('nâng');
await sleep(1500);
const opts = await s.page.evaluate(()=>[...document.querySelectorAll('[role="option"]')].map(o=>o.innerText.trim()).slice(0,10));
console.log('OPTIONS:',JSON.stringify(opts));
if (opts.length) {
  await s.page.evaluate(()=>document.querySelector('[role="option"]').click());
  await sleep(1000);
}
const sel2 = await s.page.evaluate(()=>{
  const e=[...document.querySelectorAll('select')].find(x=>/chứng từ/i.test(
    (document.querySelector(`label[for="${CSS.escape(x.id)}"]`)?.innerText||'')+' '+(x.getAttribute('aria-label')||'')+' '+x.name));
  return e? {value:e.value, dis:e.disabled, opts:[...e.options].map(o=>({v:o.value,t:o.text.trim(),dis:o.disabled}))}:null;
});
console.log('AFTER PICK Phí nâng ->', JSON.stringify(sel2,null,1));
console.log('TEXT:', (await mainText(s.page)).slice(-1200));
await shot(s.page,'A3_evidence_lock_after_nang',{full:true});
await s.browser.close();
