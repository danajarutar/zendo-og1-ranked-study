import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchUpdates, readBackup, updateStudyData, withDownloadLock } from "./study-data.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = resolve(root, "private/Study data");
try {
  const endpoint = process.env.ZENDO_COLLECTOR_URL;
  if (endpoint !== "https://zendo-og1-ranked-collector.rutar-danaja.workers.dev" || !process.env.ZENDO_ADMIN_TOKEN) throw new Error("The configured production collector and protected researcher credential are required.");
  const smoke = JSON.parse(await readFile(resolve(root, "private/production-smoke.json"), "utf8"));
  const researcher = JSON.parse(await readFile(resolve(root, "private/researcher-tests.json"), "utf8"));
  if (researcher.format !== "zendo-researcher-tests-v1" || !Array.isArray(researcher.participants) || researcher.participants.some(p => !/^[a-f0-9]{32}$/.test(p.participant))) throw new Error("Invalid researcher classification manifest.");
  const result = await withDownloadLock(directory, async () => {
    const previous = await readBackup(directory);
    const { data, added } = await fetchUpdates(previous, async (after, snapshot) => {
      const response = await fetch(`${endpoint}/admin/export?after=${after}${snapshot === undefined ? "" : `&snapshot=${snapshot}`}`, {
        headers: { Authorization: `Bearer ${process.env.ZENDO_ADMIN_TOKEN}` }, signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}. Existing local data is retained.`);
      return response.json();
    });
    return { added, ...await updateStudyData(directory, data, smoke.participants, researcher.participants) };
  });
  console.log(`Downloaded ${result.added} new checkpoints. Updated ${result.updated} of ${result.sessions} individual sessions.`);
  console.log(`Sessions: ${resolve(directory, "Sessions")}`);
  console.log(`Combined backup: ${resolve(directory, "Backup/full-checkpoints.json")}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
