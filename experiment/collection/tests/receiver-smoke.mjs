import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { checkpoints, BrowserStorage } from "./fixtures.mjs";
import { CollectorClient } from "../src/client.mjs";
import { sha256 } from "../server/crypto.mjs";
const endpoint = process.env.ZENDO_COLLECTOR_URL || "http://127.0.0.1:8791";
const headers = { Authorization: `Bearer ${process.env.ZENDO_ADMIN_TOKEN || "SYNTHETIC-LOCAL-ADMIN"}`, "Content-Type": "application/json" };
const api = async path => { const response = await fetch(`${endpoint}/admin/${path}`, { headers }); assert.equal(response.status, 200); return response.json(); };
assert.equal((await api("status")).environment, "synthetic", "Refuse production.");
const expected = new Map();
await Promise.all(Array.from({ length: 10 }, async (_, index) => {
  const participantCode = randomBytes(16).toString("hex"), token = randomBytes(32).toString("hex"), variant = index % 2 ? "adult" : "child";
  const registration = await fetch(`${endpoint}/admin/register`, { method: "POST", headers, body: JSON.stringify({ participants: [{ participant: participantCode, token_hash: await sha256(token), variant }] }) });
  assert.equal(registration.status, 200);
  let loseAcknowledgement = true;
  const client = new CollectorClient({ participantCode, token, variant, endpoint, storage: new BrowserStorage(), fetcher: async (url, init) => {
    const response = await fetch(url, init);
    if (loseAcknowledgement && response.ok) { loseAcknowledgement = false; throw new TypeError("Synthetic interrupted acknowledgement"); }
    return response;
  } });
  const records = checkpoints(variant, participantCode);
  await assert.rejects(client.save(records[0]), /interrupted/); await client.flush();
  for (const record of records.slice(1)) await client.save(record);
  assert.equal(client.queue().length, 0);
  expected.set(participantCode, records);
}));
let after = 0, snapshot; const received = new Map();
do {
  const page = await api(`export?after=${after}${snapshot === undefined ? "" : `&snapshot=${snapshot}`}`);
  snapshot = page.snapshot;
  for (const row of page.records) if (expected.has(row.checkpoint.session.participant_code)) {
    const id = row.checkpoint.session.participant_code;
    if (!received.has(id)) received.set(id, []);
    received.get(id).push(row.checkpoint);
  }
  after = page.next;
} while (after !== null);
for (const [id, records] of expected) assert.deepEqual(received.get(id), records);
const report = { target: endpoint, environment: "synthetic", simultaneous_participants: 10, complete_sessions: received.size, expected_checkpoints: [...expected.values()].reduce((total, records) => total + records.length, 0), exported_checkpoints: [...received.values()].reduce((total, records) => total + records.length, 0), missing: 0, duplicated: 0, overwritten: 0, interrupted_acknowledgements: 10, verified_at: new Date().toISOString(), github_archive: "Not exercised by this test; requires a separate online synthetic repository and credentials." };
await mkdir(new URL("../test-results/", import.meta.url), { recursive: true });
await writeFile(new URL("../test-results/receiver-report.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
