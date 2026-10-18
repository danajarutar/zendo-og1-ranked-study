import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/dr571/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=resolve(import.meta.dirname,'..');
const base='https://danajarutar.github.io/zendo-og1-ranked-study';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const report=[];
try {
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
await writeFile(resolve(root,'test-results/ranked-production-browser.json'),JSON.stringify({verified_at:new Date().toISOString(),cases:report},null,2));
console.log(JSON.stringify(report));
