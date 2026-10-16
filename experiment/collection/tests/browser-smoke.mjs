import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { sha256 } from "../server/crypto.mjs";
import { checkpoints } from "./fixtures.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const endpoint = process.env.ZENDO_COLLECTOR_URL || "http://127.0.0.1:8791";
const base = process.env.ZENDO_SITE_URL || "http://127.0.0.1:4193/zendo-og1-ranked-study";
const adminToken = process.env.ZENDO_ADMIN_TOKEN || "SYNTHETIC-LOCAL-ADMIN";
const adminHeaders = { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" };
const adminState = await (await fetch(`${endpoint}/admin/status`, { headers: adminHeaders })).json();
assert.equal(adminState.environment, "synthetic", "Browser test must never target production.");
await mkdir(new URL("../test-results/", import.meta.url), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const report = [];
const wait = async (page, condition) => page.waitForFunction(condition, null, { timeout: 15000 });
async function identity(variant) {
  const participant = randomBytes(16).toString("hex"), token = randomBytes(32).toString("hex"), writer = randomUUID();
  const response = await fetch(`${endpoint}/admin/register`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ participants: [{ participant, variant, token_hash: await sha256(token) }] }) });
  assert.equal(response.status, 200);
  return { participant, token, writer, variant, key: `zendo-og1-ranked-collection-v1:${participant}:${variant}`, link: `${base}/${variant === "adult" ? "odrasli" : "otroci"}/#p=${participant}&t=${token}`, headers: { Authorization: `Bearer ${token}`, "X-Participant": participant, "X-Writer": writer, "Content-Type": "application/json" } };
}
async function seed(id, phase) {
  const records = checkpoints(id.variant, id.participant);
  let index;
  if (phase === "practiceEditor") index = 1;
  else if (phase === "practiceFeedback") index = 2;
  else if (phase === "editor") index = records.findIndex(item => item.checkpoint_type === "comprehension_feedback_acknowledged");
  else if (phase === "feedback") index = records.findIndex(item => item.checkpoint_type === "active_test");
  else if (phase === "generalisation") index = records.findIndex(item => item.checkpoint_type === "generalisation_started");
  else if (phase === "finalRuleGuess") index = records.findIndex(item => item.checkpoint_type === "generalisation_completed");
  else if (phase === "demographics") index = records.length - 2;
  else if (phase === "complete") index = records.length - 1;
  for (const record of records.slice(0, index + 1)) {
    const response = await fetch(`${endpoint}/checkpoint`, { method: "POST", headers: id.headers, body: JSON.stringify(record) });
    assert.equal(response.status, 200, `${phase}: ${await response.text()}`);
  }
  const session = records[index].session;
  const feedback = phase.startsWith("practice") ? session.practice_demo.active_tests.at(-1) : session.trials[0]?.active_tests.at(-1);
  return { session, phase, trialPosition: phase === "demographics" || phase === "complete" ? 4 : 0, editorScene: { objects: [{ id: "synthetic-unfinished", colour: "green", size: "small", shape: "circle", slot: 0 }] }, anchorSceneId: null, sourceChoice: "fresh", selectedIds: ["synthetic-unfinished"], constructionStartedAt: new Date().toISOString(), actionEvents: [], hypothesis: "SYNTHETIC unfinished construction answer", finalGuessDraft: "SYNTHETIC unfinished final guess", operations: ["necessity"], primaryOperation: "necessity", otherOperation: "", lastFeedback: phase.toLowerCase().includes("feedback") ? feedback : null, checkpointRevision: index + 1, instructionPage: 0, instructionLayoutVersion: 3, viewedAdditionalExamples: [], comprehensionAnswers: {}, quizReviewed: false, savedAt: new Date().toISOString(), finalQuestionnaireDraft: { engagement: 6, difficulty: 2, feedback: "SYNTHETIC unfinished questionnaire" } };
}
try {
  for (const variant of ["adult", "child"]) {
    const context = await browser.newContext(); const page = await context.newPage();
    const id = await identity(variant);
    await page.goto(id.link);
    await page.getByRole("heading", { name: /pripravljeni|pripravljen/ }).waitFor();
    assert.equal(await page.locator("input[readonly]").inputValue(), id.participant);
    const fields = variant === "adult" ? ["study_year", "study_level"] : ["school", "class_number", "class_letter"];
    for (const field of fields) { assert.equal(await page.locator(`[name=${field}]`).getAttribute("required"), ""); await page.locator(`[name=${field}]`).fill("SYNTHETIC"); }
    await page.locator("[name=age_years]").fill(variant === "adult" ? "22" : "9");
    await page.locator("[name=gender]").selectOption("prefer_not");
    await page.locator("input[type=checkbox]").check();
    await page.screenshot({ path: fileURLToPath(new URL(`../test-results/${variant}-opening.png`, import.meta.url)), fullPage: true });
    await page.getByRole("button", { name: /Poglejte navodila|Poglej navodila/ }).click();
    await wait(page, () => document.body.textContent.includes("Dobrodo"));
    await page.reload();
    await page.getByRole("button", { name: /Nadaljujte shranjeno|Nadaljuj shranjeno/ }).click();
    await wait(page, () => document.body.textContent.includes("Dobrodo"));
    const duplicate = await context.newPage(); await duplicate.goto(id.link);
    await duplicate.getByText(/že odprta v drugem zavihku/).waitFor();
    await duplicate.close();
    const other = await identity(variant); const otherPage = await context.newPage(); await otherPage.goto(other.link);
    await otherPage.getByRole("heading", { name: /pripravljeni|pripravljen/ }).waitFor();
    assert.equal(await otherPage.getByRole("button", { name: /Nadaljujte shranjeno|Nadaljuj shranjeno/ }).count(), 0);
    report.push({ variant, test: "opening, same-link reload, duplicate tab and shared-computer separation", pass: true });
    await context.close();
    for (const phase of ["practiceEditor", "practiceFeedback", "editor", "feedback", "generalisation", "finalRuleGuess", "demographics", "complete"]) {
      const id = await identity(variant); const draft = await seed(id, phase);
      const context = await browser.newContext(); let page = await context.newPage();
      await page.goto(base);
      await page.evaluate(({ id, draft }) => { localStorage.setItem(id.key, JSON.stringify(draft)); localStorage.setItem(`${id.key}:writer`, id.writer); localStorage.setItem(`${id.key}:ack`, String(draft.checkpointRevision)); }, { id, draft });
      await page.goto(id.link);
      if (phase === "complete") {
        await page.getByRole("heading", { name: "Najlepša hvala!" }).waitFor();
        assert.equal(await page.locator("[name=school]").count(), 0);
      } else {
        await page.getByRole("button", { name: /Nadaljujte shranjeno|Nadaljuj shranjeno/ }).click();
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).session.resume_count === 1, id.key);
        if (["practiceEditor", "editor"].includes(phase)) {
          draft.hypothesis = "SYNTHETIC typed before closing";
          await page.getByPlaceholder("Moje najboljše ugibanje o pravilu je …").fill(draft.hypothesis);
        }
        if (phase === "finalRuleGuess") {
          draft.finalGuessDraft = "SYNTHETIC final answer typed before closing";
          await page.locator("#final-rule-guess").fill(draft.finalGuessDraft);
        }
        if (phase === "demographics") {
          draft.finalQuestionnaireDraft.feedback = "SYNTHETIC questionnaire typed before closing";
          await page.locator("[name=feedback]").fill(draft.finalQuestionnaireDraft.feedback);
        }
        // Close the actual page, retaining only this browser profile's storage.
        await page.close(); page = await context.newPage(); await page.goto(id.link);
        await page.getByRole("button", { name: /Nadaljujte shranjeno|Nadaljuj shranjeno/ }).click();
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).session.resume_count === 2, id.key);
        const recovered = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), id.key);
        assert.equal(recovered.session.session_id, draft.session.session_id);
        assert.equal(recovered.session.participant_code, id.participant);
        assert.deepEqual(recovered.session.rule_order, draft.session.rule_order);
        assert.equal(recovered.session.practice_demo.practice_order, draft.session.practice_demo.practice_order);
        assert.equal(recovered.hypothesis, draft.hypothesis);
        assert.equal(recovered.finalGuessDraft, draft.finalGuessDraft);
        assert.deepEqual(recovered.editorScene, draft.editorScene);
        assert.deepEqual(recovered.finalQuestionnaireDraft, draft.finalQuestionnaireDraft);
        assert.deepEqual(recovered.session.trials, draft.session.trials);
        if (phase === "demographics") {
          await page.waitForFunction(key => JSON.parse(localStorage.getItem(`${key}:outbox`) || "[]").length === 0, id.key);
          let interrupted = false;
          await context.route(`${endpoint}/checkpoint`, async route => {
            if (!interrupted) { interrupted = true; await route.fetch(); await route.abort(); }
            else await route.continue();
          });
          await page.getByRole("button", { name: /Končajte in shranite|Končaj in shrani/ }).click();
          await page.getByText(/Končno shranjevanje ni uspelo/).waitFor();
          assert.equal(await page.getByRole("heading", { name: "Najlepša hvala!" }).count(), 0);
          await page.close(); page = await context.newPage(); await page.goto(id.link);
          await page.getByRole("heading", { name: "Najlepša hvala!" }).waitFor();
          report.push({ variant, test: "lost final acknowledgement, close/reopen, completion only after retry acknowledgement", pass: true });
        }
      }
      report.push({ variant, phase, test: "close/reopen preserves identity and drafts", pass: true });
      await context.close();
    }
  }
  await writeFile(new URL("../test-results/browser-report.json", import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  const page = browser.contexts().at(-1)?.pages().at(-1);
  if (page) { console.error((await page.locator("body").innerText()).slice(0,2000)); await page.screenshot({ path: resolve("og-1/collection/test-results/failure.png"), fullPage: true }); }
  throw error;
} finally { await browser.close(); }
