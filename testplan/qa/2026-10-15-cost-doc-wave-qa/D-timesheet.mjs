import { login, api, session, goto, shot, sleep, mainText } from './qa-lib.mjs';
const tok = await login('dungnv');
const s = await session(tok);
await goto(s.page,'/timesheet');
console.log('URL',s.page.url());
console.log('=== TIMESHEET ===');
console.log((await mainText(s.page)).slice(0,1800));
await shot(s.page,'D1_timesheet_grid',{full:true});
console.log('ERR',s.errors.slice(0,5),'NET',[...new Set(s.netErrors)]);
// API: does a month exist?
const r = await api(tok,'GET','/timesheet/months?driverId=1&year=2026&month=10');
console.log('MONTHS:',r.status, JSON.stringify(r.data).slice(0,400));
await s.browser.close();
