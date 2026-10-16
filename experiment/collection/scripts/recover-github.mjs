import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {openKeyBackup,latestSessions} from './researcher.mjs';
import {decryptArchive} from '../server/crypto.mjs';
import {updateStudyData,withDownloadLock} from './study-data.mjs';
export async function recoverRecords(envelopes,bundle) {
 const bySequence=new Map();
 for(const envelope of envelopes) {
  if(envelope.header?.environment!=='production'||envelope.header.key_id!==bundle.key_id)throw Error('Archive environment or encryption key does not match.');
  const rows=await decryptArchive(envelope,bundle.archive_key);
  if(!Array.isArray(rows)||!rows.length)throw Error('Empty or invalid archive batch.');
  for(const row of rows){
   if(!Number.isSafeInteger(row.sequence)||row.sequence<1)throw Error('Invalid checkpoint sequence.');
   if(bySequence.has(row.sequence))throw Error('Duplicate checkpoint sequence; use one complete repository download.');
   bySequence.set(row.sequence,row);
  }
 }
 const records=[...bySequence.values()].sort((a,b)=>a.sequence-b.sequence);
 if(!records.length)throw Error('No checkpoints found.');
 if(records.some((row,index)=>row.sequence!==index+1))throw Error('Missing archive checkpoints. Download the entire repository again.');
 return {records,sessions:latestSessions(records),snapshot:records.at(-1).sequence};
}
async function main(){
 const [input,backup,output]=process.argv.slice(2);
 if(!input||!backup||!output)throw Error('Expected extracted repository folder, encrypted key backup, and Study data output folder.');
 const root=fileURLToPath(new URL('../',import.meta.url));
 const production=resolve(input).split(/[\\/]/).at(-1)==='production'?resolve(input):resolve(input,'production');
 const names=(await readdir(production)).filter(name=>name.endsWith('.json')).sort();
 if(!names.length)throw Error('No JSON archives found in the selected production folder.');
 const bundle=openKeyBackup(JSON.parse(await readFile(backup,'utf8')),process.env.ZENDO_BACKUP_PASSPHRASE||'');
 const envelopes=[];for(const name of names)envelopes.push(JSON.parse(await readFile(resolve(production,name),'utf8')));
 const {records,sessions,snapshot}=await recoverRecords(envelopes,bundle);
 const smoke=JSON.parse(await readFile(resolve(root,'private/production-smoke.json'),'utf8'));
 const researcher=JSON.parse(await readFile(resolve(root,'private/researcher-tests.json'),'utf8'));
 if(!Array.isArray(smoke.participants)||researcher.format!=='zendo-researcher-tests-v1'||!Array.isArray(researcher.participants))throw Error('Invalid test identity manifests.');
 const exported_at=new Date().toISOString();
 await withDownloadLock(resolve(output),async()=>updateStudyData(resolve(output),{format:'zendo-og1-ranked-export-v1',exported_at,snapshot,sessions,checkpoints:records},smoke.participants,researcher.participants));
 console.log('Recovered '+records.length+' checkpoints and '+sessions.length+' sessions.\nReadable output: '+resolve(output));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error('Recovery failed: '+error.message);process.exitCode=1;});
