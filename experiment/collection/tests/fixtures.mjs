import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { makeTrial, getRule, getGeneralisationProbes, CURRENT_RULESET_VERSION } from "../../app/lib/experiment.ts";
const practiceFixture = JSON.parse(readFileSync(new URL("../../tests/fixtures/og1-browser-practice.json", import.meta.url), "utf8"));
export function initialSession(variant, participant, ruleset = CURRENT_RULESET_VERSION) {
  const session = structuredClone(practiceFixture);
  Object.assign(session, { schema_version: "2.6.0", experiment_version: "zendo-og1-ranked-1.0.0", ruleset_version: ruleset, session_id: randomUUID(), participant_code: participant, variant, language: "sl", status: "instructions", completed_at: null, trials: [], instruction_comprehension_attempts: [], comprehension_attempts: [], resume_count: 0, interruptions: [], last_checkpoint_at: session.started_at });
  session.practice_demo = { ...session.practice_demo, practice_order: "edit_first", started_at: null, active_tests: [], generalisation_probes: [], generalisation_selection_events: [], generalisation_started_at: null, generalisation_completed_at: null, completed_at: null };
  session.demographics = { age_years: variant === "adult" ? 22 : 9, age_months: 0, gender: "synthetic", collected_at: session.started_at, engagement: null, difficulty: null, feedback: "", submitted_at: null, ...(variant === "adult" ? { study_year: "2", study_level: "1. stopnja" } : { school: "SYNTHETIC SCHOOL", class_number: "5", class_letter: "B" }) };
  return session;
}
export function checkpoints(variant, participant, ruleset = CURRENT_RULESET_VERSION) {
  const session = initialSession(variant, participant, ruleset);
  const result = [];
  const save = (type, trial = null, scene = null) => {
    session.last_checkpoint_at = new Date().toISOString();
    result.push({ checkpoint_id: randomUUID(), checkpoint_type: type, checkpoint_revision: result.length + 1, trial_index: trial, scene_index: scene, client_timestamp: session.last_checkpoint_at, session: structuredClone(session) });
  };
  save("session_started");
  session.practice_demo.started_at = practiceFixture.practice_demo.started_at;
  save("practice_demo_started");
  for (const source of practiceFixture.practice_demo.active_tests) {
    const record = structuredClone(source);
    record.hypothesis_required = true; record.hypothesis_text = "Ne vem";
    record.operation_prompted = record.practice_stage === "open";
    record.additional_operations_ranked_text = record.operation_prompted ? "  2. Preverim nujnost – čšž\n3. Poiščem novo pravilo  " : "";
    if (!record.operation_prompted) { record.operations_selected = []; record.primary_operation = null; record.other_operation_text = ""; }
    session.practice_demo.active_tests.push(record);
    save("practice_active_test", null, record.scene_index);
  }
  Object.assign(session.practice_demo, { generalisation_started_at: practiceFixture.practice_demo.generalisation_started_at, generalisation_probes: practiceFixture.practice_demo.generalisation_probes.map(probe => ({ ...structuredClone(probe), selected: false })) });
  save("practice_generalisation_started");
  Object.assign(session.practice_demo, { generalisation_probes: structuredClone(practiceFixture.practice_demo.generalisation_probes), generalisation_selection_events: structuredClone(practiceFixture.practice_demo.generalisation_selection_events), generalisation_completed_at: practiceFixture.practice_demo.generalisation_completed_at, completed_at: practiceFixture.practice_demo.completed_at });
  save("practice_demo_completed");
  session.comprehension_attempts = structuredClone(practiceFixture.comprehension_attempts);
  session.status = "active";
  session.trials.push(makeTrial(session.rule_order[0], 0, ruleset));
  save("comprehension_feedback_acknowledged", 0);
  for (let index = 0; index < 5; index++) {
    const trial = session.trials[index];
    for (let turn = 0; turn < 7; turn++) {
      const record = structuredClone(session.practice_demo.active_tests[2]);
      delete record.practice_stage;
      const time = new Date().toISOString();
      Object.assign(record, { scene_id: randomUUID(), scene_index: turn + 2, transition_index: turn, construction_mode: "fresh", anchor_scene_id: null, action_events: [], hypothesis_text: "Ne vem", hypothesis_required: true, operation_prompted: true, construction_started_at: time, report_completed_at: time, tested_at: time, feedback_shown_at: time, construction_duration_ms: 0 });
      record.label = getRule(trial.rule_id, ruleset).evaluate(record.scene);
      trial.active_tests.push(record);
      save("active_test", index, record.scene_index);
    }
    trial.generalisation_started_at = new Date().toISOString();
    trial.generalisation_probes = getGeneralisationProbes(trial.rule_id, ruleset).map((probe, display_position) => ({ probe_id: probe.id, scene: structuredClone(probe.scene), true_label: getRule(trial.rule_id, ruleset).evaluate(probe.scene), selected: false, display_position }));
    save("generalisation_started", index);
    trial.generalisation_completed_at = new Date().toISOString();
    save("generalisation_completed", index);
    trial.final_rule_guess = "Synthetic final guess";
    trial.final_rule_guess_at = new Date().toISOString();
    trial.ended_at = trial.final_rule_guess_at;
    if (index === 4) session.status = "debrief";
    else session.trials.push(makeTrial(session.rule_order[index + 1], index + 1, ruleset));
    save("trial_completed", index);
  }
  Object.assign(session.demographics, { engagement: 4, difficulty: 4, feedback: "SYNTHETIC", submitted_at: new Date().toISOString() });
  session.status = "complete"; session.completed_at = new Date().toISOString();
  save("session_completed", 4);
  return result;
}

// In-memory transactional storage only: no real databases or records are read.
export class MemoryStorage {
  constructor() { this.values = new Map(); this.chain = Promise.resolve(); }
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { return this.values.delete(key); }
  async setAlarm(value) { this.alarm = value; }
  async getAlarm() { return this.alarm ?? null; }
  async list({ prefix = "", startAfter = "", end, limit = Infinity } = {}) { return new Map([...this.values].filter(([key]) => key.startsWith(prefix) && key > startAfter && (!end || key < end)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([key, value]) => [key, structuredClone(value)])); }
  transaction(fn) {
    const task = this.chain.catch(() => {}).then(async () => {
      const saved = new Map(this.values);
      try { return await fn(this); } catch (error) { this.values = saved; throw error; }
    });
    this.chain = task; return task;
  }
}
export class BrowserStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
