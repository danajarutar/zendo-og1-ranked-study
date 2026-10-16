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
for(const variant of ['adult','child']) for(const phase of ['feedback','practiceFeedback']) for(const positive of [false,true]) {
 const participant='1234567890abcdef1234567890abcdef';const records=checkpoints(variant,participant);
 const practice=phase==='practiceFeedback';const type=practice?'practice_active_test':'active_test';
 const record=records.find(r=>r.checkpoint_type===type && (practice?r.session.practice_demo.active_tests.at(-1):r.session.trials[r.trial_index].active_tests.at(-1)).label===positive);assert.ok(record);
 const feedback=practice?record.session.practice_demo.active_tests.at(-1):record.session.trials[record.trial_index].active_tests.at(-1);
 const envelope={session:record.session,phase,trialPosition:record.trial_index??0,editorScene:feedback.scene,anchorSceneId:null,sourceChoice:'fresh',selectedIds:[],constructionStartedAt:feedback.construction_started_at,actionEvents:[],hypothesis:'SYNTHETIC timing check',finalGuessDraft:'',operations:['necessity'],primaryOperation:'necessity',otherOperation:'',lastFeedback:feedback,checkpointRevision:record.checkpoint_revision,instructionPage:0,instructionLayoutVersion:3,viewedAdditionalExamples:[],comprehensionAnswers:{},quizReviewed:false,savedAt:new Date().toISOString()};
 const run='timing-'+variant+'-'+phase+'-'+positive;const key='zendo-og1-ranked-review-collection:'+variant+':'+run;
 const context=await browser.newContext();const page=await context.newPage();const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>{if(route.request().url().includes('workers.dev')){requests.push(route.request().url());return route.abort();}return route.continue();});
 await context.addInitScript(({key,participant,envelope})=>{localStorage.setItem(key+':id',participant);localStorage.setItem(key,JSON.stringify(envelope));new MutationObserver(()=>{const visible=!!document.querySelector('.inline-feedback-status');if(visible&&window.__feedbackStarted===undefined)window.__feedbackStarted=performance.now();if(!visible&&window.__feedbackStarted!==undefined&&window.__feedbackDone===undefined)window.__feedbackDone=performance.now();}).observe(document,{childList:true,subtree:true});},{key,participant,envelope});
 await page.goto(base+'/review/?variant='+variant+'&stage=full&run='+run);
 await page.getByRole('button',{name:/Nadaljujte shranjeno|Nadaljuj shranjeno/}).click();
 await page.locator('.inline-feedback-status').waitFor();assert.equal(await page.locator('.star-shower').count()>0,positive);
 await page.waitForFunction(()=>window.__feedbackDone!==undefined,null,{timeout:10000});const duration=await page.evaluate(()=>window.__feedbackDone-window.__feedbackStarted);
 assert.ok(duration>=2800&&duration<3800,'Expected 3-second feedback, measured '+duration);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 report.push({variant,phase,positive,duration_ms:Math.round(duration),pass:true});await context.close();
}
} finally {await browser.close();await new Promise(r=>server.close(r));}
await writeFile(resolve(root,'test-results/feedback-3s-browser-20261016'+(process.argv[2]?'-live':'')+'.json'),JSON.stringify({base,verified_at:new Date().toISOString(),cases:report},null,2));console.log(JSON.stringify(report));
