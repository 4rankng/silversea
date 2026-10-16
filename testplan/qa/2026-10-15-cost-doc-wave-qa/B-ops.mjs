import { login, api, session, goto, shot, sleep, mainText, controls, log } from './qa-lib.mjs';
const tok = await login('hoangnh');
const s = await session(tok);
await goto(s.page,'/my-orders');
const btns = await controls(s.page);
console.log('OPS ORDERS CONTROLS:', JSON.stringify(btns.filter(b=>/khai|chi phí|cost|tạm ứng|ứng/i.test(b.text))));
await shot(s.page,'B0_ops_orders',{full:true});
// open "Khai chi phí"
const opened = await s.page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Khai chi phí/i.test(x.innerText)); if(b){b.click();return true;} return false;});
console.log('opened modal:',opened);
await sleep(1500);
if(opened){
  console.log('=== MODAL ===');
  console.log((await mainText(s.page)).slice(-2200));
  const sel = await s.page.evaluate(()=>[...document.querySelectorAll('select')].map(e=>({val:e.value,opts:[...e.options].map(o=>o.text.trim())})));
  console.log('SELECTS:', JSON.stringify(sel,null,1).slice(0,1800));
  await shot(s.page,'B1_ops_expense_modal',{full:true});
}
await s.browser.close();
