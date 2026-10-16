import { CURRENT_RULESET_VERSION } from "../../app/lib/experiment.ts";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const kind = process.argv[2];
if (!["production", "synthetic", "review"].includes(kind)) throw new Error("Choose production, synthetic or review.");
const root = fileURLToPath(new URL("../", import.meta.url));
const suffix = kind === "production" ? "" : kind === "synthetic" ? "test/" : "review/";
const endpoint = `https://zendo-og1-ranked-collector${kind === "synthetic" ? "-synthetic" : ""}.rutar-danaja.workers.dev`;
const env = { ...process.env, STUDY_BASE_PATH: `/zendo-og1-ranked-study/${suffix}`, STUDY_OUTPUT_DIR: `.wrangler/builds/${kind}`, VITE_REVIEW: String(kind === "review"), VITE_SYNTHETIC: String(kind === "synthetic"), VITE_COLLECTOR_URL: kind === "review" ? "" : endpoint };
const result = spawnSync(process.execPath, [resolve(root, "../../node_modules/vite/bin/vite.js"), "build"], { cwd: root, env, stdio: "inherit", windowsHide: true });
if (result.status !== 0) process.exit(result.status || 1);
const source = await readFile(resolve(root, "../app/components/ZendoStudy.tsx"));
await writeFile(resolve(root, env.STUDY_OUTPUT_DIR, "release.json"), JSON.stringify({ release: "og1-ranked-2026-10-16", kind, ruleset: CURRENT_RULESET_VERSION, built_at: new Date().toISOString(), component_sha256: createHash("sha256").update(source).digest("hex"), collector: kind === "review" ? null : endpoint, experiment: kind === "review" ? "zendo-og1-ranked-preview-1.0.0" : "zendo-og1-ranked-1.0.0", schema: kind === "review" ? "2.6.0" : "2.6.0" }, null, 2));
