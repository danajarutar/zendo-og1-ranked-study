import { INSTRUCTION_CHECK_KEY, PRACTICE_STAGES, practiceStages, guidedPracticeProgress } from "./og1-teaching.ts";
import {
  CURRENT_EXPERIMENT_VERSION,
  COLLECTION_EXPERIMENT_VERSION,
  CURRENT_RULESET_VERSION,
  getGeneralisationProbes,
  isRulesetVersion,
  type RulesetVersion,
  getRule,
  MAX_SCENE_OBJECTS,
  OPERATION_IDS,
  PRACTICE_GENERALISATION_PROBES,
  PRACTICE_RULE,
  PRACTICE_RULE_ENGLISH_TEXT,
  type ActionEvent,
  type ActiveTestRecord,
  type OperationId,
  type Scene,
  type StudySession,
} from "./experiment.ts";

export const MAX_CHECKPOINT_BODY_BYTES = 2_000_000;
export const SESSION_SCHEMA_VERSION = "2.6.0" as const;
export const SESSION_RULESET_VERSION = CURRENT_RULESET_VERSION;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPLETION_CODE_PATTERN = /^ZEN-[0-9A-F]{8}$/;
const EXPERIMENT_VERSIONS = new Set<string>(["zendo-og1-ranked-1.3.0", CURRENT_EXPERIMENT_VERSION, COLLECTION_EXPERIMENT_VERSION]);
const SESSION_STATUSES = new Set(["instructions", "active", "debrief", "complete"]);
const CHECKPOINT_TYPES = new Set([
  "session_started",
  "session_resumed",
  "instructions_completed",
  "instruction_scope_reviewed",
  "practice_demo_started",
  "practice_active_test",
  "practice_generalisation_started",
  "practice_generalisation_selection",
  "practice_demo_completed",
  "comprehension_reviewed",
  "comprehension_passed",
  "comprehension_feedback_acknowledged",
  "initial_positive_shown",
  "initial_positive_viewed",
  "active_test",
  "generalisation_started",
  "generalisation_selection",
  "generalisation_completed",
  "trial_completed",
  "session_completed",
]);
const LEGACY_OPERATION_IDS = new Set<OperationId>([
  "necessity",
  "sufficiency",
  "role_filler",
  "discovery",
  "other",
]);
const CURRENT_OPERATION_IDS = new Set<OperationId>(OPERATION_IDS);
const COLOURS = new Set(["red", "blue", "green"]);
const SIZES = new Set(["small", "medium", "large"]);
const SHAPES = new Set(["triangle", "square", "circle"]);
const ACTION_TYPES = new Set([
  "anchor_selected",
  "fresh_started",
  "object_added",
  "objects_removed",
  "objects_restored",
  "feature_changed",
  "selection_changed",
]);
const COMPREHENSION_KEY: Record<string, boolean> = {
  star: true,
  demonstration: false,
  source: true,
  gate: true,
  batch: true,
};

type JsonRecord = Record<string, unknown>;

export interface ValidatedCheckpointRequest {
  checkpoint_id: string;
  checkpoint_type: string;
  checkpoint_revision: number;
  trial_index: number | null;
  scene_index: number | null;
  client_timestamp: string;
  session: StudySession;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${path} mora biti predmet.`);
  return value;
}

function requireString(
  value: unknown,
  path: string,
  { min = 0, max = 10_000 }: { min?: number; max?: number } = {},
): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new Error(`${path} ni veljavno besedilo.`);
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} mora biti logična vrednost.`);
  return value;
}

function requireInteger(
  value: unknown,
  path: string,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${path} mora biti celo število.`);
  }
  return value as number;
}

function requireFiniteNumber(
  value: unknown,
  path: string,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${path} mora biti končno število.`);
  }
  return value;
}

function requireUuid(value: unknown, path: string): string {
  const uuid = requireString(value, path, { min: 36, max: 36 });
  if (!UUID_PATTERN.test(uuid)) throw new Error(`${path} mora biti UUID.`);
  return uuid;
}

function requireIso(value: unknown, path: string): string {
  const timestamp = requireString(value, path, { min: 20, max: 30 });
  if (!Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) {
    throw new Error(`${path} mora biti kanonični čas ISO 8601.`);
  }
  return timestamp;
}

function requireNullableIso(value: unknown, path: string): string | null {
  return value === null ? null : requireIso(value, path);
}

function requireChronology(
  earlier: string | null,
  later: string | null,
  path: string,
): void {
  if (earlier !== null && later !== null && Date.parse(earlier) > Date.parse(later)) {
    throw new Error(`${path} ni kronološko.`);
  }
}

function requireStringArray(
  value: unknown,
  path: string,
  { max = 32 }: { max?: number } = {},
): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${path} mora biti seznam.`);
  return value.map((item, index) => requireString(item, `${path}[${index}]`, { min: 1, max: 128 }));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isScenePayload(value: unknown): value is Scene {
  try {
    validateScene(value, "scene");
    return true;
  } catch {
    return false;
  }
}

function validateScene(value: unknown, path: string): asserts value is Scene {
  const scene = requireRecord(value, path);
  if (!Array.isArray(scene.objects) || scene.objects.length > 8) {
    throw new Error(`${path}.objects mora vsebovati največ osem likov.`);
  }
  const ids = new Set<string>();
  const slots = new Set<number>();
  scene.objects.forEach((rawObject, index) => {
    const object = requireRecord(rawObject, `${path}.objects[${index}]`);
    const id = requireString(object.id, `${path}.objects[${index}].id`, { min: 1, max: 128 });
    const slot = requireInteger(object.slot, `${path}.objects[${index}].slot`, { min: 0, max: 7 });
    if (ids.has(id) || slots.has(slot)) throw new Error(`${path} vsebuje podvojen ID ali položaj.`);
    ids.add(id);
    slots.add(slot);
    if (!COLOURS.has(object.colour as string)) throw new Error(`${path} vsebuje neveljavno barvo.`);
    if (!SIZES.has(object.size as string)) throw new Error(`${path} vsebuje neveljavno velikost.`);
    if (!SHAPES.has(object.shape as string)) throw new Error(`${path} vsebuje neveljavno obliko.`);
  });
  if ([...slots].sort((a, b) => a - b).some((slot, index) => slot !== index)) {
    throw new Error(`${path} mora uporabljati zaporedne položaje.`);
  }
}

export function isActionEventPayload(value: unknown): value is ActionEvent {
  try {
    validateActionEvent(value, "action_event");
    return true;
  } catch {
    return false;
  }
}

function validateActionEvent(value: unknown, path: string): asserts value is ActionEvent {
  const event = requireRecord(value, path);
  requireUuid(event.event_id, `${path}.event_id`);
  if (!ACTION_TYPES.has(event.event_type as string)) throw new Error(`${path}.event_type ni veljaven.`);
  requireIso(event.timestamp, `${path}.timestamp`);
  requireFiniteNumber(event.elapsed_ms, `${path}.elapsed_ms`);
  if (event.object_ids !== undefined) requireStringArray(event.object_ids, `${path}.object_ids`, { max: 8 });
  if (event.feature !== undefined && !["colour", "size", "shape"].includes(event.feature as string)) {
    throw new Error(`${path}.feature ni veljaven.`);
  }
  if (event.anchor_scene_id !== undefined && event.anchor_scene_id !== null) {
    requireString(event.anchor_scene_id, `${path}.anchor_scene_id`, { min: 1, max: 128 });
  }
}

function validateOperations(
  record: JsonRecord,
  path: string,
  experimentVersion: string,
  expectedPrompted: boolean,
): void {
  const prompted = requireBoolean(record.operation_prompted, `${path}.operation_prompted`);
  if (prompted !== expectedPrompted) throw new Error(`${path} ima napačno stanje poziva operacije.`);
  const operations = requireStringArray(record.operations_selected, `${path}.operations_selected`, { max: 6 });
  const allowed = experimentVersion === "zendo-simplified-1.6.2"
    ? LEGACY_OPERATION_IDS
    : CURRENT_OPERATION_IDS;
  if (new Set(operations).size !== operations.length || operations.some((item) => !allowed.has(item as OperationId))) {
    throw new Error(`${path}.operations_selected ne ustreza različici eksperimenta.`);
  }
  const primary = record.primary_operation;
  const otherText = requireString(record.other_operation_text, `${path}.other_operation_text`, { max: 2_000 });
  const rankedText = experimentVersion === CURRENT_EXPERIMENT_VERSION || experimentVersion === COLLECTION_EXPERIMENT_VERSION
    ? requireString(record.additional_operations_ranked_text, `${path}.additional_operations_ranked_text`, { max: 4_000 })
    : "";
  if (!prompted) {
    if (operations.length !== 0 || primary !== null || otherText !== "" || rankedText !== "") {
      throw new Error(`${path} mora ohraniti strukturno manjkajoč prvi odgovor.`);
    }
    return;
  }
  if (operations.length === 0 || typeof primary !== "string" || !operations.includes(primary)) {
    throw new Error(`${path}.primary_operation mora biti ena od izbranih operacij.`);
  }
  if (
    (experimentVersion === "zendo-simplified-1.8.0" || EXPERIMENT_VERSIONS.has(experimentVersion)) &&
    (operations.length !== 1 || primary !== operations[0])
  ) {
    throw new Error(`${path} mora vsebovati natanko eno izbrano operacijo.`);
  }
  if (EXPERIMENT_VERSIONS.has(experimentVersion) && primary !== operations[0]) {
    throw new Error(`${path}.primary_operation mora biti prva izbrana operacija.`);
  }
  if (operations.includes("other") ? otherText.trim().length < 3 : otherText !== "") {
    throw new Error(`${path}.other_operation_text ni skladen z izbiro.`);
  }
}

function validateActiveTest(
  value: unknown,
  path: string,
  experimentVersion: string,
  expectedSceneIndex: number,
  expectedTransitionIndex: number,
  availableAnchors: Set<string>,
  expectedLabel: (scene: Scene) => boolean,
  practice: boolean,
): asserts value is ActiveTestRecord {
  const record = requireRecord(value, path);
  requireUuid(record.scene_id, `${path}.scene_id`);
  if (record.scene_index !== expectedSceneIndex || record.transition_index !== expectedTransitionIndex) {
    throw new Error(`${path} ima napačen kronološki indeks.`);
  }
  const mode = record.construction_mode;
  if (mode !== "fresh" && mode !== "edit") throw new Error(`${path}.construction_mode ni veljaven.`);
  if (mode === "fresh") {
    if (record.anchor_scene_id !== null) throw new Error(`${path} svež prizor ne sme imeti sidra.`);
  } else {
    const anchor = requireString(record.anchor_scene_id, `${path}.anchor_scene_id`, { min: 1, max: 128 });
    if (!availableAnchors.has(anchor)) throw new Error(`${path} uporablja neznano ali prihodnje sidro.`);
  }
  validateScene(record.scene, `${path}.scene`);
  if (EXPERIMENT_VERSIONS.has(experimentVersion) && (record.scene as Scene).objects.length > MAX_SCENE_OBJECTS) {
    throw new Error(`${path}.scene sme vsebovati največ štiri like.`);
  }
  if ((record.scene as Scene).objects.length === 0) throw new Error(`${path}.scene ne sme biti prazen.`);
  if (requireBoolean(record.label, `${path}.label`) !== expectedLabel(record.scene as Scene)) {
    throw new Error(`${path}.label se ne ujema z zamrznjenim pravilom.`);
  }
  const hypothesis = requireString(record.hypothesis_text, `${path}.hypothesis_text`, { max: 5_000 });
  if (record.hypothesis_required !== undefined) {
    if (!requireBoolean(record.hypothesis_required, `${path}.hypothesis_required`) || hypothesis.trim().length === 0) {
      throw new Error(`${path}.hypothesis_text zahteva ugibanje ali »Ne vem«.`);
    }
  }
  const legacyPractice = practice && !EXPERIMENT_VERSIONS.has(experimentVersion);
  if (legacyPractice && hypothesis !== "") {
    throw new Error(`${path}.hypothesis_text ni veljaven.`);
  }
  validateOperations(
    record,
    path,
    experimentVersion,
    // Older guided records retain their original prompted responses unchanged.
    practice && (record.practice_stage === "guided_edit" || record.practice_stage === "guided_fresh") && record.operation_prompted === false
      ? false
      : EXPERIMENT_VERSIONS.has(experimentVersion) || expectedTransitionIndex > 0,
  );
  if (!Array.isArray(record.action_events) || record.action_events.length > 5_000) {
    throw new Error(`${path}.action_events mora biti omejen seznam.`);
  }
  const constructionStartedAt = requireIso(record.construction_started_at, `${path}.construction_started_at`);
  const reportCompletedAt = requireIso(record.report_completed_at, `${path}.report_completed_at`);
  const actionIds = new Set<string>();
  let previousActionTimestamp: string | null = null;
  let previousElapsed = -1;
  record.action_events.forEach((event, index) => {
    validateActionEvent(event, `${path}.action_events[${index}]`);
    const action = event as ActionEvent;
    if (actionIds.has(action.event_id)) throw new Error(`${path}.action_events vsebuje podvojen event_id.`);
    actionIds.add(action.event_id);
    requireChronology(constructionStartedAt, action.timestamp, `${path}.action_events[${index}].timestamp`);
    requireChronology(action.timestamp, reportCompletedAt, `${path}.action_events[${index}].timestamp`);
    requireChronology(previousActionTimestamp, action.timestamp, `${path}.action_events chronology`);
    if (action.elapsed_ms < previousElapsed) throw new Error(`${path}.action_events elapsed_ms ni kronološki.`);
    previousActionTimestamp = action.timestamp;
    previousElapsed = action.elapsed_ms;
  });
  requireIso(record.tested_at, `${path}.tested_at`);
  requireIso(record.feedback_shown_at, `${path}.feedback_shown_at`);
  const duration = requireFiniteNumber(record.construction_duration_ms, `${path}.construction_duration_ms`);
  if (previousElapsed > duration) throw new Error(`${path}.action_events presega construction_duration_ms.`);
  requireChronology(
    record.construction_started_at as string,
    record.report_completed_at as string,
    `${path}.construction_started_at/report_completed_at`,
  );
  requireChronology(
    record.report_completed_at as string,
    record.tested_at as string,
    `${path}.report_completed_at/tested_at`,
  );
  requireChronology(
    record.tested_at as string,
    record.feedback_shown_at as string,
    `${path}.tested_at/feedback_shown_at`,
  );
}

function validateProbes(
  value: unknown,
  path: string,
  definitions: typeof PRACTICE_GENERALISATION_PROBES,
  expectedLabel: (scene: Scene) => boolean,
): void {
  if (!Array.isArray(value) || (value.length !== 0 && value.length !== 8)) {
    throw new Error(`${path} mora biti prazen ali vsebovati osem prizorov.`);
  }
  if (value.length === 0) return;
  const byId = new Map(definitions.map((definition) => [definition.id, definition.scene]));
  const ids = new Set<string>();
  const positions = new Set<number>();
  value.forEach((rawProbe, index) => {
    const probe = requireRecord(rawProbe, `${path}[${index}]`);
    const id = requireString(probe.probe_id, `${path}[${index}].probe_id`, { min: 1, max: 64 });
    const expectedScene = byId.get(id);
    if (!expectedScene || ids.has(id)) throw new Error(`${path} vsebuje tuj ali podvojen probe_id.`);
    ids.add(id);
    validateScene(probe.scene, `${path}[${index}].scene`);
    if (!sameJson(probe.scene, expectedScene)) throw new Error(`${path}[${index}].scene je spremenjen.`);
    if (requireBoolean(probe.true_label, `${path}[${index}].true_label`) !== expectedLabel(probe.scene as Scene)) {
      throw new Error(`${path}[${index}].true_label je napačen.`);
    }
    requireBoolean(probe.selected, `${path}[${index}].selected`);
    const position = requireInteger(probe.display_position, `${path}[${index}].display_position`, { min: 0, max: 7 });
    if (positions.has(position)) throw new Error(`${path} vsebuje podvojen prikazni položaj.`);
    positions.add(position);
  });
}

function validateSelectionEvents(
  value: unknown,
  path: string,
  validProbeIds: Set<string>,
  startedAt: string | null,
  completedAt: string | null,
): Map<string, boolean> {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error(`${path} mora biti omejen seznam.`);
  const selections = new Map([...validProbeIds].map((id) => [id, false]));
  let previousTimestamp: string | null = null;
  let previousElapsed = -1;
  value.forEach((rawEvent, index) => {
    const event = requireRecord(rawEvent, `${path}[${index}]`);
    const id = requireString(event.probe_id, `${path}[${index}].probe_id`, { min: 1, max: 64 });
    if (!validProbeIds.has(id)) throw new Error(`${path}[${index}] kaže na neznan prizor.`);
    const selected = requireBoolean(event.selected, `${path}[${index}].selected`);
    const timestamp = requireIso(event.timestamp, `${path}[${index}].timestamp`);
    const elapsed = requireFiniteNumber(event.elapsed_ms, `${path}[${index}].elapsed_ms`);
    if (!startedAt) throw new Error(`${path} obstaja pred začetkom generalizacije.`);
    requireChronology(startedAt, timestamp, `${path}[${index}].timestamp`);
    requireChronology(timestamp, completedAt, `${path}[${index}].timestamp`);
    requireChronology(previousTimestamp, timestamp, `${path} chronology`);
    if (elapsed < previousElapsed) throw new Error(`${path}.elapsed_ms ni kronološki.`);
    if (selections.get(id) === selected) throw new Error(`${path}[${index}] ne spremeni izbire.`);
    selections.set(id, selected);
    previousTimestamp = timestamp;
    previousElapsed = elapsed;
  });
  return selections;
}

function requireProbeSelectionState(
  probes: unknown,
  selections: Map<string, boolean>,
  path: string,
): void {
  if (!Array.isArray(probes)) return;
  probes.forEach((rawProbe, index) => {
    const probe = rawProbe as JsonRecord;
    if (probe.selected !== selections.get(probe.probe_id as string)) {
      throw new Error(`${path}[${index}].selected se ne ujema z zgodovino izbir.`);
    }
  });
}

function validatePractice(
  session: JsonRecord,
  experimentVersion: string,
  sessionStartedAt: string,
): void {
  const practice = requireRecord(session.practice_demo, "session.practice_demo");
  if (practice.practice_order !== undefined && practice.practice_order !== "edit_first" && practice.practice_order !== "fresh_first") {
    throw new Error("Neveljaven session.practice_demo.practice_order.");
  }
  const stages = practiceStages(practice.practice_order);
  const expectedPracticeRuleText = session.language === "en"
    ? PRACTICE_RULE_ENGLISH_TEXT
    : PRACTICE_RULE.slovene;
  if (practice.rule_id !== PRACTICE_RULE.id || practice.rule_text !== expectedPracticeRuleText) {
    throw new Error("session.practice_demo ne uporablja zamrznjenega prikaznega pravila.");
  }
  const started = requireNullableIso(practice.started_at, "session.practice_demo.started_at");
  requireChronology(sessionStartedAt, started, "session.started_at/practice_demo.started_at");
  if (!Array.isArray(practice.active_tests) || practice.active_tests.length > PRACTICE_STAGES.length) {
    throw new Error("session.practice_demo.active_tests mora vsebovati največ tri prizore.");
  }
  const anchors = new Set<string>(EXPERIMENT_VERSIONS.has(experimentVersion) ? ["practice-initial"] : []);
  practice.active_tests.forEach((test, index) => {
    validateActiveTest(
      test,
      `session.practice_demo.active_tests[${index}]`,
      experimentVersion,
      index + 1,
      index,
      anchors,
      PRACTICE_RULE.evaluate,
      true,
    );
    const record = test as ActiveTestRecord;
    if (record.practice_stage !== stages[index]) throw new Error("Napačna stopnja vaje.");
    if (!guidedPracticeProgress(stages[index], record.scene, record.action_events, record.anchor_scene_id, record.construction_mode === "fresh" ? "fresh" : "existing").ready) throw new Error("Vodena vaja ni zaključena.");
    const sceneId = record.scene_id;
    if (anchors.has(sceneId)) throw new Error("session.practice_demo.active_tests vsebuje podvojen scene_id.");
    anchors.add(sceneId);
  });
  validateProbes(
    practice.generalisation_probes,
    "session.practice_demo.generalisation_probes",
    PRACTICE_GENERALISATION_PROBES,
    PRACTICE_RULE.evaluate,
  );
  const generalisationStarted = requireNullableIso(
    practice.generalisation_started_at,
    "session.practice_demo.generalisation_started_at",
  );
  const generalisationCompleted = requireNullableIso(
    practice.generalisation_completed_at,
    "session.practice_demo.generalisation_completed_at",
  );
  const completed = requireNullableIso(practice.completed_at, "session.practice_demo.completed_at");
  const practiceSelections = validateSelectionEvents(
    practice.generalisation_selection_events,
    "session.practice_demo.generalisation_selection_events",
    new Set(PRACTICE_GENERALISATION_PROBES.map((probe) => probe.id)),
    generalisationStarted,
    generalisationCompleted,
  );
  requireProbeSelectionState(
    practice.generalisation_probes,
    practiceSelections,
    "session.practice_demo.generalisation_probes",
  );
  if (practice.active_tests.length > 0 && !started) {
    throw new Error("Prikazni preizkusi nimajo časa začetka prikaza.");
  }
  if (generalisationStarted && (
    practice.active_tests.length !== PRACTICE_STAGES.length ||
    (practice.generalisation_probes as unknown[]).length !== 8
  )) {
    throw new Error("Prikazna generalizacija se je začela brez treh preizkusov in osmih sond.");
  }
  if (completed && (
    practice.active_tests.length !== PRACTICE_STAGES.length ||
    (practice.generalisation_probes as unknown[]).length !== 8 ||
    !generalisationStarted ||
    !generalisationCompleted
  )) {
    throw new Error("Zaključen prikaz nima vseh zahtevanih podatkov.");
  }
  if (completed && !(practice.generalisation_probes as JsonRecord[]).some((probe) => probe.selected === true)) {
    throw new Error("Zaključen prikaz mora vsebovati vsaj en izbran prizor.");
  }
  if (Boolean(generalisationCompleted) !== Boolean(completed)) {
    throw new Error("Zaključek prikazne generalizacije in prikaza ni usklajen.");
  }
  requireChronology(started, generalisationStarted, "practice_demo.started_at/generalisation_started_at");
  requireChronology(
    generalisationStarted,
    generalisationCompleted,
    "practice_demo.generalisation_started_at/generalisation_completed_at",
  );
  requireChronology(generalisationCompleted, completed, "practice_demo.generalisation_completed_at/completed_at");
}

function validateComprehension(value: unknown, key = COMPREHENSION_KEY): void {
  if (!Array.isArray(value) || value.length > 100) throw new Error("session.comprehension_attempts ni veljaven.");
  value.forEach((rawAttempt, index) => {
    const attempt = requireRecord(rawAttempt, `session.comprehension_attempts[${index}]`);
    if (attempt.attempt !== index + 1) throw new Error("Poskusi razumevanja niso kronološki.");
    const answers = requireRecord(attempt.answers, `session.comprehension_attempts[${index}].answers`);
    if (!sameJson(Object.keys(answers).sort(), Object.keys(key).sort())) {
      throw new Error("Odgovori razumevanja nimajo zamrznjenega besedišča.");
    }
    let correct = 0;
    for (const [answerKey, expected] of Object.entries(key)) {
      if (requireBoolean(answers[answerKey], `answers.${answerKey}`) === expected) correct += 1;
    }
    if (attempt.correct_count !== correct || attempt.passed !== (correct === Object.keys(key).length)) {
      throw new Error("Rezultat preverjanja razumevanja je napačen.");
    }
    requireIso(attempt.timestamp, `session.comprehension_attempts[${index}].timestamp`);
  });
}

function validateTrials(
  session: JsonRecord,
  experimentVersion: string,
  ruleOrder: number[],
  sessionStartedAt: string,
): void {
  if (!Array.isArray(session.trials) || session.trials.length > 5) {
    throw new Error("session.trials mora vsebovati največ pet pravil.");
  }
  const trialIds = new Set<string>();
  session.trials.forEach((rawTrial, trialIndex) => {
    const trial = requireRecord(rawTrial, `session.trials[${trialIndex}]`);
    const trialId = requireUuid(trial.trial_id, `session.trials[${trialIndex}].trial_id`);
    if (trialIds.has(trialId)) throw new Error("session.trials vsebuje podvojen trial_id.");
    trialIds.add(trialId);
    if (trial.trial_index !== trialIndex || trial.rule_id !== ruleOrder[trialIndex]) {
      throw new Error("session.trials ni usklajen z rule_order.");
    }
    const rule = getRule(trial.rule_id as number, session.ruleset_version as RulesetVersion);
    const trialStartedAt = requireIso(trial.started_at, `session.trials[${trialIndex}].started_at`);
    requireChronology(sessionStartedAt, trialStartedAt, `session.started_at/trials[${trialIndex}].started_at`);
    const endedAt = requireNullableIso(trial.ended_at, `session.trials[${trialIndex}].ended_at`);
    if (trial.initial_scene_id !== `rule-${rule.id}-initial`) throw new Error("Začetni ID prizora je napačen.");
    validateScene(trial.initial_scene, `session.trials[${trialIndex}].initial_scene`);
    if (!sameJson(trial.initial_scene, rule.initialScene) || trial.initial_label !== true) {
      throw new Error("Začetni prizor ali oznaka je spremenjena.");
    }
    const baseline = requireString(trial.baseline_hypothesis, `session.trials[${trialIndex}].baseline_hypothesis`, { max: 5_000 });
    if (baseline !== "" || trial.baseline_hypothesis_at !== null) {
      throw new Error("Ta različica ne zbira osnovne hipoteze.");
    }
    if (!Array.isArray(trial.active_tests) || trial.active_tests.length > 7) {
      throw new Error("Vsako pravilo sme imeti največ sedem aktivnih preizkusov.");
    }
    const anchors = new Set<string>([trial.initial_scene_id as string]);
    trial.active_tests.forEach((test, index) => {
      validateActiveTest(
        test,
        `session.trials[${trialIndex}].active_tests[${index}]`,
        experimentVersion,
        index + 2,
        index,
        anchors,
        rule.evaluate,
        false,
      );
      const record = test as ActiveTestRecord;
      if (record.practice_stage !== undefined) throw new Error("Glavni preizkus ne sme biti označen kot vaja.");
      const sceneId = record.scene_id;
      if (anchors.has(sceneId)) throw new Error(`session.trials[${trialIndex}].active_tests vsebuje podvojen scene_id.`);
      anchors.add(sceneId);
    });
    validateProbes(
      trial.generalisation_probes,
      `session.trials[${trialIndex}].generalisation_probes`,
      getGeneralisationProbes(rule.id, session.ruleset_version as RulesetVersion),
      rule.evaluate,
    );
    const generalisationStarted = requireNullableIso(
      trial.generalisation_started_at,
      `session.trials[${trialIndex}].generalisation_started_at`,
    );
    const generalisationCompleted = requireNullableIso(
      trial.generalisation_completed_at,
      `session.trials[${trialIndex}].generalisation_completed_at`,
    );
    const finalGuess = requireString(trial.final_rule_guess, `session.trials[${trialIndex}].final_rule_guess`, { max: 5_000 });
    const finalGuessAt = requireNullableIso(trial.final_rule_guess_at, `session.trials[${trialIndex}].final_rule_guess_at`);
    const selections = validateSelectionEvents(
      trial.generalisation_selection_events,
      `session.trials[${trialIndex}].generalisation_selection_events`,
      new Set(getGeneralisationProbes(rule.id, session.ruleset_version as RulesetVersion).map((probe) => probe.id)),
      generalisationStarted,
      generalisationCompleted,
    );
    requireProbeSelectionState(
      trial.generalisation_probes,
      selections,
      `session.trials[${trialIndex}].generalisation_probes`,
    );
    const postGeneralisationGuess = experimentVersion !== "zendo-og1-ranked-1.3.0";
    if (generalisationCompleted && !generalisationStarted) {
      throw new Error("Zaključena generalizacija zahteva začetek generalizacije.");
    }
    if (generalisationStarted && (
      trial.active_tests.length !== 7 ||
      (trial.generalisation_probes as unknown[]).length !== 8 ||
      (!postGeneralisationGuess && (finalGuess.trim().length < 3 || !finalGuessAt))
    )) {
      throw new Error("Generalizacija se je začela brez vseh aktivnih podatkov.");
    }
    if (postGeneralisationGuess) {
      const lastTest = (trial.active_tests as ActiveTestRecord[]).at(-1);
      requireChronology(lastTest?.feedback_shown_at ?? null, generalisationStarted, "feedback_shown_at/generalisation_started_at");
      if (finalGuessAt || finalGuess !== "") {
        if (!generalisationCompleted || trial.active_tests.length !== 7 || !finalGuessAt || finalGuess.trim().length < 3) {
          throw new Error("Končna hipoteza zahteva zaključeno generalizacijo in veljaven odgovor.");
        }
        requireChronology(generalisationCompleted, finalGuessAt, "generalisation_completed_at/final_rule_guess_at");
      }
      if (Boolean(endedAt) !== Boolean(finalGuessAt)) {
        throw new Error("Zaključeno pravilo zahteva končno hipotezo po generalizaciji.");
      }
      requireChronology(finalGuessAt, endedAt, "final_rule_guess_at/ended_at");
    } else if (trial.active_tests.length === 7) {
      const lastTest = trial.active_tests[6] as ActiveTestRecord;
      if (finalGuess.trim().length < 3 || finalGuess !== lastTest.hypothesis_text || finalGuessAt !== lastTest.report_completed_at) {
        throw new Error("Končna hipoteza mora biti odgovor pred sedmim preizkusom.");
      }
      requireChronology(finalGuessAt, lastTest.tested_at, "final_rule_guess_at/tested_at");
      requireChronology(finalGuessAt, lastTest.feedback_shown_at, "final_rule_guess_at/feedback_shown_at");
    } else if (finalGuess !== "" || finalGuessAt !== null) {
      throw new Error("Končna hipoteza je izven dovoljenega časovnega mesta.");
    }
    if (endedAt && (!generalisationStarted || !generalisationCompleted)) {
      throw new Error("Zaključeno pravilo nima zaključene generalizacije.");
    }
    if (generalisationCompleted && !endedAt && !postGeneralisationGuess) {
      throw new Error("Zaključena generalizacija nima časa zaključka pravila.");
    }
    requireChronology(trialStartedAt, generalisationStarted, `trials[${trialIndex}].started_at/generalisation_started_at`);
    requireChronology(
      generalisationStarted,
      generalisationCompleted,
      `trials[${trialIndex}].generalisation_started_at/generalisation_completed_at`,
    );
    requireChronology(generalisationCompleted, endedAt, `trials[${trialIndex}].generalisation_completed_at/ended_at`);
  });
}

function validateDemographics(value: unknown, required: boolean): void {
  if (value === null) {
    throw new Error("Seja nima začetnih demografskih podatkov.");
  }
  const demographics = requireRecord(value, "session.demographics");
  requireInteger(demographics.age_years, "session.demographics.age_years", { min: 5, max: 100 });
  requireInteger(demographics.age_months, "session.demographics.age_months", { min: 0, max: 11 });
  requireString(demographics.gender, "session.demographics.gender", { min: 1, max: 128 });
  requireIso(demographics.collected_at, "session.demographics.collected_at");
  if (demographics.submitted_at === null) {
    if (required || demographics.engagement !== null || demographics.difficulty !== null || demographics.feedback !== "") {
      throw new Error("Zaključne ocene še niso oddane ali pa manjkajo.");
    }
    return;
  }
  requireInteger(demographics.engagement, "session.demographics.engagement", { min: 1, max: 7 });
  requireInteger(demographics.difficulty, "session.demographics.difficulty", { min: 1, max: 7 });
  requireString(demographics.feedback, "session.demographics.feedback", { max: 10_000 });
  requireIso(demographics.submitted_at, "session.demographics.submitted_at");
}

export function validateStudySessionPayload(value: unknown): asserts value is StudySession {
  const session = requireRecord(value, "session");
  const experimentVersion = requireString(session.experiment_version, "session.experiment_version");
  if (!EXPERIMENT_VERSIONS.has(experimentVersion)) throw new Error("Neveljavna experiment_version.");
  const expectedSchema = experimentVersion === COLLECTION_EXPERIMENT_VERSION ? "2.6.0" : experimentVersion === CURRENT_EXPERIMENT_VERSION ? SESSION_SCHEMA_VERSION : "2.3.0";
  if (session.schema_version !== expectedSchema) throw new Error("Neveljavna schema_version za experiment_version.");
  if (!isRulesetVersion(session.ruleset_version)) throw new Error("Neveljavna ruleset_version.");
  requireUuid(session.session_id, "session.session_id");
  const completionCode = requireString(session.completion_code, "session.completion_code", { min: 12, max: 12 });
  if (!COMPLETION_CODE_PATTERN.test(completionCode)) throw new Error("Neveljavna completion_code.");
  const participantCode = requireString(session.participant_code, "session.participant_code", { min: 2, max: 128 });
  if (
    participantCode !== participantCode.trim() ||
    [...participantCode].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error("Neveljavna participant_code.");
  }
  if (session.variant !== "adult" && session.variant !== "child") throw new Error("Neveljavna variant.");
  if (session.language !== "sl" && session.language !== "en") throw new Error("Neveljaven language.");
  if (!SESSION_STATUSES.has(session.status as string)) throw new Error("Neveljaven status.");
  const startedAt = requireIso(session.started_at, "session.started_at");
  const completedAt = requireNullableIso(session.completed_at, "session.completed_at");
  const consentAt = requireIso(session.consent_confirmed_at, "session.consent_confirmed_at");
  requireChronology(startedAt, consentAt, "session.started_at/consent_confirmed_at");
  requireChronology(startedAt, completedAt, "session.started_at/completed_at");
  if ((session.status === "complete") !== Boolean(completedAt)) {
    throw new Error("status in completed_at nista usklajena.");
  }
  if (!Array.isArray(session.rule_order) || !sameJson([...session.rule_order].sort(), [1, 2, 3, 4, 5])) {
    throw new Error("session.rule_order mora biti permutacija petih pravil.");
  }
  const ruleOrder = session.rule_order.map((value, index) =>
    requireInteger(value, `session.rule_order[${index}]`, { min: 1, max: 5 }));
  validatePractice(session, experimentVersion, startedAt);
  validateComprehension(session.instruction_comprehension_attempts, INSTRUCTION_CHECK_KEY);
  validateComprehension(session.comprehension_attempts);
  // The optional legacy scope quiz is no longer shown; retain any saved attempts.
  validateTrials(session, experimentVersion, ruleOrder, startedAt);
  validateDemographics(session.demographics, session.status === "complete");
  if (experimentVersion === COLLECTION_EXPERIMENT_VERSION) {
    const demographics = requireRecord(session.demographics, "session.demographics");
    const required = session.variant === "adult" ? ["study_year", "study_level"] : ["school", "class_number", "class_letter"];
    const absent = session.variant === "adult" ? ["school", "class_number", "class_letter"] : ["study_year", "study_level"];
    for (const key of required) {
      const text = requireString(demographics[key], `demographics.${key}`, { min: 1, max: 200 });
      if (!text.trim() || text !== text.trim()) throw new Error(`Neveljavno polje ${key}.`);
    }
    for (const key of absent) if (demographics[key] !== undefined) throw new Error(`Nepričakovano polje ${key}.`);
    if (!Array.isArray(session.interruptions) || session.interruptions.length !== session.resume_count) throw new Error("Neveljaven dnevnik prekinitev.");
    let previousResume = startedAt;
    for (const value of session.interruptions) {
      const interruption = requireRecord(value, "interruption");
      const resumed = requireIso(interruption.resumed_at, "interruption.resumed_at");
      const saved = requireIso(interruption.last_local_save_at, "interruption.last_local_save_at");
      requireChronology(startedAt, saved, "interruption.saved");
      requireChronology(saved, resumed, "interruption.resumed");
      requireChronology(previousResume, resumed, "interruption.order");
      previousResume = resumed;
      requireString(interruption.phase, "interruption.phase", { min: 1, max: 64 });
      requireInteger(interruption.trial_index, "interruption.trial_index", { min: 0, max: 4 });
      requireIso(interruption.construction_started_at, "interruption.construction_started_at");
    }
  }
  const device = requireRecord(session.device, "session.device");
  requireString(device.user_agent, "session.device.user_agent", { max: 2_000 });
  requireInteger(device.viewport_width, "session.device.viewport_width", { min: 1, max: 100_000 });
  requireInteger(device.viewport_height, "session.device.viewport_height", { min: 1, max: 100_000 });
  requireString(device.timezone, "session.device.timezone", { min: 1, max: 256 });
  requireInteger(session.resume_count, "session.resume_count", { min: 0, max: 10_000 });
  requireNullableIso(session.last_checkpoint_at, "session.last_checkpoint_at");
  if (session.status !== "instructions") {
    const practice = session.practice_demo as unknown as JsonRecord;
    const attempts = session.comprehension_attempts as JsonRecord[];

    // validateComprehension() has already checked all five answers and the score.
    // Preserve the approved OG correction-review route and the actual failed score.
    const quizCompleted = attempts.some((attempt) => attempt.passed === true) ||
      (EXPERIMENT_VERSIONS.has(experimentVersion) && attempts.length > 0);

    if (!practice.completed_at || !quizCompleted) {
      throw new Error("Aktivna seja nima zaključenega prikaza in preverjanja razumevanja.");
    }
  }
  if (session.status === "instructions" && (session.trials as unknown[]).length !== 0) {
    throw new Error("Seja v navodilih ne sme vsebovati glavnih pravil.");
  }
  if (session.status === "active" && (session.trials as unknown[]).length < 1) {
    throw new Error("Aktivna seja nima trenutnega pravila.");
  }
  if (session.status === "active") {
    const trials = session.trials as JsonRecord[];
    if (trials[trials.length - 1].ended_at !== null || trials.slice(0, -1).some((trial) => !trial.ended_at)) {
      throw new Error("Aktivna seja nima natanko enega odprtega trenutnega pravila.");
    }
  }
  if (session.status === "debrief" || session.status === "complete") {
    if ((session.trials as unknown[]).length !== 5 || (session.trials as JsonRecord[]).some((trial) => !trial.ended_at)) {
      throw new Error("Zaključna seja nima petih zaključenih pravil.");
    }
  }
}

export function isStudySessionPayload(value: unknown): value is StudySession {
  try {
    validateStudySessionPayload(value);
    return true;
  } catch {
    return false;
  }
}

function requireArrayPrefix(previous: unknown[], next: unknown[], path: string): void {
  if (
    next.length < previous.length ||
    previous.some((item, index) => !sameJson(item, next[index]))
  ) {
    throw new Error(`${path} mora ohraniti že shranjeno predpono.`);
  }
}

function requireOnceSet(previous: unknown, next: unknown, path: string): void {
  if (previous !== null && previous !== "" && !sameJson(previous, next)) {
    throw new Error(`${path} se po shranjevanju ne sme spremeniti.`);
  }
}

function requireProbeProgression(
  previous: StudySession["practice_demo"]["generalisation_probes"],
  next: StudySession["practice_demo"]["generalisation_probes"],
  path: string,
): void {
  if (previous.length === 0) return;
  if (next.length !== previous.length) {
    throw new Error(`${path} se po prikazu ne sme odstraniti.`);
  }
  previous.forEach((probe, index) => {
    const previousFrozen = { ...probe, selected: false };
    const nextFrozen = { ...next[index], selected: false };
    if (!sameJson(previousFrozen, nextFrozen)) {
      throw new Error(`${path}[${index}] se po prikazu ne sme spremeniti.`);
    }
  });
}

/**
 * Reject a valid but stale/divergent browser snapshot.
 *
 * Revisions alone do not establish ancestry: two tabs can branch from the
 * same local checkpoint and the stale tab can later submit a larger revision.
 * Every persisted scientific record is therefore append-only (probe `selected`
 * flags may change only alongside their append-only selection-event history).
 */
export function validateSessionProgression(
  previous: StudySession,
  next: StudySession,
): void {
  validateStudySessionPayload(previous);
  validateStudySessionPayload(next);
  if (immutableSessionIdentity(previous) !== immutableSessionIdentity(next)) {
    throw new Error("Identiteta seje se ne ujema.");
  }
  if (previous.experiment_version === COLLECTION_EXPERIMENT_VERSION) requireArrayPrefix(previous.interruptions!, next.interruptions!, "session.interruptions");
  if (sessionStatusRank(next.status) < sessionStatusRank(previous.status)) {
    throw new Error("Status seje se ne sme vrniti nazaj.");
  }
  requireOnceSet(previous.completed_at, next.completed_at, "session.completed_at");
  if (!sameJson(previous.device, next.device)) {
    throw new Error("session.device se po prvem shranjevanju ne sme spremeniti.");
  }
  if (next.resume_count < previous.resume_count) {
    throw new Error("session.resume_count se ne sme zmanjšati.");
  }

  requireArrayPrefix(previous.instruction_comprehension_attempts, next.instruction_comprehension_attempts, "session.instruction_comprehension_attempts");
  if (EXPERIMENT_VERSIONS.has(next.experiment_version)) {
    const newlySavedTests = [
      ...next.practice_demo.active_tests.slice(previous.practice_demo.active_tests.length),
      ...next.trials.flatMap((trial, index) => trial.active_tests.slice(previous.trials[index]?.active_tests.length ?? 0)),
    ];
    for (const record of newlySavedTests) {
      if (record.hypothesis_required !== true || !record.hypothesis_text.trim()) {
        throw new Error("Nov preizkus zahteva ugibanje ali »Ne vem« (hypothesis_text).");
      }
    }
  }
  const previousPractice = previous.practice_demo;
  const nextPractice = next.practice_demo;
  for (const field of [
    "started_at",
    "generalisation_started_at",
    "generalisation_completed_at",
    "completed_at",
  ] as const) {
    requireOnceSet(previousPractice[field], nextPractice[field], `session.practice_demo.${field}`);
  }
  requireArrayPrefix(
    previousPractice.active_tests,
    nextPractice.active_tests,
    "session.practice_demo.active_tests",
  );
  requireProbeProgression(
    previousPractice.generalisation_probes,
    nextPractice.generalisation_probes,
    "session.practice_demo.generalisation_probes",
  );
  requireArrayPrefix(
    previousPractice.generalisation_selection_events,
    nextPractice.generalisation_selection_events,
    "session.practice_demo.generalisation_selection_events",
  );
  requireArrayPrefix(
    previous.comprehension_attempts,
    next.comprehension_attempts,
    "session.comprehension_attempts",
  );

  if (next.trials.length < previous.trials.length) {
    throw new Error("session.trials se ne sme skrajšati.");
  }
  previous.trials.forEach((previousTrial, index) => {
    const nextTrial = next.trials[index];
    for (const field of [
      "trial_id",
      "trial_index",
      "rule_id",
      "started_at",
      "initial_scene_id",
      "initial_scene",
      "initial_label",
      "baseline_hypothesis",
      "baseline_hypothesis_at",
    ] as const) {
      if (!sameJson(previousTrial[field], nextTrial[field])) {
        throw new Error(`session.trials[${index}].${field} se ne sme spremeniti.`);
      }
    }
    for (const field of [
      "ended_at",
      "generalisation_started_at",
      "generalisation_completed_at",
      "final_rule_guess",
      "final_rule_guess_at",
    ] as const) {
      requireOnceSet(previousTrial[field], nextTrial[field], `session.trials[${index}].${field}`);
    }
    requireArrayPrefix(
      previousTrial.active_tests,
      nextTrial.active_tests,
      `session.trials[${index}].active_tests`,
    );
    if (previousTrial.generalisation_completed_at && (
      !sameJson(previousTrial.generalisation_probes, nextTrial.generalisation_probes) ||
      !sameJson(previousTrial.generalisation_selection_events, nextTrial.generalisation_selection_events)
    )) throw new Error("Oddane generalizacijske izbire se ne smejo spremeniti.");
    requireProbeProgression(
      previousTrial.generalisation_probes,
      nextTrial.generalisation_probes,
      `session.trials[${index}].generalisation_probes`,
    );
    requireArrayPrefix(
      previousTrial.generalisation_selection_events,
      nextTrial.generalisation_selection_events,
      `session.trials[${index}].generalisation_selection_events`,
    );
  });
  if (previous.demographics !== null) {
    if (!next.demographics || (["age_years", "age_months", "gender", "collected_at", "study_year", "study_level", "school", "class_number", "class_letter"] as const).some(key =>
      !sameJson(previous.demographics![key], next.demographics![key]))) {
      throw new Error("Začetni demografski podatki se po shranjevanju ne smejo spremeniti.");
    }
    if (previous.demographics.submitted_at !== null && !sameJson(previous.demographics, next.demographics)) {
      throw new Error("Zaključne ocene se po shranjevanju ne smejo spremeniti.");
    }
  }
}

export function validateCheckpointRequest(value: unknown): ValidatedCheckpointRequest {
  const body = requireRecord(value, "checkpoint");
  requireUuid(body.checkpoint_id, "checkpoint.checkpoint_id");
  const checkpointType = requireString(body.checkpoint_type, "checkpoint.checkpoint_type", { min: 1, max: 64 });
  if (!CHECKPOINT_TYPES.has(checkpointType)) throw new Error("Neveljavna checkpoint_type.");
  requireIso(body.client_timestamp, "checkpoint.client_timestamp");
  validateStudySessionPayload(body.session);
  const session = body.session as StudySession;
  let revision: number;
  if (body.checkpoint_revision === undefined && session.experiment_version === "zendo-simplified-1.6.2") {
    revision = Date.parse(body.client_timestamp as string);
  } else {
    revision = requireInteger(body.checkpoint_revision, "checkpoint.checkpoint_revision", { min: 1 });
  }
  const trialIndex = body.trial_index === null || body.trial_index === undefined
    ? null
    : requireInteger(body.trial_index, "checkpoint.trial_index", { min: 0, max: 4 });
  const sceneIndex = body.scene_index === null || body.scene_index === undefined
    ? null
    : requireInteger(body.scene_index, "checkpoint.scene_index", { min: 0, max: 8 });
  if (session.last_checkpoint_at !== body.client_timestamp) {
    throw new Error("checkpoint.client_timestamp se ne ujema s session.last_checkpoint_at.");
  }
  validateCheckpointContext(checkpointType, session, trialIndex, sceneIndex);
  return {
    checkpoint_id: body.checkpoint_id as string,
    checkpoint_type: checkpointType,
    checkpoint_revision: revision,
    trial_index: trialIndex,
    scene_index: sceneIndex,
    client_timestamp: body.client_timestamp as string,
    session,
  };
}

function validateCheckpointContext(
  checkpointType: string,
  session: StudySession,
  trialIndex: number | null,
  sceneIndex: number | null,
): void {
  const practice = session.practice_demo;
  const latestAttempt = session.comprehension_attempts.at(-1);
  const currentTrialIndex = session.trials.length - 1;
  const noMainIndex = new Set([
    "session_started",
    "instructions_completed",
    "instruction_scope_reviewed",
    "practice_demo_started",
    "practice_generalisation_started",
    "practice_generalisation_selection",
    "practice_demo_completed",
    "comprehension_reviewed",
  ]);
  if (noMainIndex.has(checkpointType) && (trialIndex !== null || sceneIndex !== null)) {
    throw new Error("Kontrolni zapis izven glavnih pravil ne sme imeti indeksa pravila ali prizora.");
  }
  if (checkpointType === "session_started" && (
    session.status !== "instructions" || session.trials.length !== 0 || session.resume_count !== 0 ||
    practice.started_at !== null || session.comprehension_attempts.length !== 0 || session.instruction_comprehension_attempts.length !== 0
  )) {
    throw new Error("session_started ne opisuje nove seje.");
  }
  if (checkpointType === "instruction_scope_reviewed" && (
    session.status !== "instructions" || session.trials.length !== 0 || practice.started_at !== null ||
    session.instruction_comprehension_attempts.length === 0
  )) {
    throw new Error("instruction_scope_reviewed ne opisuje preverjanja pred vajo.");
  }
  if (checkpointType === "session_resumed" && (
    session.resume_count < 1 || sceneIndex !== null ||
    (session.trials.length === 0 ? trialIndex !== 0 : trialIndex !== currentTrialIndex)
  )) {
    throw new Error("session_resumed ne opisuje obnovljene trenutne seje.");
  }
  if (checkpointType === "practice_demo_started" && (
    session.status !== "instructions" || !practice.started_at ||
    practice.active_tests.length !== 0 || practice.generalisation_started_at !== null
  )) {
    throw new Error("practice_demo_started ne opisuje začetka prikaza.");
  }
  if (checkpointType === "practice_active_test") {
    const latest = session.practice_demo.active_tests.at(-1);
    if (
      session.status !== "instructions" || trialIndex !== null || !latest ||
      sceneIndex !== latest.scene_index || practice.generalisation_started_at !== null
    ) {
      throw new Error("practice_active_test ne kaže na zadnji prikazni prizor.");
    }
  }
  if (checkpointType === "practice_generalisation_started" && (
    session.status !== "instructions" || practice.active_tests.length !== PRACTICE_STAGES.length ||
    !practice.generalisation_started_at || practice.generalisation_completed_at !== null ||
    practice.generalisation_selection_events.length !== 0
  )) {
    throw new Error("practice_generalisation_started ne opisuje začetka prikazne generalizacije.");
  }
  if (checkpointType === "practice_generalisation_selection" && (
    session.status !== "instructions" || !practice.generalisation_started_at ||
    practice.generalisation_completed_at !== null ||
    practice.generalisation_selection_events.length === 0
  )) {
    throw new Error("practice_generalisation_selection ne vsebuje nove prikazne izbire.");
  }
  if (checkpointType === "practice_demo_completed" && (
    session.status !== "instructions" || !practice.completed_at ||
    !practice.generalisation_completed_at
  )) {
    throw new Error("practice_demo_completed ne opisuje zaključenega prikaza.");
  }
  if (checkpointType === "instructions_completed" && (
    session.status !== "instructions" || !practice.completed_at || session.trials.length !== 0
  )) {
    throw new Error("instructions_completed ne opisuje prehoda po zaključenem prikazu.");
  }
  if (checkpointType === "comprehension_reviewed" && (
    session.status !== "instructions" || !latestAttempt || latestAttempt.passed
  )) {
    throw new Error("comprehension_reviewed ne opisuje neuspešnega pregledanega poskusa.");
  }
  if (["comprehension_passed", "comprehension_feedback_acknowledged"].includes(checkpointType)) {
    if (session.status !== "active" || trialIndex !== 0 || sceneIndex !== null) {
      throw new Error("Prehod preverjanja razumevanja ne kaže na začetek prvega pravila.");
    }
    if (
      !latestAttempt ||
      (checkpointType === "comprehension_passed" ? !latestAttempt.passed : latestAttempt.passed)
    ) {
      throw new Error("Prehod preverjanja razumevanja nima ustreznega zadnjega poskusa.");
    }
  }
  if (["initial_positive_shown", "initial_positive_viewed"].includes(checkpointType)) {
    const trial = trialIndex === null ? undefined : session.trials[trialIndex];
    if (
      session.status !== "active" || trialIndex !== currentTrialIndex || !trial ||
      trial.active_tests.length !== 0 || trial.generalisation_started_at !== null ||
      sceneIndex !== 1
    ) {
      throw new Error("Kontrolni zapis začetnega primera ima napačen indeks.");
    }
  }
  if (checkpointType === "active_test") {
    const trial = trialIndex === null ? undefined : session.trials[trialIndex];
    const latest = trial?.active_tests.at(-1);
    if (
      session.status !== "active" || trialIndex !== currentTrialIndex || !trial || !latest ||
      trial.generalisation_started_at !== null || sceneIndex !== latest.scene_index
    ) {
      throw new Error("active_test ne kaže na zadnji aktivni preizkus.");
    }
  }
  if (["generalisation_started", "generalisation_selection", "generalisation_completed", "trial_completed"].includes(checkpointType)) {
    const trial = trialIndex === null ? undefined : session.trials[trialIndex];
    if (!trial || sceneIndex !== null || !trial.generalisation_started_at) {
      throw new Error("Kontrolni zapis generalizacije ima napačen kontekst.");
    }
    if (checkpointType === "trial_completed" && !trial.ended_at) {
      throw new Error("trial_completed ne kaže na zaključeno pravilo.");
    }
    if (checkpointType === "generalisation_started" && (
      session.status !== "active" || trialIndex !== currentTrialIndex ||
      trial.active_tests.length !== 7 || trial.generalisation_completed_at !== null ||
      trial.generalisation_selection_events.length !== 0
    )) {
      throw new Error("generalisation_started ne opisuje začetka trenutne generalizacije.");
    }
    if (checkpointType === "generalisation_selection" && (
      session.status !== "active" || trialIndex !== currentTrialIndex ||
      trial.generalisation_completed_at !== null ||
      trial.generalisation_selection_events.length === 0
    )) {
      throw new Error("generalisation_selection ne vsebuje nove izbire.");
    }
    if (checkpointType === "generalisation_completed" && (
      ![CURRENT_EXPERIMENT_VERSION, COLLECTION_EXPERIMENT_VERSION].includes(session.experiment_version as typeof CURRENT_EXPERIMENT_VERSION) || session.status !== "active" ||
      trialIndex !== currentTrialIndex || !trial.generalisation_completed_at || trial.ended_at || trial.final_rule_guess_at
    )) {
      throw new Error("generalisation_completed ne opisuje končanih izbir pred končno hipotezo.");
    }
    if (checkpointType === "trial_completed") {
      const lastRule = trialIndex === 4;
      const validLast = lastRule && session.status === "debrief" && session.trials.length === 5;
      const validIntermediate = !lastRule && session.status === "active" &&
        session.trials.length === (trialIndex as number) + 2 &&
        session.trials.at(-1)?.ended_at === null;
      if (!validLast && !validIntermediate) {
        throw new Error("trial_completed nima veljavnega naslednjega stanja seje.");
      }
    }
  }
  if (checkpointType === "session_completed" && (
    session.status !== "complete" || trialIndex !== 4 || sceneIndex !== null
  )) {
    throw new Error("session_completed ne opisuje zaključene seje.");
  }
}

export function immutableSessionIdentity(session: StudySession): string {
  return JSON.stringify({
    schema_version: session.schema_version,
    experiment_version: session.experiment_version,
    ruleset_version: session.ruleset_version,
    session_id: session.session_id,
    completion_code: session.completion_code,
    participant_code: session.participant_code,
    variant: session.variant,
    language: session.language,
    started_at: session.started_at,
    consent_confirmed_at: session.consent_confirmed_at,
    rule_order: session.rule_order,
    practice_order: session.practice_demo.practice_order,
  });
}

export function sessionStatusRank(status: StudySession["status"]): number {
  return ["instructions", "active", "debrief", "complete"].indexOf(status);
}
