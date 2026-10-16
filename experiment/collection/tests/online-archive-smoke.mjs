import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decryptArchive } from "../server/crypto.mjs";
import { openKeyBackup, latestSessions } from "../scripts/researcher.mjs";

// Online integration check. Only the separate synthetic service/repository is
// permitted. Git uses its normal credential manager; no GitHub token is read.
const root = fileURLToPath(new URL("../", import.meta.url));
const endpoint = process.env.ZENDO_COLLECTOR_URL;
assert.equal(endpoint, "https://zendo-og1-ranked-collector-synthetic.rutar-danaja.workers.dev");
assert.ok(process.env.ZENDO_ADMIN_TOKEN, "Supply the synthetic admin credential securely.");
const headers = { Authorization: `Bearer ${process.env.ZENDO_ADMIN_TOKEN}` };
async function api(path, method = "GET") {
  const response = await fetch(`${endpoint}/admin/${path}`, { headers, method, signal: AbortSignal.timeout(60000) });
  const value = await response.json();
  assert.equal(response.status, 200, value.error || `HTTP ${response.status}`);
  return value;
}
let status = await api("status");
assert.equal(status.environment, "synthetic", "Refuse production.");
const target = status.received_checkpoints;
assert.ok(target >= 590, "Run the ten-participant receiver test first.");
for (let count = 0; status.archived_through < target && count < 100; count++) {
  const before = status.archived_through;
  await api("archive", "POST");
  status = await api("status");
  assert.ok(status.archived_through > before, "Archive paused without progress; check the receiver's rate-limit/error status before retrying.");
  console.log(`Archived ${status.archived_through}/${target} synthetic checkpoints.`);
}
assert.ok(status.archived_through >= target);
assert.equal(status.archive_error, null);

const exported = [];
let after = 0;
do {
  const page = await api(`export?after=${after}&snapshot=${target}`);
  assert.equal(page.snapshot, target);
  exported.push(...page.records);
  after = page.next;
} while (after !== null);
assert.equal(exported.length, target);
const sessions = latestSessions(exported);

const backup = JSON.parse(await readFile(resolve(root, "private/synthetic-key-backup.json"), "utf8"));
const recovered = openKeyBackup(backup, process.env.ZENDO_BACKUP_PASSPHRASE || "");
assert.equal(recovered.key_id, "og1-ranked-synthetic-1");
const checkout = resolve(root, `.wrangler/archive-verification-${Date.now()}`);
await mkdir(resolve(root, ".wrangler"), { recursive: true });
execFileSync("git", ["clone", "--depth", "1", "--branch", "main", "https://github.com/danajarutar/zendo-og1-ranked-responses-synthetic.git", checkout], {
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
  windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 120000,
});
const commit = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
const files = (await readdir(resolve(checkout, "synthetic"))).filter(name => name.endsWith(".json"));
const restored = [];
const ivs = new Set();
for (const name of files) {
  const envelope = JSON.parse(await readFile(resolve(checkout, "synthetic", name), "utf8"));
  assert.deepEqual(Object.keys(envelope).sort(), ["ciphertext", "header", "iv"]);
  assert.equal(envelope.header.environment, "synthetic");
  assert.equal(envelope.header.key_id, recovered.key_id);
  assert.equal(envelope.header.algorithm, "AES-256-GCM");
  assert.ok(!ivs.has(envelope.iv), "Repeated encryption nonce.");
  ivs.add(envelope.iv);
  const records = await decryptArchive(envelope, recovered.archive_key);
  restored.push(...records.filter(row => row.sequence <= target));
}
restored.sort((a, b) => a.sequence - b.sequence);
assert.deepEqual(restored, exported, "Recovered GitHub archives must match every exported checkpoint and receipt exactly.");
assert.equal(new Set(restored.map(row => row.sequence)).size, target);
const report = {
  verified_at: new Date().toISOString(), environment: "synthetic", receiver: endpoint,
  repository: "danajarutar/zendo-og1-ranked-responses-synthetic", repository_commit: commit,
  encrypted_files: files.length, exported_checkpoints: target, restored_checkpoints: restored.length,
  sessions: sessions.length, completed_sessions: sessions.filter(session => session.status === "complete").length,
  encryption: "AES-256-GCM", key_recovery: "Recovered from encrypted researcher backup",
  exact_match: true, missing: 0, duplicated: 0, overwritten: 0,
};
await mkdir(resolve(root, "test-results"), { recursive: true });
await writeFile(resolve(root, "test-results/archive-online-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
