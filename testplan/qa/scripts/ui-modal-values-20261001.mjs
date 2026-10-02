// UI19: real shared dialog corners, complete selected field values, picker/focus/Cancel.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadEnv,preflight} from '../lib/env.mjs';
import {createSession} from '../lib/harness.mjs';
const env=await loadEnv();await preflight(env);for(const u of [env.baseUrl,env.api])assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(u).hostname));
const output=path.resolve(process.env.QA_MODAL_OUTPUT_DIR || 'qa/2026-10-01_comprehensive-audit_ui19-final');await fs.mkdir(output,{recursive:true});
const ctx=await createSession({env,role:'ADMIN',evidenceDir:output,runId:'ui19-final'});const evidence=[],writes=[];assert.equal(ctx.user.role,'ADMIN');
await ctx.page.setRequestInterception(true);ctx.page.on('request',r=>{if(['POST','PUT','PATCH','DELETE'].includes(r.method())){writes.push({url:r.url(),method:r.method()});void r.abort('blockedbyclient');}else void r.continue();});
async function click(pattern,scope='body'){
 const h=await ctx.page.evaluateHandle((rx,scope)=>[...document.querySelector(scope).querySelectorAll('button')].find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled&&new RegExp(rx).test((e.innerText+' '+(e.getAttribute('aria-label')??'')).trim());}),pattern,scope);const e=h.asElement();assert.ok(e,pattern);await e.click();await ctx.settle(200);return e;
}
async function capture(label){
 const dom=await ctx.page.evaluate(()=>{const box=e=>{if(!e)return null;const s=getComputedStyle(e),r=e.getBoundingClientRect();return{text:e.innerText,box:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height},radius:{tl:s.borderTopLeftRadius,tr:s.borderTopRightRadius,bl:s.borderBottomLeftRadius,br:s.borderBottomRightRadius},overflow:s.overflow,paddingBlock:s.paddingBlock,lineHeight:s.lineHeight};};const selected=[...document.querySelectorAll('.modal__body [data-uui-select-value] section p')].map(e=>{const range=document.createRange();range.selectNodeContents(e);return{...box(e),lines:[...range.getClientRects()].filter(r=>r.width>0).map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})),boundary:box(e.closest('[data-uui-control=select]'))};});return{url:location.pathname,text:document.querySelector('[role=dialog]')?.innerText??document.body.innerText,documentWidth:document.documentElement.scrollWidth,viewport:{width:innerWidth,height:innerHeight},content:box(document.querySelector('.modal__content')),head:box(document.querySelector('.modal__head')),foot:box(document.querySelector('.modal__foot')),selected,focus:{tag:document.activeElement.tagName,label:document.activeElement.getAttribute('aria-label')},listbox:[...document.querySelectorAll('[role=listbox]')].map(e=>box(e)),popovers:[...document.querySelectorAll('.ds-uui-select__popover')].map(e=>box(e)),options:[...document.querySelectorAll('[role=option] [slot=label]')].map(e=>{const range=document.createRange();range.selectNodeContents(e);return{...box(e),lines:[...range.getClientRects()].filter(r=>r.width>0).map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})),option:box(e.closest('[role=option]'))};})};});
 const shot=await ctx.screenshot(label);await fs.writeFile(shot.replace(/\.png$/,'-dom.json'),JSON.stringify(dom,null,2)+'\n');return{shot,dom};
}
try{
 for(const width of [390,768,1440])for(const item of [{label:'ports',route:'/config/ports',query:'/ports?limit=100'},{label:'expense-categories',route:'/config/expense-categories',query:'/expense-categories?limit=100'},{label:'password',route:'/config/ports',query:'/auth/me'}]){
  if(process.env.QA_MODAL_POPOVER_ONLY==='1'&&item.label==='password')continue;
  await ctx.page.setViewport({width,height:900,hasTouch:width<900});const before=await ctx.apiGet(item.query);assert.equal(before.status,200);await ctx.goto(item.route);
  let opener;
  if(item.label==='password'){
   const sidebarVisible=await ctx.page.$eval('button[aria-label="Menu người dùng"]',e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;});if(!sidebarVisible)await click('Mở menu điều hướng');await click('Menu người dùng');opener=await click('^Đổi mật khẩu');
  }else opener=await click('^Thêm mới');
  await ctx.page.waitForSelector('.modal__content');await ctx.settle(450);const opened=await capture(`${width}-${item.label}-opened`);const d=opened.dom;assert.equal(d.head.radius.tl,d.content.radius.tl);assert.equal(d.head.radius.tr,d.content.radius.tr);if(d.foot){assert.equal(d.foot.radius.bl,d.content.radius.bl);assert.equal(d.foot.radius.br,d.content.radius.br);}assert.ok(d.documentWidth<=width+1);
  for(const p of d.selected){assert.ok(p.boundary.box.height<=40.5,'stacked selected field stays within house40px ceiling');for(const line of p.lines){assert.ok(line.left>=p.boundary.box.left-1&&line.right<=p.boundary.box.right+1);assert.ok(line.top>=p.boundary.box.top-1&&line.bottom<=p.boundary.box.bottom+1);}}
  let picker=null,focus=null;
  const trigger=await ctx.page.$('.modal__body [data-uui-control=select]');
  if(trigger){await trigger.click();await ctx.page.waitForSelector('[role=listbox]');await ctx.settle(450);picker=await capture(`${width}-${item.label}-picker`);assert.ok(picker.dom.listbox.length>0);assert.ok(picker.dom.documentWidth<=width+1);for(const popover of picker.dom.popovers){assert.ok(popover.box.left>=15&&popover.box.right<=width-15);}for(const option of picker.dom.options)for(const line of option.lines){assert.ok(line.left>=option.option.box.left-1&&line.right<=option.option.box.right+1);}await ctx.page.keyboard.press('ArrowDown');await ctx.page.keyboard.press('Escape');await ctx.settle(180);assert.ok(await ctx.page.$('.modal__content'));assert.equal(await ctx.page.$('[role=listbox]'),null);await ctx.page.keyboard.press('Tab');focus=await capture(`${width}-${item.label}-focus`);}
  else{await ctx.page.keyboard.press('Tab');focus=await capture(`${width}-${item.label}-focus`);}
  await click('^Hủy$','.modal__content');await ctx.page.waitForSelector('.modal__content',{hidden:true});const cancelled=await capture(`${width}-${item.label}-cancelled`);const after=await ctx.apiGet(item.query);assert.deepEqual(after,before);assert.equal(writes.length,0);
  const focusReturn=await opener.evaluate(e=>({connected:e.isConnected,focused:document.activeElement===e}));if(item.label!=='password')assert.equal(focusReturn.focused,true);
  evidence.push({role:ctx.role,account:ctx.username,width,...item,before,after,opened,picker,focus,cancelled,focusReturn});await fs.writeFile(path.join(output,'driver-assertions.json'),JSON.stringify({evidence,writes,errors:ctx.errors},null,2)+'\n');console.log(JSON.stringify({width,dialog:item.label,corners:true,selectedHeights:d.selected.map(p=>p.boundary.box.height),parity:true,writes:0}));
 }
 assert.equal(ctx.errors.length,0);console.log(JSON.stringify({complete:true,states:evidence.length,writes:0,errors:ctx.errors}));
}finally{await fs.writeFile(path.join(output,'driver-assertions.json'),JSON.stringify({evidence,writes,errors:ctx.errors},null,2)+'\n');await ctx.browser.close();}
