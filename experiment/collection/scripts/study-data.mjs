import { mkdir, readFile, open, rename, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { latestSessions } from "./researcher.mjs";
import { exportGroups } from "./export-groups.mjs";

export function validateArchive(data) {
  if (data?.format !== "zendo-og1-ranked-export-v1" || !Number.isSafeInteger(data.snapshot) || data.snapshot < 0 || !Array.isArray(data.checkpoints) || data.checkpoints.length !== data.snapshot) throw new Error("Invalid or incomplete combined backup.");
  const seen = new Set();
  for (const [index, row] of data.checkpoints.entries()) {
    if (row.sequence !== index + 1 || seen.has(row.checkpoint.checkpoint_id)) throw new Error("Missing or duplicate backup checkpoint.");
    seen.add(row.checkpoint.checkpoint_id);
  }
  const sessions = latestSessions([...data.checkpoints]);
  if (!isDeepStrictEqual(sessions, data.sessions)) throw new Error("Backup sessions do not match checkpoint history.");
  return data;
}

export async function fetchUpdates(previous, fetchPage) {
  if (previous) validateArchive(previous);
  let after = previous?.snapshot ?? 0;
  let snapshot;
  const added = [];
  do {
    const page = await fetchPage(after, snapshot);
    if (page.format !== "zendo-og1-ranked-checkpoints-v1" || page.environment !== "production" || !Number.isSafeInteger(page.snapshot) || page.snapshot < after || (snapshot !== undefined && page.snapshot !== snapshot) || !Array.isArray(page.records)) throw new Error("Invalid export page or changing server snapshot.");
    snapshot = page.snapshot;
    for (const row of page.records) {
      if (row.sequence !== after + 1 || row.sequence > snapshot) throw new Error("Missing or reordered server checkpoint.");
      added.push(row);
      after = row.sequence;
    }
    if (page.next === null) {
      if (after !== snapshot) throw new Error("Server export ended before the snapshot.");
      break;
    }
    if (!page.records.length || page.next !== after || after >= snapshot) throw new Error("Server export cursor did not advance correctly.");
  } while (true);
  if (previous && added.length === 0) return { data: previous, added: 0 };
  const checkpoints = [...(previous?.checkpoints ?? []), ...added];
  const data = validateArchive({ format: "zendo-og1-ranked-export-v1", exported_at: new Date().toISOString(), snapshot, sessions: latestSessions([...checkpoints]), checkpoints });
  return { data, added: added.length };
}

export function sessionFolder(session, researcher) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(session.session_id) || !["adult", "child"].includes(session.variant)) throw new Error("Invalid session identity.");
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Ljubljana", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(session.started_at));
  const part = type => parts.find(p => p.type === type).value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  return `${researcher ? "Researcher " : ""}${session.variant === "adult" ? "Adult" : "Child"} - ${date} - ${session.session_id}`;
}

async function readOptional(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function replaceIfChanged(path, value) {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (await readOptional(path) === text) return false;
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(text, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
  return true;
}

export async function readBackup(directory) {
  const raw = await readOptional(resolve(directory, "Backup/full-checkpoints.json"));
  return raw === null ? null : validateArchive(JSON.parse(raw));
}

export async function updateStudyData(directory, data, smoke, researcher) {
  validateArchive(data);
  const previous = await readBackup(directory);
  if (previous && (data.snapshot < previous.snapshot || !isDeepStrictEqual(data.checkpoints.slice(0, previous.snapshot), previous.checkpoints))) throw new Error("Refusing to replace or remove previously downloaded checkpoint history.");
  const groups = exportGroups(data.sessions, smoke, researcher);
  const researcherIds = new Set(groups.researcher.map(s => s.session_id));
  const sessions = [...groups.adult, ...groups.child, ...groups.researcher];
  // Validate filenames before changing any files. Preserve the complete history first.
  const entries = sessions.map(session => ({ session, isResearcher: researcherIds.has(session.session_id), folder: sessionFolder(session, researcherIds.has(session.session_id)) }));
  const backupChanged = await replaceIfChanged(resolve(directory, "Backup/full-checkpoints.json"), data);
  await mkdir(resolve(directory, "Sessions"), { recursive: true });
  let updated = 0;
  for (const { session, isResearcher, folder } of entries) {
    if (await replaceIfChanged(resolve(directory, "Sessions", folder, "session.json"), {
      format: "zendo-og1-ranked-session-v1", classification: isResearcher ? "researcher-test" : "participant", session,
    })) updated++;
  }
  return { sessions: sessions.length, updated, backupChanged, snapshot: data.snapshot };
}

export async function withDownloadLock(directory, action) {
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, ".download.lock");
  let lock;
  try { lock = await open(path, "wx"); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("Another download is running, or an interrupted download left .download.lock. Close other download windows before retrying; keep the data files.");
    throw error;
  }
  try { await lock.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })); return await action(); }
  finally { await lock.close(); await unlink(path); }
}
