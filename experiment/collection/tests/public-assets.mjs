import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openKeyBackup} from '../scripts/researcher.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const checkout=resolve(root,'.wrangler/pages-publish');
const forbidden=[process.env.ZENDO_ADMIN_TOKEN];
assert.ok(forbidden[0]);
const backup=JSON.parse(await readFile(resolve(root,'private/production-key-backup.json'),'utf8'));
forbidden.push(openKeyBackup(backup,process.env.ZENDO_BACKUP_PASSPHRASE||'').archive_key);
for(const variant of ['adult','child']) {
  const bundle=JSON.parse(await readFile(resolve(root,`private/participant-${variant}-links-20261007.json`),'utf8'));
  for(const item of bundle.links) {forbidden.push(item.participant,new URLSearchParams(new URL(item.link).hash.slice(1)).get('t'));}
}
let checked=0;
async function scan(path) {
  for(const entry of await readdir(path,{withFileTypes:true})) {
    if(entry.name==='.git')continue;
    assert.ok(!['private','.env','.dev.vars'].includes(entry.name),'Private directory/file must not be published.');
    const full=resolve(path,entry.name);
    if(entry.isDirectory()){await scan(full);continue;}
    if(!/\.(html|js|css|md|json)$/.test(entry.name))continue;
    const text=await readFile(full,'utf8');
    for(const secret of forbidden)assert.ok(!text.includes(secret),'Private identity or credential found in public output.');
    assert.ok(!/github_pat_[A-Za-z0-9_]{20,}/.test(text),'GitHub credential found in public output.');
    checked++;
  }
}
await scan(checkout);
console.log(`PASS: ${checked} public text assets contain none of the production admin/archive keys or 40 private participant link credentials.`);
