import { readFile, readdir, realpath, lstat, mkdir, writeFile, rm, rmdir } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { updateStudyData, readBackup, validateArchive, withDownloadLock, sessionFolder } from "./study-data.mjs";
import { exportGroups } from "./export-groups.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const legacy = resolve(root, "private/exports");
const target = resolve(root, "private/Study data");
const hash = value => createHash("sha256").update(value).digest("hex");
const reportPath = resolve(root, "test-results/stable-export-migration-20261016.json");
async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory)) {
    const path = resolve(directory, entry), stat = await lstat(path);
    assert.ok(!stat.isSymbolicLink(), "Refusing a linked legacy path");
    if (stat.isDirectory()) files.push(...await filesBelow(path));
    else { assert.ok(stat.isFile()); files.push(path); }
  }
  return files.sort();
}

await withDownloadLock(target, async () => {
  assert.equal(await realpath(legacy), legacy);
  const folders = (await readdir(legacy)).sort();
  assert.ok(folders.length > 0);
  const archives = [];
  for (const folder of folders) {
    assert.match(folder, /^(?:\d{8}-\d{6}|github-recovery-verified-20261010)$/);
    const path = resolve(legacy, folder);
    assert.ok(path.startsWith(legacy + sep));
    assert.equal(await realpath(path), path);
    archives.push({ folder, data: validateArchive(JSON.parse(await readFile(resolve(path, "full-checkpoints.json"), "utf8"))) });
  }
  const existing = await readBackup(target);
  const newest = archives.reduce((a, b) => a.snapshot > b.data.snapshot ? a : b.data, existing ?? archives[0].data);
  const byCheckpoint = new Map(newest.checkpoints.map(row => [row.checkpoint.checkpoint_id, row]));
  const sessionHistory = new Set(newest.checkpoints.map(row => hash(JSON.stringify(row.checkpoint.session))));
  const inventory = [];
  for (const { folder, data } of archives) {
    for (const row of data.checkpoints) assert.deepEqual(row, byCheckpoint.get(row.checkpoint.checkpoint_id), "An old checkpoint is missing or differs");
    for (const path of await filesBelow(resolve(legacy, folder))) {
      const raw = await readFile(path), name = relative(resolve(legacy, folder), path).split(sep).join("/");
      const record = { path: relative(legacy, path).split(sep).join("/"), sha256: hash(raw), bytes: raw.length };
      if (name.endsWith(".json")) {
        const value = JSON.parse(raw.toString("utf8"));
        if (name === "full-checkpoints.json") record.kind = "backup";
        else if (["adult-sessions.json", "child-sessions.json", "researcher-test-sessions.json"].includes(name)) {
          assert.ok(Array.isArray(value.sessions));
          for (const session of value.sessions) assert.ok(sessionHistory.has(hash(JSON.stringify(session))), "An older session is not preserved in checkpoint history");
          record.kind = "derived";
        } else if (name.startsWith("individual-sessions/")) {
          assert.equal(value.format, "zendo-og1-ranked-session-v1");
          assert.ok(sessionHistory.has(hash(JSON.stringify(value.session))), "An individual session is not preserved");
          record.kind = "derived";
        } else if (["session-log-audit.json", "recovery-summary.json"].includes(name)) {
          const destination = resolve(root, "test-results/legacy-export-audits", folder + "-" + name);
          await mkdir(resolve(root, "test-results/legacy-export-audits"), { recursive: true });
          try { await writeFile(destination, raw, { flag: "wx" }); }
          catch (error) { if (error.code !== "EEXIST") throw error; }
          assert.equal(hash(await readFile(destination)), record.sha256);
          record.kind = "audit-preserved"; record.preservedAt = destination;
        } else throw new Error("Unexpected legacy file: " + name);
      } else { assert.equal(name, "individual-sessions/index.html"); record.kind = "derived-index"; }
      inventory.push(record);
    }
  }
  const smoke = JSON.parse(await readFile(resolve(root, "private/production-smoke.json"), "utf8"));
  const researcher = JSON.parse(await readFile(resolve(root, "private/researcher-tests.json"), "utf8"));
  const result = await updateStudyData(target, newest, smoke.participants, researcher.participants);
  const saved = await readBackup(target);
  assert.deepEqual(saved, newest);
  const groups = exportGroups(saved.sessions, smoke.participants, researcher.participants);
  for (const [sessions, isResearcher] of [[groups.adult, false], [groups.child, false], [groups.researcher, true]]) {
    for (const session of sessions) {
      const file = resolve(target, "Sessions", sessionFolder(session, isResearcher), "session.json");
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")).session, session);
    }
  }
  const report = { verified_at: new Date().toISOString(), target, checkpoints: newest.snapshot, individualSessions: result.sessions, oldSnapshots: archives.map(({ folder, data }) => ({ folder, snapshot: data.snapshot, exported_at: data.exported_at })), files: inventory, legacyRemoved: false };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  if (process.argv.includes("--remove-verified-legacy")) {
    // Check every absolute target and all file bytes again immediately before deletion.
    assert.equal(await realpath(legacy), legacy);
    assert.deepEqual((await readdir(legacy)).sort(), folders);
    for (const folder of folders) {
      const path = resolve(legacy, folder);
      assert.ok(path.startsWith(legacy + sep));
      assert.equal(await realpath(path), path);
      const expected = inventory.filter(f => f.path.startsWith(folder + "/"));
      const actual = await filesBelow(path);
      assert.deepEqual(actual.map(f => relative(legacy, f).split(sep).join("/")).sort(), expected.map(f => f.path).sort());
      for (const file of expected) assert.equal(hash(await readFile(resolve(legacy, file.path))), file.sha256);
      await rm(path, { recursive: true });
    }
    await rmdir(legacy);
    report.legacyRemoved = true;
    await writeFile(reportPath, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ ...result, legacyRemoved: report.legacyRemoved, directory: target }));
});
