import { login, session, goto, shot, sleep, mainText } from './qa-lib.mjs';
const tok = await login('hoapt');
const s = await session(tok);
await goto(s.page,'/accounting/expenses?view=work');
console.log('URL',s.page.url());
const t = await mainText(s.page);
console.log('HEAD:\n'+t.slice(0,1200));
const btns = await s.page.evaluate(()=>[...document.querySelectorAll('button')].map(b=>b.innerText.trim().replace(/\s+/g,' ')).filter(x=>x&&/thêm|thêm dòng|khoản chi/i.test(x)));
console.log('BTNS:',JSON.stringify(btns.slice(0,15)));
await shot(s.page,'C0_expenses_work',{full:true});
// open "Thêm khoản chi"
const ok = await s.page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Thêm khoản chi/i.test(x.innerText)); if(b){b.click();return b.innerText.trim();}return null;});
console.log('opened:',ok);
await sleep(1800);
const d = await s.page.evaluate(()=>{const dd=[...document.querySelectorAll('[role="dialog"], .modal, .drawer, dialog')].pop(); return dd?{txt:dd.innerText.replace(/\n{2,}/g,' | ').slice(0,1600),ins:[...dd.querySelectorAll('input,textarea,select')].map(e=>({t:e.type||e.tagName,l:(document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.innerText||e.getAttribute('aria-label')||e.closest('label')?.innerText||'').trim().replace(/\s+/g,' ').slice(0,40),v:(e.value||'').slice(0,30)})),btns:[...dd.querySelectorAll('button')].map(b=>b.innerText.trim().replace(/\s+/g,' ')).filter(Boolean)}:null;});
console.log('DRAWER:',JSON.stringify(d,null,1).slice(0,3500));
await shot(s.page,'C1_them_khoan_chi_drawer',{full:true});
console.log('ERR',s.errors.slice(0,4),'NET',[...new Set(s.netErrors)]);
await s.browser.close();
