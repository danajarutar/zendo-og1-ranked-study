import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {checkpoints} from './fixtures.mjs';
import {encryptArchive} from '../server/crypto.mjs';
import {recoverRecords} from '../scripts/recover-github.mjs';
test('GitHub recovery merges independent encrypted batches and retains incomplete sessions',async()=>{
 const bundle={key_id:'test-key',archive_key:randomBytes(32).toString('base64')};
 const rows=checkpoints('adult',randomBytes(16).toString('hex')).slice(0,8).map((checkpoint,index)=>({sequence:index+1,checkpoint}));
 const seal=records=>encryptArchive(records,bundle.archive_key,{key_id:bundle.key_id,environment:'production'});
 const batches=[await seal(rows.slice(4)),await seal(rows.slice(0,4))];
 const recovered=await recoverRecords(batches,bundle);
 assert.deepEqual(recovered.records,rows);assert.deepEqual(recovered.sessions,[rows.at(-1).checkpoint.session]);assert.notEqual(recovered.sessions[0].status,'complete');
 await assert.rejects(recoverRecords([await seal(rows.slice(1))],bundle),/Missing/);
 await assert.rejects(recoverRecords([...batches,batches[0]],bundle),/Duplicate/);
 await assert.rejects(recoverRecords(batches,{...bundle,archive_key:randomBytes(32).toString('base64')}));
 const tampered=structuredClone(batches[0]);tampered.header.environment='synthetic';await assert.rejects(recoverRecords([tampered],bundle),/environment/);
 const changed=structuredClone(batches[0]);changed.ciphertext=(changed.ciphertext[0]==='A'?'B':'A')+changed.ciphertext.slice(1);await assert.rejects(recoverRecords([changed],bundle));
});
