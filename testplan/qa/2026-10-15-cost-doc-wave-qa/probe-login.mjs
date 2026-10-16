import { login, api, session, goto, mainText, shot, controls } from './qa-lib.mjs';

const roles = [
  ['DRIVER', 'bqhuong', '/my-trips'],
  ['OPS', 'hoangnh', '/my-orders'],
  ['ACCOUNTANT', 'hoapt', '/accounting'],
  ['DISPATCHER', 'dungnv', '/dispatch'],
];
const out = {};
for (const [role, u, home] of roles) {
  try {
    const tok = await login(u);
    const s = await session(tok);
    await goto(s.page, home);
    const txt = await mainText(s.page);
    out[role] = {
      user: u, url: s.page.url(), title: (await s.page.title()),
      mainHead: txt.slice(0, 400),
      controls: (await controls(s.page)).slice(0, 25),
      pageErrors: s.errors.slice(0, 5),
      netErrors: [...new Set(s.netErrors)].slice(0, 10),
    };
    await shot(s.page, `probe_${role.toLowerCase()}_home`);
    await s.browser.close();
  } catch (e) { out[role] = { error: String(e).slice(0, 200) }; }
}
console.log(JSON.stringify(out, null, 1));
