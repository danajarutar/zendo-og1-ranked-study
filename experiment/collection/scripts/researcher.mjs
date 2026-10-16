import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256, decryptArchive } from "../server/crypto.mjs";
import { validateStudySessionPayload, validateCheckpointRequest, validateSessionProgression } from "../../app/lib/checkpoint-contract.ts";

export function sealKeyBackup(bundle, passphrase) {
  if (passphrase.length < 16) throw new Error("Use a unique backup passphrase of at least 16 characters, kept in your password manager.");
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(bundle), "utf8"), cipher.final()]);
  return { format: "zendo-key-backup-v1", salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}
export function openKeyBackup(backup, passphrase) {
  if (backup.format !== "zendo-key-backup-v1") throw new Error("Unknown backup format.");
  const key = scryptSync(passphrase, Buffer.from(backup.salt, "base64"), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(backup.iv, "base64"));
  decipher.setAuthTag(Buffer.from(backup.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(backup.ciphertext, "base64")), decipher.final()]).toString("utf8"));
}
export function latestSessions(records) {
  const ids = new Map(), sessions = new Map();
  for (const { checkpoint } of records.sort((a,b) => a.sequence - b.sequence)) {
    validateCheckpointRequest(checkpoint);
    if (ids.has(checkpoint.checkpoint_id)) {
      if (ids.get(checkpoint.checkpoint_id) !== JSON.stringify(checkpoint)) throw new Error("Conflicting duplicate checkpoint.");
      continue;
    }
    ids.set(checkpoint.checkpoint_id, JSON.stringify(checkpoint));
    const id = checkpoint.session.session_id, previous = sessions.get(id);
    if (previous) {
      if (checkpoint.checkpoint_revision !== previous.revision + 1) throw new Error("Missing or unordered checkpoint revision.");
      validateSessionProgression(previous.session, checkpoint.session);
    } else if (checkpoint.checkpoint_revision !== 1) throw new Error("Export is missing the first checkpoint.");
    sessions.set(id, { revision: checkpoint.checkpoint_revision, session: checkpoint.session });
  }
  return [...sessions.values()].map(({ session }) => { validateStudySessionPayload(session); return session; });
}
async function saveNew(path, data) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  const endpoint = process.env.ZENDO_COLLECTOR_URL;
  const admin = async (path, data) => {
    if (!endpoint || !process.env.ZENDO_ADMIN_TOKEN) throw new Error("Set ZENDO_COLLECTOR_URL and ZENDO_ADMIN_TOKEN securely; never put credentials in arguments or chat.");
    if (!endpoint.startsWith("https://") && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(endpoint)) throw new Error("HTTPS is required.");
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/admin/${path}`, { method: data ? "POST" : "GET", headers: { Authorization: `Bearer ${process.env.ZENDO_ADMIN_TOKEN}`, "Content-Type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result;
  };
  if (command === "links") {
    const [variant, countText, base, out] = args; const count = Number(countText);
    if (!["adult", "child"].includes(variant) || !Number.isInteger(count) || count < 1 || count > 200 || !out) throw new Error("links adult|child COUNT SITE_BASE_URL PRIVATE_OUTPUT.json");
    const url = new URL(base);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Use an HTTPS study URL.");
    const links = [], registrations = [];
    for (let index = 0; index < count; index++) {
      const participant = randomBytes(16).toString("hex"), token = randomBytes(32).toString("hex");
      const link = `${base.replace(/\/$/, "")}/${variant === "adult" ? "odrasli" : "otroci"}/#p=${participant}&t=${token}`;
      links.push({ participant, variant, link });
      registrations.push({ participant, variant, token_hash: await sha256(token) });
    }
    // Write before registering, so an interrupted request never loses issued links.
    await saveNew(out, { format: "zendo-private-links-v1", links, registrations });
    await admin("register", { participants: registrations });
    console.log(`Registered ${count} links. Private link list: ${resolve(out)}`);
  } else if (command === "register") {
    const bundle = JSON.parse(await readFile(args[0], "utf8"));
    console.log(await admin("register", { participants: bundle.registrations }));
  } else if (command === "status") console.log(JSON.stringify(await admin("status"), null, 2));
  else if (command === "export") {
    const records = []; let after = 0, snapshot;
    do {
      const page = await admin(`export?after=${after}${snapshot === undefined ? "" : `&snapshot=${snapshot}`}`);
      snapshot = page.snapshot; records.push(...page.records); after = page.next;
    } while (after !== null);
    const sessions = latestSessions(records);
    await saveNew(args[0], { format: "zendo-og1-ranked-export-v1", exported_at: new Date().toISOString(), snapshot, sessions, checkpoints: records });
    console.log(`Exported ${sessions.length} sessions and ${records.length} checkpoints.`);
  } else if (command === "key-backup") {
    const key = process.env.ZENDO_ARCHIVE_KEY || randomBytes(32).toString("base64");
    const keyId = process.env.ZENDO_ARCHIVE_KEY_ID;
    if (!keyId) throw new Error("Set ZENDO_ARCHIVE_KEY_ID.");
    await saveNew(args[0], sealKeyBackup({ key_id: keyId, archive_key: key }, process.env.ZENDO_BACKUP_PASSPHRASE || ""));
    console.log("Encrypted key backup created. Use install-key to put its key directly into the receiving service without displaying it.");
  } else if (command === "install-key") {
    const bundle = openKeyBackup(JSON.parse(await readFile(args[0], "utf8")), process.env.ZENDO_BACKUP_PASSPHRASE || "");
    if (!args[1]) throw new Error("Provide the receiver wrangler config path.");
    const { spawn } = await import("node:child_process");
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const wrangler = resolve(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
    const child = spawn(process.execPath, [wrangler, "secret", "put", "ARCHIVE_KEY", "--config", args[1]], { stdio: ["pipe", "inherit", "inherit"], windowsHide: true });
    child.stdin.end(bundle.archive_key);
    await new Promise((resolvePromise, reject) => { child.on("error", reject); child.on("exit", code => code === 0 ? resolvePromise() : reject(new Error("Secret installation failed."))); });
    console.log(`Installed key ${bundle.key_id}; verify ARCHIVE_KEY_ID in the receiver configuration matches.`);
  } else if (command === "recovery-backup") {
    const bundle = openKeyBackup(JSON.parse(await readFile(args[0], "utf8")), process.env.ZENDO_BACKUP_PASSPHRASE || "");
    if (!process.env.ZENDO_ADMIN_TOKEN || !endpoint) throw new Error("Researcher authorization and receiver URL are required.");
    const recovery = { ...bundle, admin_token: process.env.ZENDO_ADMIN_TOKEN, collector_url: endpoint, created_at: new Date().toISOString() };
    const sealed = sealKeyBackup(recovery, process.env.ZENDO_NEW_BACKUP_PASSPHRASE || "");
    if (JSON.stringify(openKeyBackup(sealed, process.env.ZENDO_NEW_BACKUP_PASSPHRASE)) !== JSON.stringify(recovery)) throw new Error("Recovery verification failed.");
    await saveNew(args[1], sealed);
    console.log("Portable encrypted recovery backup created and verified. Keep its passphrase separately in your password manager.");
  } else if (command === "decrypt") {
    const [backupPath, archivePath, output] = args;
    const bundle = openKeyBackup(JSON.parse(await readFile(backupPath, "utf8")), process.env.ZENDO_BACKUP_PASSPHRASE || "");
    const archive = JSON.parse(await readFile(archivePath, "utf8"));
    if (archive.header.key_id !== bundle.key_id) throw new Error("Archive and backup key IDs differ.");
    await saveNew(output, await decryptArchive(archive, bundle.archive_key));
    console.log("Archive decrypted to the requested private output file.");
  } else throw new Error("Commands: links, register, status, export, key-backup, install-key, recovery-backup, decrypt. See README.md.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
