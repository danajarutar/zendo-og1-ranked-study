import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { sealKeyBackup, openKeyBackup, latestSessions } from "../scripts/researcher.mjs";
import { encryptArchive, decryptArchive } from "../server/crypto.mjs";
import { modelInput } from "../scripts/model-input.mjs";
import { checkpoints } from "./fixtures.mjs";
test("encrypted researcher backup recovers the key and decrypts an archive without the original key object", async () => {
  let bundle = { key_id: "synthetic-1", archive_key: randomBytes(32).toString("base64") };
  const passphrase = "Synthetic backup passphrase only";
  const data = checkpoints("child", randomBytes(16).toString("hex")).map((checkpoint, index) => ({ sequence: index + 1, checkpoint }));
  const encrypted = await encryptArchive(data, bundle.archive_key, { key_id: bundle.key_id, environment: "synthetic" });
  const backup = JSON.parse(JSON.stringify(sealKeyBackup(bundle, passphrase)));
  bundle = null;
  assert.throws(() => openKeyBackup(backup, "wrong passphrase"));
  const restored = openKeyBackup(backup, passphrase);
  const recovered = await decryptArchive(encrypted, restored.archive_key);
  assert.deepEqual(recovered, data);
  assert.deepEqual(latestSessions(recovered), [data.at(-1).checkpoint.session]);
  assert.throws(() => latestSessions(recovered.filter(record => record.sequence !== 4)), /Missing/);
});
test("modelling adapter preserves seven pre-feedback reports and the distinct post-generalisation report", () => {
  for (const variant of ["adult", "child"]) {
    const session = checkpoints(variant, randomBytes(16).toString("hex")).at(-1).session;
    const normalized = modelInput(session);
    assert.equal(normalized.source_schema, "2.6.0");
    assert.deepEqual(normalized.demographics, session.demographics);
    for (const [index, trial] of normalized.trials.entries()) {
      assert.equal(trial.active_tests.length, 7);
      assert.deepEqual(trial.active_tests, session.trials[index].active_tests);
      assert.equal(trial.final_rule_guess, "Synthetic final guess");
      assert.ok(Date.parse(trial.final_rule_guess_at) >= Date.parse(trial.generalisation_completed_at));
    }
  }
});
