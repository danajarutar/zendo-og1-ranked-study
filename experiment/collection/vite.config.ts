import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = fileURLToPath(new URL(".", import.meta.url));
const output = resolve(root, process.env.STUDY_OUTPUT_DIR || "dist");
export default defineConfig({
  root, base: process.env.STUDY_BASE_PATH || "/zendo-og1-ranked-study/",
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
  plugins: [react(), { name: "pages-route-entries", apply: "build", async closeBundle() {
    for (const route of ["odrasli", "otroci"]) {
      await mkdir(`${output}/${route}`, { recursive: true });
      await copyFile(`${output}/index.html`, `${output}/${route}/index.html`);
    }
  } }],
  build: { outDir: output, emptyOutDir: true },
  server: { fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] } },
});
