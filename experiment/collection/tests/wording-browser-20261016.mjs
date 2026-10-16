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
try{
for(const variant of ['adult','child']){
const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();const errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',route=>{if(route.request().url().includes('workers.dev')){requests.push(route.request().url());return route.abort();}return route.continue();});
await page.goto(base+'/review/?variant='+variant+'&stage=generalisation');
await page.getByRole('button',{name:variant==='adult'?'Potrdite izbiro':'Potrdi izbiro',exact:true}).click();
const help=page.locator('#final-rule-help');await help.waitFor();
assert.equal(await help.innerText(),variant==='adult'?'Kaj je po vašem mnenju skrito pravilo na podlagi vsega, kar ste do zdaj videli v tej nalogi (1 od 5)? Svoj odgovor napišite v spodnje polje.':'Kaj je po tvojem mnenju skrito pravilo na podlagi vsega, kar si do zdaj videl(a) v tej nalogi (1 od 5)? Svoj odgovor napiši v spodnje polje.');
assert.ok((await help.locator('strong').innerText()).endsWith('(1 od 5)'));
assert.equal(await page.locator('.probe-card:disabled').count(),8);
await page.screenshot({path:resolve(root,'test-results/wording-'+variant+'-final.png'),fullPage:true});
await page.goto(base+'/review/?variant='+variant+'&stage=full&run=wording-'+Date.now());
await page.locator('input[readonly]').waitFor();
for(const field of variant==='adult'?['study_year','study_level']:['school','class_number','class_letter'])await page.locator('[name='+field+']').fill('LOCAL REVIEW');
await page.locator('[name=age_years]').fill(variant==='adult'?'22':'9');await page.locator('[name=gender]').selectOption('prefer_not');await page.locator('input[type=checkbox]').check();await page.getByRole('button',{name:/Poglejte navodila|Poglej navodila/}).click();await page.getByRole('heading',{name:/Dobrodo/}).waitFor();
const paras=await page.locator('.instructions-card p.instruction-copy').allTextContents();
assert.equal(paras[0],variant==='adult'?'Hvala, da ste se odločili igrati mojo igro!':'Hvala, da si se odločil(a) igrati mojo igro!');
const planet=page.locator('.instructions-card p.instruction-copy').filter({hasText:'V tej igri'});
assert.ok((await planet.innerText()).startsWith(variant==='adult'?'V tej igri se boste učili':'V tej igri se boš učil(a)'));
assert.ok((await planet.innerText()).endsWith('Skrito pravilo je lahko povezano z barvo, velikostjo, obliko, številom likov ali kombinacijo teh lastnosti.'));
assert.equal(await planet.evaluate(p=>Boolean(document.querySelector('.zendo-intro-image').compareDocumentPosition(p)&Node.DOCUMENT_POSITION_FOLLOWING)),true);
assert.doesNotMatch(await page.locator('.instructions-card').innerText(),/glejte spodaj|glej spodaj|rskritih/);
assert.ok((await page.locator('.laboratory-paragraph').innerText()).endsWith('ponovno odkriti pet skritih pravil!'));
const styles=await page.locator('.instructions-card p.instruction-copy').evaluateAll(ps=>ps.map(p=>{const s=getComputedStyle(p);return s.fontFamily+'|'+s.fontSize+'|'+s.fontWeight;}));assert.equal(new Set(styles).size,1);
await page.screenshot({path:resolve(root,'test-results/wording-'+variant+'-intro.png'),fullPage:true});
await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:resolve(root,'test-results/wording-'+variant+'-mobile.png'),fullPage:true});
assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);report.push({variant,pass:true,checks:['final prompt and bold task position','eight locked probes','intro order after image','consistent font','approved lab story','mobile overflow','no collector requests or browser errors']});await context.close();
}
}finally{await browser.close();await new Promise(r=>server.close(r));}
await writeFile(resolve(root,'test-results/wording-browser-20261016'+(process.argv[2]?'-live':'')+'.json'),JSON.stringify({base,verified_at:new Date().toISOString(),cases:report},null,2));console.log(JSON.stringify(report));
