import { login, session, goto, mainText, shot, controls, fields, log, sleep } from './qa-lib.mjs';
const tok = await login('bqhuong');
const s = await session(tok);
await goto(s.page, '/my-trips/123');

// 1) Inspect the existing Tiền đường rows region
const road = await s.page.evaluate(()=>{
  const t = document.body.innerText;
  const i = t.indexOf('Chi phí lô hàng & tiền đường');
  return t.slice(i, i+2500);
});
console.log('=== COST REGION ===\n'+road);

// 2) Click "Thêm chi phí"
const btn = await s.page.evaluateHandle(()=>[...document.querySelectorAll('button')].find(b=>/Thêm chi phí/.test(b.innerText)));
await btn.asElement().click();
await sleep(1200);
console.log('=== AFTER CLICK Thêm chi phí ===');
console.log((await mainText(s.page)).slice(-3000));
console.log('--- FIELDS ---'); console.log(JSON.stringify(await fields(s.page),null,0));
console.log('--- CONTROLS ---'); console.log(JSON.stringify((await controls(s.page)).slice(-30)));
await shot(s.page,'A2_add_cost_form',{full:true});
log('A2_fields', await fields(s.page));
console.log('ERR',s.errors.slice(0,5),'NET',[...new Set(s.netErrors)]);
await s.browser.close();
