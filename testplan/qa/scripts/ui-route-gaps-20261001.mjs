// Read-only active-route audit. No invented IDs or data; API catalog picks are saved.
// Run from repository root: node testplan/qa/scripts/ui-route-gaps-20261001.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv, preflight } from '../lib/env.mjs';
import { createSession } from '../lib/harness.mjs';
const env=await loadEnv();
for(const u of [env.baseUrl,env.api]) assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(u).hostname),'Loopback only');
await preflight(env);
const output=path.resolve(process.env.QA_ROUTE_EVIDENCE_DIR??'qa/2026-10-01_comprehensive-audit_route-gaps-final');
await fs.mkdir(output,{recursive:true});
const evidence=[];const boundary=[];const issues=[];
const note=(event,data)=>console.log(JSON.stringify({event,...data}));
async function click(ctx,pattern,scope='body') {
 const handle=await ctx.page.evaluateHandle((selector,rx)=>[...document.querySelector(selector).querySelectorAll('button,[role=button],a')].find(e=>{
  const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled&&new RegExp(rx).test((e.innerText+' '+(e.getAttribute('aria-label')??'')).trim());
 }),scope,pattern);
 const el=handle.asElement();assert.ok(el,`Actual control required: ${pattern}`);
 const text=await el.evaluate(e=>({text:e.innerText,aria:e.getAttribute('aria-label')}));
 await el.click();await ctx.settle(350);note('click',{role:ctx.role,pattern,...text});return text;
}
async function focus(ctx) {
 const handle=await ctx.page.evaluateHandle(()=>{
  const scope=document.querySelector('[role=dialog][aria-modal=true]')??document.querySelector('#main-content')??document.querySelector('main')??document.querySelector('.content')??document.body;
  return [...scope.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]),textarea')].find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled&&!e.readOnly;})??null;
 });
 const el=handle.asElement();if(!el)return {available:false};
 await el.click();
 const proof=await el.evaluate(e=>{if(['text','search','email','tel','url','password'].includes(e.type))e.select();return {available:true,tag:e.tagName,type:e.type,id:e.id,value:e.value,focused:document.activeElement===e,selectionStart:e.selectionStart,selectionEnd:e.selectionEnd};});
 assert.equal(proof.focused,true);return proof;
}
async function capture(ctx,label,route,width) {
 const dom=await ctx.page.evaluate(()=>({url:location.pathname+location.search,title:document.title,text:document.body.innerText,viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,headings:[...document.querySelectorAll('h1,h2,h3')].map(e=>e.innerText),dialogs:[...document.querySelectorAll('[role=dialog]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({label:e.getAttribute('aria-label'),text:e.innerText})),controls:[...document.querySelectorAll('button,input,textarea,[role=combobox]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;}).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,text:e.innerText,aria:e.getAttribute('aria-label'),id:e.id,type:e.type,value:e.value,disabled:e.disabled,box:{x:r.x,y:r.y,w:r.width,h:r.height}};})}));
 assert.ok(!dom.url.startsWith('/login'),'Authenticated page required');
 const shot=await ctx.screenshot(`${ctx.role.toLowerCase()}-${width}-${label}`);
 const domPath=shot.replace(/\.png$/, '-dom.json');await fs.writeFile(domPath,JSON.stringify(dom,null,2)+'\n');
 if(dom.documentWidth>width+1) issues.push({label,width,documentWidth:dom.documentWidth,shot,kind:'Document overflow candidate'});
 return {shot,domPath,url:dom.url,headings:dom.headings,dialogs:dom.dialogs.map(x=>x.label)};
}
async function reads(ctx,paths){return await Promise.all(paths.map(async query=>({query,...await ctx.apiGet(query)})));}
const list=(r)=>Array.isArray(r.body)?r.body:r.body?.items??[];
const requestedLabels=process.env.QA_ROUTE_LABELS?.split(',').filter(Boolean);
for(const role of ['ADMIN','MANAGER','ACCOUNTANT','OPS']) {
 const ctx=await createSession({env,role,evidenceDir:output,runId:`route-gaps-${role}`});
 assert.equal(ctx.user.role,role);
 const material=[];const previews=[];const httpErrors=[];const pendingErrors=[];
 ctx.page.on('response',response=>{
  if(response.status()<400)return;
  pendingErrors.push((async()=>{
   const contentType=response.headers()['content-type']??'';
   httpErrors.push({url:response.url(),status:response.status(),method:response.request().method(),resourceType:response.request().resourceType(),body:/json|text/.test(contentType)?(await response.text()).slice(0,1000):`Nontext response ${contentType}`});
  })());
 });
 await ctx.page.setRequestInterception(true);
 ctx.page.on('request',r=>{
  if(['POST','PUT','PATCH','DELETE'].includes(r.method())) {
   const u=new URL(r.url());
   if(r.method()==='POST'&&u.pathname==='/api/finance/billing-documents/generate') {previews.push({method:r.method(),url:r.url(),body:r.postData()});void r.continue();}
   else {material.push({method:r.method(),url:r.url()});void r.abort('blockedbyclient');}
  } else void r.continue();
 });
 try {
  const cases=[];
  if(role==='ADMIN') {
   const discovered=await reads(ctx,['/trailers?limit=100','/trucks?limit=100','/customers?limit=100','/debit-note-templates?limit=100']);
   for(const r of discovered)assert.equal(r.status,200);
   const trailer=list(discovered[0]).find(x=>x.licensePlate);const truck=list(discovered[1]).find(x=>x.licensePlate);const customer=list(discovered[2]).find(x=>x.name);const template=list(discovered[3]).find(x=>x.name);
   assert.ok(trailer&&truck&&customer&&template,'Existing catalog rows required');
   await fs.writeFile(path.join(output,'admin-id-discovery.json'),JSON.stringify(discovered,null,2)+'\n');
   const docs=`/finance/billing-documents?entityType=CUSTOMER&entityId=${customer.id}&type=DEBIT_NOTE`;
   cases.push(
    {label:'trailer-tires',route:`/fleet/trailers/${trailer.id}/tires`,expected:trailer.licensePlate,proof:[`/trailers/${trailer.id}`,'/fleet/tires?limit=1000'],action:'tire'},
    {label:'trip-create',route:'/trips/new',expected:'Tạo chuyến',proof:[`/customers/${customer.id}`],action:'cancel'},
    {label:'customer-profile',route:`/customers/${customer.id}`,expected:customer.name,proof:[`/customers/${customer.id}`],action:'profile'},
    {label:'customer-billing-create',route:`/customers/${customer.id}/billing/new`,expected:'Giấy báo nợ',proof:[`/customers/${customer.id}`,docs],action:'billing'},
    {label:'debt-billing-create',route:`/debt/${customer.id}/billing/new`,expected:'Giấy báo nợ',proof:[`/customers/${customer.id}`,docs],action:'billing'},
    {label:'shipment-create',route:'/shipments/new',expected:'lô hàng',proof:[`/customers/${customer.id}`],action:'shipment'},
    {label:'truck-owners',route:`/config/trucks/${truck.id}/owners`,expected:truck.licensePlate,proof:[`/trucks/${truck.id}`,'/truck-cap?limit=100'],action:'owner'},
    {label:'debit-template-edit',route:`/config/debit-note-templates/${template.id}`,expected:template.name,proof:[`/debit-note-templates/${template.id}`],action:'template'}
   );
  } else if(role==='MANAGER') {
   const recorded=JSON.parse(await fs.readFile('qa/2026-10-01_workflow-audit_route-captures.json','utf8')).filter(row=>row.role==='MANAGER');
   const edit=recorded.find(row=>/\/trips\/\d+\/edit$/.test(new URL(row.url).pathname));
   const shipment=recorded.find(row=>/\/shipments\/\d+$/.test(new URL(row.url).pathname));assert.ok(edit&&shipment);
   const editRoute=new URL(edit.url).pathname;const shipmentRoute=new URL(shipment.url).pathname;
   cases.push(
    {label:'trip-edit-existing',route:editRoute,expected:'QA-WF04-114144',proof:[editRoute.replace(/\/edit$/,'')],action:'focus'},
    {label:'shipment-detail-existing',route:shipmentRoute,expected:'QA-WF04-114144',proof:[shipmentRoute],action:'focus'}
   );
  } else if(role==='ACCOUNTANT') {
   assert.ok(ctx.user.capabilities?.includes('recoverable_costs.read'),'Real recoverable capability required');
   cases.push(
    {label:'fuel-evidence',route:'/accounting/fuel-evidence',expected:'OCR nhiên liệu',proof:['/ocr/fuel-evidence-reviews?page=1&limit=20'],action:'fuel'},
    {label:'recoverable-costs',route:'/recoverable-costs',expected:'Chi phí',proof:['/recoverable-costs?page=1&limit=100'],action:'focus'}
   );
  } else {
   const recorded=JSON.parse(await fs.readFile('qa/2026-10-01_workflow-audit_route-captures.json','utf8')).filter(row=>row.role==='OPS');
   const detail=recorded.find(row=>/\/my-forwarder-trips\/\d+$/.test(new URL(row.url).pathname));assert.ok(detail);
   const detailRoute=new URL(detail.url).pathname;const id=detailRoute.split('/').at(-1);
   cases.push(
    {label:'ops-owned-trips',route:'/my-forwarder-trips',expected:'QA-ID02-OPS-130955',proof:['/forwarder/me/trips'],action:'focus'},
    {label:'ops-owned-trip-detail',route:detailRoute,expected:'QA-ID02-OPS-130955',proof:[`/forwarder/me/trips/${id}`],action:'focus'},
    {label:'legacy-settlement-create',route:'/my-settlements/new',expected:'Phiếu',proof:['/forwarder/me/advance-requests?status=RECORDED&eligibleForSettlement=true','/forwarder/me/unlinked-expenses','/forwarder/me/advance-settlements?limit=100'],action:'cancel'}
   );
  }
  for(const c of cases.filter(c=>!requestedLabels||requestedLabels.includes(c.label)))for(const width of [390,768,1440]) {
   await ctx.page.setViewport({width,height:900,hasTouch:width<900});
   const before=await reads(ctx,c.proof);for(const r of before)assert.equal(r.status,200,`Readback ${r.query}`);
   await fs.writeFile(path.join(output,`${role.toLowerCase()}-${width}-${c.label}-api-before.json`),JSON.stringify(before,null,2)+'\n');
   await ctx.goto(c.route);
   const actual=await ctx.page.evaluate(()=>location.pathname);assert.equal(actual,c.route,'Route guard must admit this actual role');
   await ctx.page.waitForFunction(()=>!document.querySelector('[data-page-loader=true]'),{timeout:20000});await ctx.settle(450);
   const initial=await capture(ctx,c.label+'-initial',c.route,width);
   const body=await ctx.page.evaluate(()=>document.body.innerText+' '+[...document.querySelectorAll('input')].map(e=>e.value).join(' '));assert.ok(body.toLocaleLowerCase().includes(c.expected.toLocaleLowerCase())||body.includes('Tạo chuyến mới'),`Expected page marker ${c.expected}`);
   let opened=null;
   if(c.action==='owner'){await click(ctx,'^Thêm đối tác$');opened=await capture(ctx,c.label+'-add',c.route,width);}
   if(c.action==='tire'){await click(ctx,'^Vị trí lốp$');opened=await capture(ctx,c.label+'-positions',c.route,width);}
   if(c.action==='template'){
    const button=await ctx.page.$('nav[aria-label="Mục chỉnh sửa"] button:last-child');assert.ok(button);await button.click();await ctx.settle(200);opened=await capture(ctx,c.label+'-footer-section',c.route,width);
   }
   const focusProof=await focus(ctx);const focused=await capture(ctx,c.label+'-focused',c.route,width);
   let dismissal=null;
   if(c.action==='owner')dismissal=await click(ctx,'^Hủy$');
   if(c.action==='tire')dismissal=await click(ctx,'^Đóng$');
   if(c.action==='billing')dismissal=await click(ctx,'^Đóng$');
   if(c.action==='cancel')dismissal=await click(ctx,'^Hủy$|^Hủy bỏ$');
   if(c.action==='template')dismissal=await click(ctx,'^Quay lại$','.debit-editor-topbar');
   const after=await reads(ctx,c.proof);
   assert.deepEqual(after,before,'Persisted source rows must remain unchanged');
   assert.equal(material.length,0,'No material request permitted');
   const final=await capture(ctx,c.label+'-after',c.route,width);
   evidence.push({role,account:ctx.username,width,route:c.route,label:c.label,before,after,initial,opened,focusProof,focused,dismissal,final});
   await fs.writeFile(path.join(output,'driver-assertions.json'),JSON.stringify({evidence,boundary,issues},null,2)+'\n');
   note('page-state',{role,width,route:c.route,label:c.label,readParity:true,materialWrites:0});
  }
  await Promise.all(pendingErrors);
  boundary.push({role,account:ctx.username,material,readOnlyDraftPreviews:previews,consoleErrors:ctx.errors,httpErrors});
 } finally {
  await Promise.all(pendingErrors);
  if(!boundary.some(record=>record.role===role))boundary.push({role,account:ctx.username,material,readOnlyDraftPreviews:previews,consoleErrors:ctx.errors,httpErrors});
  await fs.writeFile(path.join(output,'driver-assertions.json'),JSON.stringify({evidence,boundary,issues},null,2)+'\n');
  await Promise.race([ctx.browser.close(),new Promise(resolve=>setTimeout(()=>{ctx.browser.process()?.kill('SIGTERM');resolve();},10000))]);
 }
}
note('complete',{states:evidence.length,activeRoutes:new Set(evidence.map(x=>x.route)).size,materialWrites:0,issues});
