import { login, api, session, goto, shot, sleep, mainText, controls } from './qa-lib.mjs';
const tok = await login('hoapt');
const s = await session(tok);
await goto(s.page,'/accounting/expenses?view=pending-advances');
console.log('URL',s.page.url());
const txt = await mainText(s.page);
console.log('=== PENDING ADVANCES ===\n'+txt.slice(0,2500));
console.log('CONTROLS:',JSON.stringify((await controls(s.page)).filter(c=>/duyệt|từ chối|tab|tạm ứng/i.test(c.text))));
await shot(s.page,'B6_pending_advances',{full:true});
console.log('PAGE ERR', s.errors.slice(0,5), 'NET', [...new Set(s.netErrors)]);
await s.browser.close();

// OPS wallet
const t2 = await login('hoangnh');
const s2 = await session(t2);
await goto(s2.page,'/ops/wallet');
console.log('=== OPS WALLET ===\n'+(await mainText(s2.page)).slice(0,2200));
await shot(s2.page,'B7_ops_wallet',{full:true});
await s2.browser.close();
