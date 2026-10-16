import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root=fileURLToPath(new URL('../',import.meta.url));
const base='https://danajarutar.github.io/zendo-og1-ranked-study';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const report=[];
try {
  for(const variant of ['adult','child']) {
    const context=await browser.newContext();const page=await context.newPage();const requests=[];
    page.on('request',request=>{if(request.url().includes('workers.dev'))requests.push(request.url());});
    await page.goto(`${base}/review/?variant=${variant}&stage=generalisation`);
    await page.getByRole('button',{name:variant==='adult'?'Potrdite izbiro':'Potrdi izbiro',exact:true}).click();
    const help=page.locator('#final-rule-help');await help.waitFor({state:'visible'});
    const expected=variant==='adult'?'Kaj je po vašem mnenju skrito pravilo na podlagi vsega, kar ste do zdaj videli v tej nalogi? Svoj odgovor napišite v spodnje polje.':'Kaj je po tvojem mnenju skrito pravilo na podlagi vsega, kar si do zdaj videl(a) v tej nalogi? Svoj odgovor napiši v spodnje polje.';
    assert.equal(await help.innerText(),expected);
    assert.equal(await help.locator('strong').innerText(),variant==='adult'?'vsega, kar ste do zdaj videli v tej nalogi':'vsega, kar si do zdaj videl(a) v tej nalogi');
    assert.equal(await page.locator('.probe-card:disabled').count(),8);
    assert.deepEqual(requests,[],'Review must not contact either collection service.');
    await page.screenshot({path:resolve(root,`test-results/release-review-${variant}.png`),fullPage:true});
    report.push({variant,test:'Exact final prompt, emphasis, eight locked probes, and no collector requests in review',pass:true});
    await page.goto(`${base}/review/?variant=${variant}&stage=full&run=release-check`);
    await page.locator('input[readonly]').waitFor();
    for(const field of variant==='adult'?['study_year','study_level']:['school','class_number','class_letter']) {
      assert.equal(await page.locator(`[name=${field}]`).getAttribute('required'),'');
      await page.locator(`[name=${field}]`).fill('REVIEW ONLY');
    }
    await page.locator('[name=age_years]').fill(variant==='adult'?'22':'9');
    await page.locator('[name=gender]').selectOption('prefer_not');await page.locator('input[type=checkbox]').check();
    await page.getByRole('button',{name:/Poglejte navodila|Poglej navodila/}).click();
    await page.getByRole('heading',{name:/Dobrodo/}).waitFor();
    assert.deepEqual(requests,[],'Full review must also remain local.');
    report.push({variant,test:'Review includes required collection demographics and starts without submitting data',pass:true});
    await context.close();
  }
  if(process.argv[2]==='production') {
    const manifest=JSON.parse(await readFile(resolve(root,'private/production-smoke.json'),'utf8'));
    for(const item of manifest.participants.filter(row=>row.method==='browser')) {
      const statePath=resolve(root,`private/production-browser-${item.participant}-state.json`);
      let savedState;
      try {savedState=JSON.parse(await readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      const context=await browser.newContext(savedState?{storageState:savedState}:{});const page=await context.newPage();
      const link=`${base}/${item.variant==='adult'?'odrasli':'otroci'}/#p=${item.participant}&t=${item.token}`;
      await page.goto(link);
      if(savedState) {
        await page.getByRole('button',{name:/Nadaljujte shranjeno|Nadaljuj shranjeno/}).click();
        await page.getByText('Odgovori so prejeti na strežniku.',{exact:true}).waitFor();
        await context.storageState({path:statePath});
        report.push({variant:item.variant,test:'Recheck using reserved original browser state; same-link recovery acknowledged',pass:true});
        await context.close();continue;
      }
      await page.locator('input[readonly]').waitFor();
      assert.equal(await page.locator('input[readonly]').inputValue(),item.participant);
      const fields=item.variant==='adult'?['study_year','study_level']:['school','class_number','class_letter'];
      for(const field of fields) {assert.equal(await page.locator(`[name=${field}]`).getAttribute('required'),'');await page.locator(`[name=${field}]`).fill('FICTIONAL SETUP CHECK');}
      await page.locator('[name=age_years]').fill(item.variant==='adult'?'22':'9');
      await page.locator('[name=gender]').selectOption('prefer_not');await page.locator('input[type=checkbox]').check();
      assert.ok(!(await page.locator('body').innerText()).includes('Preizkusna različica'));
      await page.screenshot({path:resolve(root,`test-results/production-${item.variant}-opening.png`),fullPage:true});
      await page.getByRole('button',{name:/Poglejte navodila|Poglej navodila/}).click();
      await page.getByText('Odgovori so prejeti na strežniku.',{exact:true}).waitFor();
      const key=`zendo-og1-ranked-collection-v1:${item.participant}:${item.variant}`;
      const before=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
      await context.storageState({path:statePath});
      await page.reload();await page.getByRole('button',{name:/Nadaljujte shranjeno|Nadaljuj shranjeno/}).click();
      await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).session.resume_count===1,key);
      await page.getByText('Odgovori so prejeti na strežniku.',{exact:true}).waitFor();
      const after=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
      assert.equal(after.session.session_id,before.session.session_id);assert.deepEqual(after.session.rule_order,before.session.rule_order);
      assert.deepEqual(after.session.demographics,before.session.demographics);
      const duplicate=await context.newPage();await duplicate.goto(link);await duplicate.getByText(/že odprta v drugem zavihku/).waitFor();
      report.push({variant:item.variant,test:'Production HTTPS form, required demographics, server receipt, same-link resume and duplicate-tab prevention',pass:true});
      await writeFile(resolve(root,'test-results/release-browser-production-progress.json'),JSON.stringify({verified_at:new Date().toISOString(),cases:report},null,2));
      await context.storageState({path:statePath});
      await context.close();
    }
    for(const item of manifest.participants.filter(row=>row.method==='transport')) {
      const context=await browser.newContext();const page=await context.newPage();
      await page.goto(`${base}/${item.variant==='adult'?'odrasli':'otroci'}/#p=${item.participant}&t=${item.token}`);
      await page.getByText('Ta udeležba je že zaključena. Hvala!',{exact:true}).waitFor();
      report.push({variant:item.variant,test:'Completed production link refuses another participation',pass:true});await context.close();
    }
  }
} finally {await browser.close();}
await writeFile(resolve(root,`test-results/release-browser-${process.argv[2]||'review'}.json`),JSON.stringify({verified_at:new Date().toISOString(),cases:report},null,2));
console.log(JSON.stringify(report));
