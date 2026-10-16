import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { checkpoints } from "./fixtures.mjs";
import { latestSessions } from "../scripts/researcher.mjs";
import { fetchUpdates, validateArchive, updateStudyData, readBackup, sessionFolder, withDownloadLock } from "../scripts/study-data.mjs";

const participant = "a".repeat(32);
const records = checkpoints("child", participant).slice(0, 4).map((checkpoint, i) => ({ sequence: i + 1, received_at: checkpoint.client_timestamp, checkpoint }));
const archive = rows => ({ format: "zendo-og1-ranked-export-v1", exported_at: "2026-10-16T10:00:00.000Z", snapshot: rows.length, sessions: latestSessions([...rows]), checkpoints: rows });
const page = (rows, snapshot, next = null) => ({ format: "zendo-og1-ranked-checkpoints-v1", environment: "production", snapshot, records: rows, next });
async function temporary(t) {
  const parent = resolve(tmpdir());
  const dir = await mkdtemp(join(parent, "zendo-stable-export-"));
  t.after(async () => { assert.equal(dirname(resolve(dir)), parent); await rm(dir, { recursive: true, force: true }); });
  return dir;
}

test("incremental download starts at the saved cursor and keeps a fixed snapshot", async () => {
  const calls = [];
  const result = await fetchUpdates(archive(records.slice(0, 2)), async (after, snapshot) => {
    calls.push([after, snapshot]);
    return after === 2 ? page([records[2]], 4, 3) : page([records[3]], 4);
  });
  assert.deepEqual(calls, [[2, undefined], [3, 4]]);
  assert.equal(result.added, 2);
  assert.deepEqual(result.data.checkpoints, records);
  assert.deepEqual(result.data.sessions, archive(records).sessions);
});

test("unchanged download leaves backup and individual bytes and modification times untouched", async t => {
  const dir = await temporary(t), initial = archive(records.slice(0, 2));
  const researcher = [{ participant }];
  await updateStudyData(dir, initial, [], researcher);
  const sessionPath = join(dir, "Sessions", sessionFolder(initial.sessions[0], true), "session.json");
  const backupPath = join(dir, "Backup/full-checkpoints.json");
  const before = await Promise.all([stat(sessionPath), stat(backupPath)]);
  const fetched = await fetchUpdates(initial, async after => { assert.equal(after, 2); return page([], 2); });
  assert.equal(fetched.data, initial);
  const result = await updateStudyData(dir, fetched.data, [], researcher);
  assert.equal(result.updated, 0); assert.equal(result.backupChanged, false);
  const after = await Promise.all([stat(sessionPath), stat(backupPath)]);
  assert.deepEqual(after.map(s => s.mtimeMs), before.map(s => s.mtimeMs));
  await updateStudyData(dir, archive(records), [], researcher);
  assert.deepEqual(await readdir(join(dir, "Sessions")), [sessionFolder(initial.sessions[0], true)]);
  assert.deepEqual(JSON.parse(await readFile(sessionPath, "utf8")).session, archive(records).sessions[0]);
  assert.deepEqual((await readBackup(dir)).checkpoints, records);
});

test("new sessions get separate folders while setup records remain only in the full backup", async t => {
  const dir = await temporary(t);
  const b = checkpoints("adult", "b".repeat(32))[0];
  const c = checkpoints("child", "c".repeat(32))[0];
  const rows = [records[0], { sequence: 2, checkpoint: b }, { sequence: 3, checkpoint: c }];
  const data = archive(rows);
  const result = await updateStudyData(dir, data, [{ participant: "c".repeat(32) }], [{ participant }]);
  assert.equal(result.sessions, 2);
  assert.equal((await readdir(join(dir, "Sessions"))).length, 2);
  assert.equal((await readBackup(dir)).sessions.length, 3);
  assert.deepEqual(JSON.parse(await readFile(join(dir, "Sessions", sessionFolder(data.sessions[1], false), "session.json"), "utf8")).session, data.sessions[1]);
});

test("bad pages, missing history and stale replacements cannot overwrite good data", async t => {
  const dir = await temporary(t), good = archive(records);
  await updateStudyData(dir, good, [], []);
  const original = await readFile(join(dir, "Backup/full-checkpoints.json"), "utf8");
  await assert.rejects(updateStudyData(dir, archive(records.slice(0, 2)), [], []), /previously downloaded/);
  await assert.rejects(fetchUpdates(good, async () => { throw Error("offline"); }), /offline/);
  await assert.rejects(fetchUpdates(archive(records.slice(0, 2)), async () => page([records[3]], 4)), /reordered/);
  await assert.rejects(fetchUpdates(good, async () => page([], 5, 4)), /cursor/);
  await assert.rejects(fetchUpdates(good, async () => page([], 5)), /ended/);
  await assert.rejects(fetchUpdates(archive(records.slice(0, 2)), async after => after === 2 ? page([records[2]], 4, 3) : page([records[3]], 5)), /changing/);
  const altered = structuredClone(good); altered.sessions = structuredClone(altered.sessions); altered.sessions[0].resume_count++;
  assert.throws(() => validateArchive(altered), /do not match/);
  assert.equal(await readFile(join(dir, "Backup/full-checkpoints.json"), "utf8"), original);
});

test("download lock rejects overlap, releases after failure, and missing derived files can be repaired", async t => {
  const dir = await temporary(t), good = archive(records);
  await assert.rejects(withDownloadLock(dir, async () => {
    await assert.rejects(withDownloadLock(dir, async () => {}), /Another download/);
    throw Error("download interrupted");
  }), /interrupted/);
  await withDownloadLock(dir, async () => updateStudyData(dir, good, [], []));
  const sessionPath = join(dir, "Sessions", sessionFolder(good.sessions[0], false), "session.json");
  await rm(sessionPath);
  const result = await updateStudyData(dir, good, [], []);
  assert.equal(result.updated, 1); assert.equal(result.backupChanged, false);
  assert.deepEqual(JSON.parse(await readFile(sessionPath, "utf8")).session, good.sessions[0]);
});
