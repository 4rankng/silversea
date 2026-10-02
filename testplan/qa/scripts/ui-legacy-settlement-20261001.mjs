// QA-AUDIT-COVERAGE-01: one authorized real owned full-return, then read-only detail/export coverage.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadEnv,preflight} from '../lib/env.mjs';
import {createSession} from '../lib/harness.mjs';
const env=await loadEnv();await preflight(env);
for(const url of [env.api,env.baseUrl])assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname),'Local only');
const output=path.resolve('qa/2026-10-01_comprehensive-audit_legacy-settlement');await fs.mkdir(output,{recursive:true});
const proof={created:null,evidence:[],boundaries:[]};const note=(event,data)=>console.log(JSON.stringify({event,...data}));
const file=path.join(output,'created-record.json');
try{proof.created=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(proof.created){
 try{proof.creation=JSON.parse(await fs.readFile(path.join(output,'driver-assertions.json'),'utf8')).creation;}catch(e){if(e.code!=='ENOENT')throw e;}
}
async function persist(){await fs.writeFile(path.join(output,'driver-assertions.json'),JSON.stringify(proof,null,2)+'\n');}
async function capture(ctx,label){
 const dom=await ctx.page.evaluate(()=>({url:location.pathname,text:document.body.innerText,viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('button,input,textarea')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;}).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,text:e.innerText,id:e.id,type:e.type,value:e.value,disabled:e.disabled,box:{x:r.x,y:r.y,w:r.width,h:r.height}};})}));
 const shot=await ctx.screenshot(label);await fs.writeFile(shot.replace(/\.png$/,'-dom.json'),JSON.stringify(dom,null,2)+'\n');
 assert.ok(!dom.url.startsWith('/login'));assert.ok(dom.documentWidth<=dom.viewport.width+1,'Document must fit viewport');
 return {shot,dom};
}
async function actualClick(ctx,pattern,scope='body'){
 const h=await ctx.page.evaluateHandle((scope,pattern)=>[...document.querySelector(scope).querySelectorAll('button,a')].find(e=>!e.disabled&&new RegExp(pattern).test(e.innerText.trim())),scope,pattern);const e=h.asElement();assert.ok(e,pattern);await e.click();await ctx.settle(300);
}
async function read(ctx,queries){return await Promise.all(queries.map(async query=>({query,...await ctx.apiGet(query)})));}
for(const role of ['OPS','ACCOUNTANT']){
 const ctx=await createSession({env,role,evidenceDir:output,runId:'legacy-settlement-'+role});assert.equal(ctx.user.role,role);
 const writes=[],exports=[],pending=[];let createdThisRun=false;await ctx.page.setCacheEnabled(false);await ctx.page.setRequestInterception(true);
 ctx.page.on('request',r=>{
  if(['POST','PUT','PATCH','DELETE'].includes(r.method())){
   const url=new URL(r.url());const body=r.postData()?JSON.parse(r.postData()):null;
   const allowed=role==='OPS'&&!proof.created&&writes.length===0&&r.method()==='POST'&&url.pathname==='/api/forwarder/me/advance-settlements'&&body?.totalExpenseAmount===0&&body?.refundAmount===3500000&&JSON.stringify(body.advanceRequestIds)==='[93]'&&(!body.tripExpenseIds||body.tripExpenseIds.length===0)&&Boolean(r.headers()['idempotency-key']);
   writes.push({method:r.method(),url:r.url(),body,allowed,hasIdempotencyKey:Boolean(r.headers()['idempotency-key'])});
   if(allowed)void r.continue();else void r.abort('blockedbyclient');
  }else void r.continue();
 });
 ctx.page.on('response',r=>{if(/\/advance-settlements\/\d+\/export$/.test(new URL(r.url()).pathname))pending.push((async()=>{const url=new URL(r.url());const format=url.searchParams.get('format');const browserBuffer=await r.buffer();const direct=await fetch(`${env.api}/`+url.pathname.replace(/^\/api\//,'')+url.search,{headers:{Authorization:`Bearer ${ctx.token}`,'Cache-Control':'no-cache'}});const buffer=Buffer.from(await direct.arrayBuffer());const exportFile=path.join(output,`${role.toLowerCase()}-${ctx.page.viewport().width}-export.${format==='html'?'html':'xlsx'}`);await fs.writeFile(exportFile,buffer);exports.push({url:r.url(),status:r.status(),browserBytes:browserBuffer.length,browserContentType:r.headers()['content-type'],byteProofKind:'Authenticated no-cache GET after actual browser export click',byteProofStatus:direct.status,contentType:direct.headers.get('content-type'),bytes:buffer.length,format,file:exportFile});})());});
 try{
  if(role==='OPS'&&!proof.created){
   assert.equal(process.env.QA_AUTHORIZE_OWNED_FULL_RETURN,'93','Explicit local authorized advance guard required');
   const queries=['/forwarder/me/advance-requests?status=RECORDED&eligibleForSettlement=true','/forwarder/me/unlinked-expenses','/forwarder/me/advance-settlements?limit=100','/forwarder/me/advance-balance'];
   const before=await read(ctx,queries);for(const r of before)assert.equal(r.status,200);
   const advance=before[0].body.items.find(x=>x.id===93);assert.ok(advance);assert.equal(advance.requesterId,ctx.user.id);assert.equal(Number(advance.amount),3500000);assert.equal(Number(advance.fundedAmount),3500000);assert.equal(before[1].body.items.length,0);
   await fs.writeFile(path.join(output,'create-api-before.json'),JSON.stringify(before,null,2)+'\n');
   await ctx.page.setViewport({width:390,height:900,hasTouch:true});await ctx.goto('/my-settlements/new');
   const initial=await capture(ctx,'ops390-create-existing-advance');
   const label=await ctx.page.evaluateHandle(reason=>[...document.querySelectorAll('label.fset-check-item')].find(e=>e.innerText.includes(reason)),advance.reason);const el=label.asElement();assert.ok(el);await el.click();
   const refund=await ctx.page.$('input.fset-input[type=number]');assert.ok(refund);await refund.click({clickCount:3});await ctx.page.keyboard.press('Backspace');await ctx.page.keyboard.type('3500000');
   const selected=await ctx.page.evaluate(()=>({selected:document.querySelectorAll('.fset-check-item input:checked').length,refund:document.querySelector('input.fset-input[type=number]').value,summary:document.querySelector('.fset-summary').innerText}));assert.equal(selected.selected,1);assert.equal(selected.refund,'3500000');
   const draft=await capture(ctx,'ops390-full-return-draft');
   const response=ctx.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/forwarder/me/advance-settlements');
   await actualClick(ctx,'^Ghi nhận phiếu thanh toán$');const actual=await response;assert.ok(actual.status()===200||actual.status()===201);const created=await actual.json();assert.ok(created.id&&created.code);proof.created=created;
   await fs.writeFile(file,JSON.stringify(created,null,2)+'\n');createdThisRun=true;
   await ctx.page.waitForFunction(()=>document.body.innerText.includes('Phiếu đã tạo thành công!'));const success=await capture(ctx,'ops390-create-success');
   const after=await read(ctx,queries);for(const r of after)assert.equal(r.status,200);assert.ok(!after[0].body.items.some(x=>x.id===93));assert.equal(Number(before[3].body.outstanding)-Number(after[3].body.outstanding),3500000);assert.deepEqual(before[1],after[1]);
   proof.creation={account:ctx.username,role,before,after,initial,draft,selected,success,request:writes[0],response:{status:actual.status(),body:created}};await persist();
   await actualClick(ctx,'^Xem chi tiết$');assert.equal(await ctx.page.evaluate(()=>location.pathname),'/my-settlements/'+created.id);
   note('created',{code:created.code,id:created.id,advanceId:93,totalExpense:0,refund:3500000,oneMaterialWrite:true});
  }
  assert.ok(proof.created,'Actual created record required');
  const id=proof.created.id;const route=role==='OPS'?'/my-settlements/'+id:'/settlements/'+id;const api=role==='OPS'?'/forwarder/me/advance-settlements/'+id:'/advance-settlements/'+id;
  for(const width of [390,768,1440]){
   await ctx.page.setViewport({width,height:900,hasTouch:width<900});const before=await ctx.apiGet(api);assert.equal(before.status,200);assert.equal(before.body.forwarderId,1676);assert.equal(before.body.status,'RECORDED');assert.equal(Number(before.body.refundAmount),3500000);assert.equal(Number(before.body.totalExpenseAmount),0);assert.equal(before.body.linkedRequests.length,1);assert.equal(before.body.linkedRequests[0].id,93);
   await ctx.goto(route);const opened=await capture(ctx,role.toLowerCase()+width+'-detail');assert.equal(opened.dom.url,route);assert.ok(opened.dom.text.includes(proof.created.code));
   await actualClick(ctx,'^In$','.settlement-detail__header-actions');await ctx.page.waitForSelector('.print-preview-overlay');const preview=await capture(ctx,role.toLowerCase()+width+'-print-preview');
   const frame=ctx.page.frames().find(f=>f!==ctx.page.mainFrame());assert.ok(frame);const frameText=await frame.evaluate(()=>document.body.innerText);assert.ok(frameText.includes(proof.created.code));assert.ok(frameText.includes('3.500.000'));await fs.writeFile(path.join(output,`${role.toLowerCase()}-${width}-preview-text.txt`),frameText+'\n');
   await actualClick(ctx,'^Đóng$','.print-preview-toolbar');await ctx.page.waitForFunction(()=>!document.querySelector('.print-preview-overlay'));const closed=await capture(ctx,role.toLowerCase()+width+'-preview-closed');
   const xlsxResponse=ctx.page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`/advance-settlements/${id}/export`)&&new URL(r.url()).searchParams.get('format')==='xlsx');await actualClick(ctx,'^Excel$','.settlement-detail__header-actions');assert.equal((await xlsxResponse).status(),200);await Promise.all(pending);
   const after=await ctx.apiGet(api);assert.deepEqual(after,before);const exported=await capture(ctx,role.toLowerCase()+width+'-excel-readonly');await actualClick(ctx,'^Trở về$','.settlement-detail__header-actions');const returned=await capture(ctx,role.toLowerCase()+width+'-back');
   proof.evidence.push({role,account:ctx.username,width,route,api,before,after,opened,preview,closed,exported,returned,frameTextFile:`${role.toLowerCase()}-${width}-preview-text.txt`});await persist();note('detail',{role,width,route,readParity:true,exports:exports.filter(e=>e.file.includes(`-${width}-`))});
  }
  assert.ok(writes.every(x=>x.allowed));assert.equal(writes.length,createdThisRun?1:0);assert.equal(ctx.errors.length,0);assert.equal(exports.length,6);assert.ok(exports.every(x=>x.status===200&&x.byteProofStatus===200&&x.bytes>500&&/text\/html|spreadsheetml/.test(x.contentType)));proof.boundaries.push({role,account:ctx.username,writes,exports,errors:ctx.errors});
 }finally{await persist();await ctx.browser.close();}
}
note('complete',{created:proof.created,evidence:proof.evidence.length,boundaries:proof.boundaries.map(x=>({role:x.role,writes:x.writes.length,exports:x.exports.length}))});
