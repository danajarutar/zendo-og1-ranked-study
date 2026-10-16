import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');const base='https://danajarutar.github.io/zendo-og1-ranked-study/';
const digest=b=>createHash('sha256').update(b).digest('hex');
async function check(url,file){const response=await fetch(url+'?verify='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,url);const actual=Buffer.from(await response.arrayBuffer()),expected=await readFile(file);assert.equal(digest(actual),digest(expected),'Published bytes differ: '+url);return {url,sha256:digest(actual)};}
const checks=[];
for(const kind of ['production','review']){const local=resolve(root,'.wrangler/builds',kind);const remote=base+(kind==='review'?'review/':'');checks.push(await check(remote+'release.json',resolve(local,'release.json')));for(const entry of kind==='production'?['index.html','odrasli/index.html','otroci/index.html']:['index.html'])checks.push(await check(remote+entry,resolve(local,entry)));const assets=(await readdir(resolve(local,'assets'))).filter(x=>/\.(js|css)$/.test(x));checks.push(...await Promise.all(assets.map(name=>check(remote+'assets/'+name,resolve(local,'assets',name)))));}
await writeFile(resolve(root,'test-results/wording-published-20261016.json'),JSON.stringify({release:'og1-wording-2026-10-16',verified_at:new Date().toISOString(),commits:{production:'94ba28e7cc646499e79b37d2009be3eeed69f35f',review:'9b13099ceff9a6a4b3d52d5e0820fa070571bded'},checks},null,2));console.log('Verified '+checks.length+' live manifests, entry pages and built assets.');
