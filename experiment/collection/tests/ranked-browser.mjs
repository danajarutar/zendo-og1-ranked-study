import {checkpoints} from './fixtures.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/dr571/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=resolve(import.meta.dirname,'..');
const built=resolve(root,'.wrangler/builds/review');
const server=createServer(async(req,res)=>{try{let rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/zendo-og1-ranked-study\/review\//,'');if(!rel||rel.endsWith('/'))rel+='index.html';const file=resolve(built,rel);if(!file.startsWith(built+sep))throw Error('Invalid path');res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=process.argv[2]||'http://127.0.0.1:'+server.address().port+'/zendo-og1-ranked-study';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const report=[];
try {
 for(const variant of ['adult','child']) for(const practice of [false,true]) {
  const participant='1234567890abcdef1234567890abcdef';const records=checkpoints(variant,participant);
  const position=records.findIndex(r=>r.checkpoint_type===(practice?'practice_active_test':'active_test')&&(!practice||r.session.practice_demo.active_tests.length===3));
  const prior=records[position-1];const next=records[position];const draft=practice?next.session.practice_demo.active_tests.at(-1):next.session.trials[0].active_tests[0];
  const envelope={session:prior.session,phase:practice?'practiceEditor':'editor',trialPosition:0,editorScene:draft.scene,anchorSceneId:null,sourceChoice:'fresh',selectedIds:[],constructionStartedAt:draft.construction_started_at,actionEvents:[],hypothesis:'Ne vem',finalGuessDraft:'',operations:['necessity'],primaryOperation:'necessity',otherOperation:'',additionalOperations:'',checkpointRevision:prior.checkpoint_revision,instructionPage:0,instructionLayoutVersion:3,viewedAdditionalExamples:[],comprehensionAnswers:{},quizReviewed:false,savedAt:new Date().toISOString()};
  const key='zendo-og1-ranked-review-collection:'+variant+':ranked-'+practice;
  const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(({key,participant,envelope})=>{if(!localStorage.getItem(key)){localStorage.setItem(key+':id',participant);localStorage.setItem(key,JSON.stringify(envelope));}},{key,participant,envelope});
  await page.goto(base+'/review/?variant='+variant+'&stage=full&run=ranked-'+practice);
  await page.getByRole('button',{name:/Nadaljujte shranjeno|Nadaljuj shranjeno/}).click();
  const extra=page.locator('[name=additional_operations_ranked_text]');await extra.waitFor();
  assert.equal(await page.locator('input[name=operation]').count(),6);
  const raw='  2. Preverim nujnost – čšž\n3. Poiščem novo pravilo  ';
  await extra.fill(raw);await page.locator('input[name=operation]').nth(1).check();assert.equal(await extra.inputValue(),raw);
  await page.reload();await page.getByRole('button',{name:/Nadaljujte shranjeno|Nadaljuj shranjeno/}).click();assert.equal(await extra.inputValue(),raw);
  assert.equal(await page.locator('input[name=operation]:checked').count(),1);
  await extra.scrollIntoViewIfNeeded();await page.screenshot({path:resolve(root,'test-results/ranked-'+variant+'-'+practice+'.png')});
  await page.getByRole('button',{name:/^▷.*Preizkus/}).click();
  await page.locator('.inline-feedback-status').waitFor();assert.equal(await extra.isDisabled(),true);
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
  const record=practice?saved.session.practice_demo.active_tests.at(-1):saved.session.trials[0].active_tests.at(-1);
  assert.equal(record.additional_operations_ranked_text,raw);assert.equal(record.operations_selected.length,1);
  await page.locator('.inline-feedback-status').waitFor({state:'detached',timeout:10000});
  if(!practice)assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).additionalOperations,key),'');
  assert.deepEqual(errors,[]);report.push({variant,practice,draft_reload:true,verbatim_save:true,primary_single:true,pass:true});await context.close();
 }
} finally {await browser.close();await new Promise(r=>server.close(r));}
await writeFile(resolve(root,'test-results/ranked-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
