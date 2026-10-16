import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Collector } from "../server/collector.mjs";
import { CollectorClient, parseLink } from "../src/client.mjs";
import { encryptArchive, decryptArchive, sha256 } from "../server/crypto.mjs";
import { validateStudySessionPayload, validateSessionProgression, validateCheckpointRequest } from "../../app/lib/checkpoint-contract.ts";
import { MemoryStorage, BrowserStorage, checkpoints } from "./fixtures.mjs";

const credentials = () => ({ participantCode: randomBytes(16).toString("hex"), token: randomBytes(32).toString("hex") });
async function register(collector, identity, variant) { await collector.storage.put(`participant:${identity.participantCode}`, { participant: identity.participantCode, token_hash: await sha256(identity.token), variant }); }
const env = () => ({ ADMIN_TOKEN: "SYNTHETIC-ONLY-ADMIN", ENVIRONMENT: "synthetic", ARCHIVE_KEY_ID: "synthetic-1", ARCHIVE_KEY: randomBytes(32).toString("base64"), GITHUB_REPOSITORY: "synthetic/responses", GITHUB_TOKEN: "SYNTHETIC-ONLY-TOKEN" });
const fetchFor = collector => (url, init) => collector.handle(new Request(url, init));
const admin = (collector, path) => collector.handle(new Request(`https://collector.test/admin/${path}`, { headers: { Authorization: "Bearer SYNTHETIC-ONLY-ADMIN" } }));

test("ten simultaneous participants retain all checkpoints through interrupted acknowledgements and export pagination", async () => {
  const storage = new MemoryStorage();
  const collector = new Collector(storage, env());
  const expected = [];
  await Promise.all(Array.from({ length: 10 }, async (_, index) => {
    const identity = credentials(); const variant = index % 2 ? "adult" : "child";
    await register(collector, identity, variant);
    const records = checkpoints(variant, identity.participantCode);
    const browser = new BrowserStorage();
    let lost = false;
    const fetcher = async (url, init) => {
      const response = await fetchFor(collector)(url, init);
      if (url.endsWith("/checkpoint") && !lost) { lost = true; throw new TypeError("Synthetic lost acknowledgement"); }
      return response;
    };
    let client = new CollectorClient({ ...identity, variant, endpoint: "https://collector.test", storage: browser, fetcher });
    await assert.rejects(client.save(records[0]), /lost acknowledgement/);
    assert.equal(client.acknowledgedRevision(), 0);
    // Closing/reopening recreates the transport without changing the queue IDs.
    client = new CollectorClient({ ...identity, variant, endpoint: "https://collector.test", storage: browser, fetcher });
    await client.flush();
    for (const record of records.slice(1)) {
      validateCheckpointRequest(record);
      await client.save(record);
    }
    assert.equal(client.queue().length, 0);
    assert.equal(client.acknowledgedRevision(), records.length);
    expected.push(...records);
  }));
  const received = [];
  let after = 0, snapshot;
  do {
    const page = await (await admin(collector, `export?after=${after}${snapshot === undefined ? "" : `&snapshot=${snapshot}`}`)).json();
    assert.ok(page.records, JSON.stringify(page));
    snapshot = page.snapshot;
    received.push(...page.records.map(record => record.checkpoint));
    after = page.next;
  } while (after !== null);
  assert.equal(received.length, expected.length);
  assert.equal(new Set(received.map(record => record.checkpoint_id)).size, expected.length);
  assert.deepEqual(received.sort((a,b) => a.checkpoint_id.localeCompare(b.checkpoint_id)), expected.sort((a,b) => a.checkpoint_id.localeCompare(b.checkpoint_id)));
});

test("shared browser separates identities and refuses another participant, writer, session and rewritten history", async () => {
  const collector = new Collector(new MemoryStorage(), env());
  const shared = new BrowserStorage();
  const a = credentials(), b = credentials();
  await register(collector, a, "adult"); await register(collector, b, "adult");
  const client = new CollectorClient({ ...a, variant: "adult", endpoint: "https://collector.test", storage: shared, fetcher: fetchFor(collector) });
  const other = new CollectorClient({ ...b, variant: "adult", endpoint: "https://collector.test", storage: shared, fetcher: fetchFor(collector) });
  assert.notEqual(client.storageKey, other.storageKey);
  const records = checkpoints("adult", a.participantCode);
  await client.save(records[0]);
  await assert.rejects(other.save(records[1]), /Identiteta/);
  const anotherComputer = new CollectorClient({ ...a, variant: "adult", endpoint: "https://collector.test", storage: new BrowserStorage(), fetcher: fetchFor(collector) });
  await assert.rejects(anotherComputer.save(records[1]), /drugi seji ali brskalniku/);
  const changed = structuredClone(records[1]); changed.session.demographics.study_year = "rewritten";
  const response = await collector.handle(new Request("https://collector.test/checkpoint", { method: "POST", headers: { Authorization: `Bearer ${a.token}`, "X-Participant": a.participantCode, "X-Writer": client.writer }, body: JSON.stringify(changed) }));
  assert.equal(response.status, 409);
  const newSession = checkpoints("adult", a.participantCode)[0];
  await assert.rejects(client.save(newSession), /drugi seji/);
});

test("fresh browsers can read completion but cannot resume active sessions or write another participation", async () => {
  const collector = new Collector(new MemoryStorage(), env());
  const identity = credentials(); await register(collector, identity, "child");
  const client = new CollectorClient({ ...identity, variant: "child", endpoint: "https://collector.test", storage: new BrowserStorage(), fetcher: fetchFor(collector) });
  const fresh = new CollectorClient({ ...identity, variant: "child", endpoint: "https://collector.test", storage: new BrowserStorage(), fetcher: fetchFor(collector) });
  const records = checkpoints("child", identity.participantCode);
  await client.save(records[0]);
  await assert.rejects(fresh.initialise(), /drugem brskalniku/);
  for (const record of records.slice(1)) await client.save(record);
  assert.equal((await fresh.initialise()).status, "complete");
  assert.equal(fresh.storage.getItem(fresh.storageKey), null);
  await assert.rejects(fresh.save(checkpoints("child", identity.participantCode)[0]), /drugi seji/);
  assert.equal(await collector.storage.get("sequence"), records.length);
});

test("required demographics validate by variant, remain immutable, and historical 2.4 remains valid", () => {
  for (const variant of ["adult", "child"]) {
    const records = checkpoints(variant, credentials().participantCode);
    let previous;
    for (const { session } of records) {
      validateStudySessionPayload(session);
      if (previous) validateSessionProgression(previous, session);
      previous = session;
    }
    const record = structuredClone(records[0].session);
    const field = variant === "adult" ? "study_year" : "school";
    record.demographics[field] = " "; assert.throws(() => validateStudySessionPayload(record));
    record.schema_version = "2.6.0"; record.experiment_version = "zendo-og1-ranked-preview-1.0.0";
    delete record.interruptions;
    for (const key of ["study_year", "study_level", "school", "class_number", "class_letter"]) delete record.demographics[key];
    validateStudySessionPayload(record);
  }
});

test("archive encrypts before GitHub, retries a lost commit acknowledgement without duplication, and rejects public repositories", async () => {
  const settings = env(); const files = new Map(); let failOnce = true;
  const github = async (url, init) => {
    if (!url.includes("/contents/")) return Response.json({ private: true });
    if (init.method === "PUT") {
      const body = JSON.parse(init.body); const content = Buffer.from(body.content, "base64").toString("utf8");
      assert.ok(!content.includes("SYNTHETIC SCHOOL"));
      if (files.has(url)) return Response.json({}, { status: 422 });
      files.set(url, content);
      if (failOnce) { failOnce = false; throw new TypeError("Synthetic lost GitHub acknowledgement"); }
      return Response.json({ commit: { sha: "synthetic" } }, { status: 201 });
    }
    return new Response(files.get(url), { status: files.has(url) ? 200 : 404 });
  };
  const collector = new Collector(new MemoryStorage(), settings, github);
  const identity = credentials(); await register(collector, identity, "child");
  const client = new CollectorClient({ ...identity, variant: "child", endpoint: "https://collector.test", storage: new BrowserStorage(), fetcher: fetchFor(collector) });
  await client.save(checkpoints("child", identity.participantCode)[0]);
  await assert.rejects(collector.archive(), /lost GitHub/);
  assert.equal(await collector.storage.get("archivedThrough"), undefined);
  await collector.archive();
  assert.equal(files.size, 1);
  assert.equal(await collector.storage.get("archivedThrough"), 1);
  const envelope = JSON.parse([...files.values()][0]);
  const decrypted = await decryptArchive(envelope, settings.ARCHIVE_KEY);
  assert.equal(decrypted[0].checkpoint.session.demographics.school, "SYNTHETIC SCHOOL");
  await assert.rejects(decryptArchive(envelope, randomBytes(32).toString("base64")));
  envelope.header.environment = "production";
  await assert.rejects(decryptArchive(envelope, settings.ARCHIVE_KEY));
  collector.fetcher = async () => Response.json({ private: false });
  await assert.rejects(collector.archive(), /private/);
});

test("random link parsing does not accept missing credentials or unknown routes", () => {
  const identity = credentials();
  assert.equal(parseLink(`https://example.test/zendo/odrasli/#p=${identity.participantCode}&t=${identity.token}`).participantCode, identity.participantCode);
  assert.throws(() => parseLink("https://example.test/zendo/odrasli/"));
  assert.throws(() => parseLink(`https://example.test/zendo/odrasli/demo/#p=${identity.participantCode}&t=${identity.token}`));
});

test("interruptions append without changing raw construction timestamps and cannot rewrite prior interruption history", () => {
  const session = checkpoints("adult", credentials().participantCode).find(record => record.checkpoint_type === "active_test").session;
  const resumed = structuredClone(session);
  resumed.resume_count = 1;
  resumed.interruptions.push({ resumed_at: new Date().toISOString(), last_local_save_at: session.last_checkpoint_at, phase: "editor", trial_index: 0, construction_started_at: session.trials[0].active_tests[0].construction_started_at });
  validateSessionProgression(session, resumed);
  assert.deepEqual(resumed.trials, session.trials);
  const changed = structuredClone(resumed); changed.interruptions[0].phase = "feedback";
  assert.throws(() => validateSessionProgression(resumed, changed));
});

test("archive obeys GitHub retry-after and retains received checkpoints while rate-limited", async () => {
  let calls = 0;
  const collector = new Collector(new MemoryStorage(), env(), async () => { calls++; return Response.json({}, { status: 429, headers: { "Retry-After": "600" } }); });
  const id = credentials(); await register(collector, id, "adult");
  const client = new CollectorClient({ ...id, variant: "adult", endpoint: "https://collector.test", storage: new BrowserStorage(), fetcher: fetchFor(collector) });
  await client.save(checkpoints("adult", id.participantCode)[0]);
  await assert.rejects(collector.archive(), /rate limit/);
  assert.ok(await collector.storage.get("archiveRetryAt") >= Date.now() + 590_000);
  await collector.archive();
  assert.equal(calls, 1);
  assert.equal(await collector.storage.get("sequence"), 1);
  assert.equal(await collector.storage.get("archivedThrough"), undefined);
});


test('ranked additional operations are optional verbatim text and remain immutable', () => {
 const records=checkpoints('child','0123456789abcdef0123456789abcdef');
 const original=records.find(r=>r.checkpoint_type==='active_test');
 const getRecord=c=>c.session.trials[0].active_tests[0];
 validateCheckpointRequest(original);
 assert.equal(getRecord(original).additional_operations_ranked_text, '  2. Preverim nujnost – čšž\n3. Poiščem novo pravilo  ');
 for(const invalid of [null,[],42,'x'.repeat(4001)]) {
  const changed=structuredClone(original); getRecord(changed).additional_operations_ranked_text=invalid;
  assert.throws(()=>validateCheckpointRequest(changed),/additional_operations_ranked_text/);
 }
 const blank=structuredClone(original);getRecord(blank).additional_operations_ranked_text='';validateCheckpointRequest(blank);
 const missing=structuredClone(original);delete getRecord(missing).additional_operations_ranked_text;assert.throws(()=>validateCheckpointRequest(missing));
 const rewritten=structuredClone(original.session);rewritten.trials[0].active_tests[0].additional_operations_ranked_text='2. changed';assert.throws(()=>validateSessionProgression(original.session,rewritten));
 const unguided=structuredClone(original);unguided.session.practice_demo.active_tests[0].additional_operations_ranked_text='2. invalid';assert.throws(()=>validateCheckpointRequest(unguided));
});
