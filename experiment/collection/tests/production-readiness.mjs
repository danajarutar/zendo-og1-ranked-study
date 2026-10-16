import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { checkpoints } from "./fixtures.mjs";
import { sha256, decryptArchive } from "../server/crypto.mjs";
import { openKeyBackup } from "../scripts/researcher.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const endpoint = process.env.ZENDO_COLLECTOR_URL;
assert.equal(endpoint, 'https://zendo-og1-ranked-collector.rutar-danaja.workers.dev');
assert.ok(process.env.ZENDO_ADMIN_TOKEN);
const mode = process.argv[2];
assert.ok(['exercise','verify'].includes(mode));
const headers = { Authorization: `Bearer ${process.env.ZENDO_ADMIN_TOKEN}`, 'Content-Type': 'application/json' };
async function admin(path, body) {
  const response = await fetch(`${endpoint}/admin/${path}`, { headers, method: body ? 'POST' : 'GET', ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(60000) });
  const value = await response.json(); assert.equal(response.status, 200, value.error); return value;
}
let status = await admin('status');
assert.equal(status.environment, 'production');
const manifestPath = resolve(root, 'private/production-smoke.json');
let manifest;
try { manifest = JSON.parse(await readFile(manifestPath,'utf8')); }
catch(error) {
  if (error.code !== 'ENOENT' || mode !== 'exercise') throw error;
  assert.equal(status.received_checkpoints, 0, 'Initial setup check requires an empty production receiver.');
  manifest = { purpose:'Fictional setup checks. Exclude these exact participant IDs from analysis.', created_at:new Date().toISOString(), participants:[] };
  for(const variant of ['adult','child']) for(const method of ['transport','browser']) {
    const participant=randomBytes(16).toString('hex'), token=randomBytes(32).toString('hex');
    manifest.participants.push({participant,token,variant,method,writer:randomUUID(),...(method === 'transport' ? {checkpoints:checkpoints(variant, participant)} : {})});
  }
  await writeFile(manifestPath,JSON.stringify(manifest),{flag:'wx'});
}
if(mode === 'exercise') {
  const participants=await Promise.all(manifest.participants.map(async row=>({participant:row.participant,variant:row.variant,token_hash:await sha256(row.token)})));
  await admin('register',{participants});
  await Promise.all(manifest.participants.filter(row=>row.method==='transport').map(async row=>{
    const h={Authorization:`Bearer ${row.token}`,'X-Participant':row.participant,'X-Writer':row.writer,'Content-Type':'application/json'};
    for(const checkpoint of row.checkpoints) {
      const request={method:'POST',headers:h,body:JSON.stringify(checkpoint)};
      const response=await fetch(`${endpoint}/checkpoint`,request);
      assert.equal(response.status,200,await response.text());
      if(checkpoint.checkpoint_revision===1) {
        const retry=await fetch(`${endpoint}/checkpoint`,request); assert.equal(retry.status,200);
      }
    }
  }));
  console.log('Two explicitly identified fictional production sessions completed; exact first-checkpoint retries accepted.');
  process.exit(0);
}
status=await admin('status');
const target=status.received_checkpoints;
for(let attempt=0;status.archived_through<target && attempt<30;attempt++) {
  const before=status.archived_through;
  await admin('archive',{}); status=await admin('status');
  assert.ok(status.archived_through>before,`Archive not progressing: ${status.archive_error}`);
}
assert.ok(status.archived_through>=target); assert.equal(status.archive_error,null);
const records=[];let after=0;
do {const page=await admin(`export?after=${after}&snapshot=${target}`); records.push(...page.records); after=page.next;} while(after!==null);
for(const item of manifest.participants.filter(row=>row.method==='transport')) assert.deepEqual(records.filter(row=>row.checkpoint.session.participant_code===item.participant).map(row=>row.checkpoint),item.checkpoints);
const bundle=openKeyBackup(JSON.parse(await readFile(resolve(root,'private/production-key-backup.json'),'utf8')),process.env.ZENDO_BACKUP_PASSPHRASE||'');
assert.equal(bundle.key_id,'og1-ranked-production-1');
const checkout=resolve(root,`.wrangler/production-archive-check-${Date.now()}`);
execFileSync('git',['clone','--depth','1','https://github.com/danajarutar/zendo-og1-ranked-responses.git',checkout],{env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'},windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:120000});
const files=(await readdir(resolve(checkout,'production'))).filter(name=>name.endsWith('.json'));
const recovered=[];const ivs=new Set();
for(const file of files) {
  const envelope=JSON.parse(await readFile(resolve(checkout,'production',file),'utf8'));
  assert.equal(envelope.header.key_id,bundle.key_id);assert.equal(envelope.header.environment,'production');
  assert.deepEqual(Object.keys(envelope).sort(),['ciphertext','header','iv']);
  assert.ok(!ivs.has(envelope.iv));ivs.add(envelope.iv);
  recovered.push(...(await decryptArchive(envelope,bundle.archive_key)).filter(row=>row.sequence<=target));
}
recovered.sort((a,b)=>a.sequence-b.sequence); assert.deepEqual(recovered,records);
const report={verified_at:new Date().toISOString(),environment:'production',snapshot:target,exported_checkpoints:records.length,exact_recovered_checkpoints:recovered.length,encrypted_files:files.length,missing:0,duplicated:0,overwritten:0,setup_participant_ids:manifest.participants.map(row=>row.participant),note:'Fictional production setup checks only; not real participants.'};
await mkdir(resolve(root,'test-results'),{recursive:true});
await writeFile(resolve(root,'test-results/production-readiness-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
