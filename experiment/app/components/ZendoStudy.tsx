"use client";

/* eslint-disable react-hooks/refs -- the monotonic checkpoint clock is read and written only by event handlers */

import { OperationIcon } from "./OperationIcon";
import type { CollectionTransport } from "../lib/collection-transport";
import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FEEDBACK_DURATION_MS, PRACTICE_STAGES, practiceStages, samplePracticeOrder, OPERATION_THOUGHTS, ADDITIONAL_OPERATION_EXAMPLES, THOUGHT_SCENE, guidedPracticeProgress, practiceRemovalToRestore, OPERATION_NAMES } from "../lib/og1-teaching";
import {
  ActionEvent,
  ActiveTestRecord,
  canResumeInCurrentExperiment,
  cloneScene,
  COLOUR_LABELS,
  Colour,
  CURRENT_EXPERIMENT_VERSION,
  COLLECTION_EXPERIMENT_VERSION,
  GENERALISATION_PROBES,
  CURRENT_RULESET_VERSION,
  getGeneralisationProbes,
  getRule,
  INSTRUCTION_EXAMPLES,
  Language,
  MAX_SCENE_OBJECTS,
  makeTrial,
  ObjectSize,
  OPERATION_IDS,
  OPERATION_LABELS,
  OperationId,
  PRACTICE_GENERALISATION_PROBES,
  PRACTICE_INITIAL_SCENE,
  PRACTICE_RULE,
  PRACTICE_RULE_ENGLISH_TEXT,
  RULES,
  Scene,
  SceneObject,
  Shape,
  SHAPE_LABELS,
  shuffle,
  SIZE_LABELS,
  StudySession,
  TrialRecord,
  Variant,
} from "../lib/experiment";
import {
  isActionEventPayload,
  isScenePayload,
  isStudySessionPayload,
} from "../lib/checkpoint-contract";

type Phase =
  | "welcome"
  | "instructions"
  | "practiceEditor"
  | "practiceFeedback"
  | "generalisationTutorial"
  | "comprehension"
  | "ruleIntro"
  | "initial"
  | "editor"
  | "feedback"
  | "generalisationIntro"
  | "generalisation"
  | "generalisationSubmitted"
  | "finalRuleGuess"
  | "generalisationConfirmed"
  | "results"
  | "demographics"
  | "complete";

type SaveState = "idle" | "saving" | "saved" | "error";

interface PersistedEnvelope {
  savedAt?: string;
  finalQuestionnaireDraft?: { engagement: number; difficulty: number; feedback: string };
  session: StudySession;
  phase: Phase;
  trialPosition: number;
  editorScene: Scene;
  anchorSceneId: string | null;
  sourceChoice?: "fresh" | "existing" | null;
  selectedIds?: string[];
  constructionStartedAt: string;
  actionEvents: ActionEvent[];
  hypothesis?: string;
  finalGuessDraft?: string;
  operations?: OperationId[];
  primaryOperation?: OperationId | "";
  otherOperation?: string;
  additionalOperations?: string;
  lastFeedback: ActiveTestRecord | null;
  checkpointRevision?: number;
  instructionPage?: number;
  instructionLayoutVersion?: number;
  viewedAdditionalExamples?: number[];
  scopeAnswers?: Record<string, boolean>;
  scopeReviewed?: boolean;
  comprehensionAnswers?: Record<string, boolean>;
  quizReviewed?: boolean;
}

const PHASES = new Set<Phase>([
  "welcome",
  "instructions",
  "practiceEditor",
  "practiceFeedback",
  "generalisationTutorial",
  "comprehension",
  "ruleIntro",
  "initial",
  "editor",
  "feedback",
  "generalisationIntro",
  "generalisation",
  "generalisationSubmitted",
  "finalRuleGuess",
  "generalisationConfirmed",
  "results",
  "demographics",
  "complete",
]);

function isPersistedEnvelope(value: unknown, variant: Variant, language: Language): value is PersistedEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const envelope = value as Partial<PersistedEnvelope>;
  return (
    isStudySessionPayload(envelope.session) &&
    envelope.session.variant === variant &&
    envelope.session.language === language &&
    PHASES.has(envelope.phase as Phase) &&
    Number.isInteger(envelope.trialPosition) &&
    Number(envelope.trialPosition) >= 0 &&
    Number(envelope.trialPosition) <= 4 &&
    isScenePayload(envelope.editorScene) &&
    (envelope.anchorSceneId === null || typeof envelope.anchorSceneId === "string") &&
    (envelope.sourceChoice === undefined || envelope.sourceChoice === null ||
      envelope.sourceChoice === "fresh" || envelope.sourceChoice === "existing") &&
    typeof envelope.constructionStartedAt === "string" &&
    Number.isFinite(Date.parse(envelope.constructionStartedAt)) &&
    Array.isArray(envelope.actionEvents) &&
    envelope.actionEvents.every(isActionEventPayload) &&
    (envelope.checkpointRevision === undefined || (
      Number.isSafeInteger(envelope.checkpointRevision) && envelope.checkpointRevision >= 0
    ))
  );
}

const MAX_OBJECTS = MAX_SCENE_OBJECTS;
const COLOUR_VALUES: Colour[] = ["red", "blue", "green"];
const SIZE_VALUES: ObjectSize[] = ["small", "medium", "large"];
const SHAPE_VALUES: Shape[] = ["triangle", "square", "circle"];
const OBJECT_COLOUR_LABELS: Record<Colour, string> = {
  red: "rdeč",
  blue: "moder",
  green: "zelen",
};
const OBJECT_SIZE_LABELS: Record<ObjectSize, string> = {
  small: "majhen",
  medium: "srednji",
  large: "velik",
};
const ENGLISH_COLOUR_LABELS: Record<Colour, string> = {
  red: "red",
  blue: "blue",
  green: "green",
};
const ENGLISH_SIZE_LABELS: Record<ObjectSize, string> = {
  small: "small",
  medium: "medium",
  large: "large",
};
const ENGLISH_SHAPE_LABELS: Record<Shape, string> = {
  triangle: "triangle",
  square: "square",
  circle: "circle",
};
const ENGLISH_RULE_LABELS: Record<number, string> = {
  1: "At least two objects have the same shape.",
  2: "All shapes are the same size.",
  3: "There is at least one red object in the scene.",
  4: "Exactly one shape is blue.",
  5: "There is at least one small blue object in the scene.",
};
const ENGLISH_INSTRUCTION_RULE_LABELS: Record<string, string> = {
  "instruction-exactly-three": "There are exactly three shapes in the scene.",
  "instruction-no-red": "There are no red shapes in the scene.",
  "instruction-at-least-one-large": "There is at least one large shape in the scene.",
};
const ENGLISH_OPERATION_LABELS: Record<OperationId, string> = {
  necessity: "You wanted to check whether a particular feature is needed for stars to appear.",
  sufficiency: "You wanted to create the simplest scene that still makes stars appear.",
  role_filler: "You wanted to check whether stars depend on what each shape is like on its own or how the shapes relate to each other.",
  counterexample: "According to your guess about the rule, this scene should not get stars. You wanted to check whether it gets them anyway.",
  discovery: "You wanted to try something very different from the previous examples to see whether stars appear.",
  other: "I wanted to check something else…",
};
const COMPREHENSION_KEY: Record<string, boolean> = {
  star: true,
  demonstration: false,
  source: true,
  gate: true,
  batch: true,
};

const STAR_DROPS = [
  { left: 4, delay: 0.1, duration: 2.8, size: 24 },
  { left: 13, delay: 1.1, duration: 3.1, size: 34 },
  { left: 23, delay: 0.5, duration: 2.5, size: 20 },
  { left: 34, delay: 1.8, duration: 3.2, size: 29 },
  { left: 44, delay: 0.2, duration: 2.7, size: 38 },
  { left: 55, delay: 1.4, duration: 3, size: 22 },
  { left: 65, delay: 0.8, duration: 2.6, size: 31 },
  { left: 75, delay: 2, duration: 3.15, size: 19 },
  { left: 85, delay: 0.35, duration: 2.9, size: 36 },
  { left: 94, delay: 1.25, duration: 2.55, size: 25 },
  { left: 18, delay: 2.25, duration: 3.25, size: 17 },
  { left: 60, delay: 2.4, duration: 2.85, size: 27 },
];

function rotate<T>(values: readonly T[], offset: number): T[] {
  return values.map((_, index) => values[(index + offset) % values.length]);
}

function nowIso() {
  return new Date().toISOString();
}

function elapsedSince(start: string) {
  return Math.max(Date.now() - new Date(start).getTime(), 0);
}

function makeCompletionCode() {
  return `ZEN-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function SceneView({
  scene,
  selectedIds = [],
  referencedIds = [],
  onObjectClick,
  compact = false,
  editable = false,
  language = "sl",
}: {
  scene: Scene;
  selectedIds?: string[];
  referencedIds?: string[];
  onObjectClick?: (objectId: string) => void;
  compact?: boolean;
  editable?: boolean;
  language?: Language;
}) {
  const objects = [...scene.objects].sort((a, b) => a.slot - b.slot);

  function renderObject(item: SceneObject) {
    const label = language === "en"
      ? `${ENGLISH_SIZE_LABELS[item.size]} ${ENGLISH_COLOUR_LABELS[item.colour]} ${ENGLISH_SHAPE_LABELS[item.shape]}`
      : `${OBJECT_SIZE_LABELS[item.size]} ${OBJECT_COLOUR_LABELS[item.colour]} ${SHAPE_LABELS[item.shape]}`;
    const selected = selectedIds.includes(item.id);
    const referenced = referencedIds.includes(item.id);
    const referenceLabel = referenced ? (language === "en" ? " — the shape the researcher refers to" : " — lik, na katerega se nanaša raziskovalčevo vprašanje") : "";
    const contents = (
      <>
        {referenced ? <span className="reference-pointer" aria-hidden="true">↓</span> : null}
        <span className={`shape-glyph shape-glyph--${item.shape}`} aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </>
    );
    return onObjectClick ? (
      <button
        type="button"
        className={`scene-object scene-object--${item.shape} scene-object--${item.colour} scene-object--${item.size} ${selected ? "is-selected" : ""}`}
        key={item.id}
        aria-label={label}
        aria-pressed={selected}
        onClick={() => onObjectClick?.(item.id)}
        title={label}
      >
        {contents}
      </button>
    ) : (
      <span
        className={`scene-object scene-object--${item.shape} scene-object--${item.colour} scene-object--${item.size}${referenced ? " is-referenced" : ""}`}
        key={item.id}
        role="img"
        aria-label={label + referenceLabel}
        title={label}
      >
        {contents}
      </span>
    );
  }

  return (
    <div className={`scene-board ${compact ? "scene-board--compact" : ""} ${editable ? "scene-board--editable" : ""}`}>
      {editable ? (
        <>
          {scene.objects.length === 0 ? <div className="empty-scene-label">{language === "en" ? "Empty scene" : "Prazen prizor"}</div> : null}
          <div className="scene-slots">
            {Array.from({ length: MAX_OBJECTS }, (_, slot) => {
              const item = objects.find((candidate) => candidate.slot === slot);
              const isNext = !item && slot === objects.length;
              return (
                <div className={item ? "scene-slot scene-slot--filled" : isNext ? "scene-slot scene-slot--next" : "scene-slot"} key={slot}>
                  {item ? renderObject(item) : <span aria-hidden="true">{isNext ? "＋" : ""}</span>}
                </div>
              );
            })}
          </div>
        </>
      ) : scene.objects.length === 0 ? (
        <div className="empty-scene">{language === "en" ? "Empty scene" : "Prazen prizor"}</div>
      ) : (
        objects.map(renderObject)
      )}
    </div>
  );
}

function StarShower({ gentle = false, once = false }: { gentle?: boolean; once?: boolean }) {
  return (
    <div className={`star-shower star-shower--positive${once ? " star-shower--once" : ""}`} aria-hidden="true">
      {STAR_DROPS.map((drop, index) => (
        <span
          key={index}
          style={{
            left: `${drop.left}%`,
            top: `${8 + (index % 3) * 25}%`,
            animationDelay: `${gentle ? -drop.duration * 0.25 : drop.delay}s`,
            animationDuration: `${gentle ? drop.duration * 2 : drop.duration}s`,
            fontSize: `${drop.size}px`,
          }}
        >
          ★
        </span>
      ))}
    </div>
  );
}

function ProgressHeader({
  variant,
  language,
  reviewOnly = false,
  trialPosition,
  sceneNumber,
  saveState,
}: {
  variant: Variant;
  language: Language;
  reviewOnly?: boolean;
  trialPosition: number;
  sceneNumber?: number;
  saveState: SaveState;
}) {
  const saveLabel = language === "en" && reviewOnly
    ? saveState === "saving"
      ? "Saving in this browser …"
      : saveState === "error"
        ? "Not saved"
        : saveState === "saved"
          ? "Saved in this browser · review copy"
          : "Review copy"
    : language === "en"
    ? saveState === "saving"
      ? "Saving …"
      : saveState === "error"
        ? "Not saved · a copy is in this browser"
        : saveState === "saved"
          ? "Saved securely"
          : "Ready"
    : saveState === "saving"
      ? "Shranjevanje …"
      : saveState === "error"
        ? "Ni shranjeno · kopija je v tem brskalniku"
        : saveState === "saved"
          ? "Varno shranjeno"
          : "Pripravljeno";
  return (
    <header className="study-header">
      <div>
        <span className="eyebrow">Zendo</span>
        <strong>{language === "en" ? (variant === "adult" ? "Adult version" : "Children's version") : variant === "adult" ? "Različica za odrasle" : "Različica za otroke"}</strong>
      </div>
      <div className="study-progress" aria-label={language === "en" ? "Progress" : "Napredek"}>
        <span>{language === "en" ? "Rule" : "Pravilo"} {Math.min(trialPosition + 1, 5)} {language === "en" ? "of" : "od"} 5</span>
        {sceneNumber ? <span>{language === "en" ? "Scene" : "Prizor"} {sceneNumber} {language === "en" ? "of" : "od"} 8</span> : null}
      </div>
      <span className={`save-state save-state--${saveState}`}>{saveLabel}</span>
    </header>
  );
}

// Standalone preview data stays in memory and is never submitted.
function makeDemoPreviewSession(variant: Variant, language: Language): StudySession {
  const startedAt = nowIso();
  return {
      schema_version: "2.6.0",
      experiment_version: CURRENT_EXPERIMENT_VERSION,
      ruleset_version: CURRENT_RULESET_VERSION,
      session_id: crypto.randomUUID(),
      completion_code: makeCompletionCode(),
      participant_code: "DEMO-PREVIEW",
      variant,
      language,
      status: "instructions",
      started_at: startedAt,
      completed_at: null,
      consent_confirmed_at: startedAt,
      rule_order: shuffle(RULES.map((rule) => rule.id)),
      practice_demo: {
        practice_order: "edit_first", // Stable server/client rendering for the in-memory preview.
        rule_id: PRACTICE_RULE.id,
        rule_text: language === "en" ? PRACTICE_RULE_ENGLISH_TEXT : PRACTICE_RULE.slovene,
        started_at: startedAt,
        active_tests: [],
        generalisation_probes: [],
        generalisation_selection_events: [],
        generalisation_started_at: null,
        generalisation_completed_at: null,
        completed_at: null,
      },
      instruction_comprehension_attempts: [],
      comprehension_attempts: [],
      trials: [],
      demographics: {
        age_years: variant === "child" ? 8 : 30,
        age_months: 0,
        gender: "preview",
        collected_at: startedAt,
        engagement: null, difficulty: null, feedback: "", submitted_at: null,
      },
      device: {
        user_agent: "demo-preview",
        viewport_width: 0,
        viewport_height: 0,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      resume_count: 0,
      last_checkpoint_at: null,
    };
}

export function ZendoStudy({
  variant,
  language = "sl",
  reviewOnly = false,
  previewResults = false,
  previewDemo = false,
  previewOperations = false,
  previewFinalQuestions = false,
  previewGeneralisation = false,
  previewFifthRule = false,
  assetPrefix = "",
  collection,
}: {
  variant: Variant;
  language?: Language;
  reviewOnly?: boolean;
  previewResults?: boolean;
  previewDemo?: boolean;
  previewOperations?: boolean;
  previewFinalQuestions?: boolean;
  previewGeneralisation?: boolean;
  previewFifthRule?: boolean;
  assetPrefix?: string;
  collection?: CollectionTransport;
}) {
  const operationReview = reviewOnly && previewOperations;
  const inMemoryPreview = operationReview || previewDemo || previewFinalQuestions || previewGeneralisation || previewFifthRule;
  const storageKey = collection?.storageKey ?? `zendo-og1-ranked-${reviewOnly ? "review-" : ""}v1.4-${variant}-${language}`;
  const isAdult = variant === "adult";
  const isEnglish = language === "en";
  const participantText = (adultSlovene: string, childSlovene: string, english: string) =>
    isEnglish ? english : isAdult ? adultSlovene : childSlovene;
  const colourLabels = isEnglish ? ENGLISH_COLOUR_LABELS : COLOUR_LABELS;
  const sizeLabels = isEnglish ? ENGLISH_SIZE_LABELS : SIZE_LABELS;
  const shapeLabels = isEnglish ? ENGLISH_SHAPE_LABELS : SHAPE_LABELS;
  const operationLabel = (operation: OperationId) =>
    isEnglish ? ENGLISH_OPERATION_LABELS[operation] : OPERATION_LABELS[operation][variant];
  const assetUrl = (path: string) => `${assetPrefix}${path}`;
  const [phase, setPhase] = useState<Phase>(operationReview ? "instructions" : previewFifthRule ? "ruleIntro" : previewGeneralisation ? "generalisation" : previewFinalQuestions ? "demographics" : previewDemo ? "practiceEditor" : previewResults ? "results" : "welcome");
  const [session, setSession] = useState<StudySession | null>(() => {
    if (!inMemoryPreview) return null;
    const preview = makeDemoPreviewSession(variant, language);
    if (previewFifthRule) {
      // Empty in-memory trials provide navigation context, never participant records.
      preview.status = "active";
      preview.rule_order = RULES.map((rule) => rule.id);
      preview.trials = preview.rule_order.map((ruleId, index) => makeTrial(ruleId, index));
    }
    if (previewGeneralisation) {
      preview.status = "active";
      preview.rule_order = RULES.map((rule) => rule.id);
      const trial = makeTrial(preview.rule_order[0], 0);
      // Illustrative constructions for this in-memory shortcut only. Do not
      // borrow the probe scenes or load/manufacture participant records.
      trial.active_tests = Array.from({ length: 7 }, (_, index): ActiveTestRecord => {
        const scene = cloneScene(trial.initial_scene);
        if (index < 3) scene.objects = scene.objects.slice(0, index + 1);
        if (index === 3) scene.objects = scene.objects.map(object => ({ ...object, colour: "blue" }));
        if (index === 4) scene.objects = scene.objects.map(object => ({ ...object, shape: "circle" }));
        if (index === 5) scene.objects = scene.objects.map((object, slot) => ({ ...object, shape: SHAPE_VALUES[slot], size: "small" }));
        if (index === 6) scene.objects = scene.objects.slice(1).map((object, slot) => ({ ...object, slot, size: "large" }));
        return {
          scene_id: `preview-construction-${index + 1}`,
          scene_index: index + 2,
          transition_index: index,
          anchor_scene_id: trial.initial_scene_id,
          construction_mode: "edit",
          scene,
          label: getRule(trial.rule_id).evaluate(scene),
          hypothesis_text: "PREVIEW ONLY",
          hypothesis_required: true,
          operation_prompted: true,
          operations_selected: ["necessity"],
          primary_operation: "necessity",
          other_operation_text: "",
          additional_operations_ranked_text: "",
          action_events: [],
          construction_started_at: trial.started_at,
          report_completed_at: trial.started_at,
          tested_at: trial.started_at,
          feedback_shown_at: trial.started_at,
          construction_duration_ms: 0,
        };
      });
      trial.generalisation_started_at = nowIso();
      trial.generalisation_probes = GENERALISATION_PROBES[trial.rule_id].map((probe, index) => ({
        probe_id: probe.id, scene: cloneScene(probe.scene),
        true_label: getRule(trial.rule_id).evaluate(probe.scene), selected: false, display_position: index,
      }));
      preview.trials = [trial];
    }
    return preview;
  });
  const [resumeCandidate, setResumeCandidate] = useState<PersistedEnvelope | null>(null);
  const [trialPosition, setTrialPosition] = useState(previewFifthRule ? 4 : 0);
  const [participantCode, setParticipantCode] = useState(collection?.participantCode ?? "");
  const [storageError, setStorageError] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [finalQuestionnaireDraft, setFinalQuestionnaireDraft] = useState({ engagement: 4, difficulty: 4, feedback: "" });
  const [consent, setConsent] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [notice, setNotice] = useState("");
  const [instructionPage, setInstructionPage] = useState(operationReview ? 3 : 0);
  const [viewedAdditionalExamples, setViewedAdditionalExamples] = useState<number[]>([]);
  const [extraExampleIndex, setExtraExampleIndex] = useState<number | null>(null);
  const [explanationIndex, setExplanationIndex] = useState<number | null>(null);
  const [editorScene, setEditorScene] = useState<Scene>({ objects: [] });
  const [anchorSceneId, setAnchorSceneId] = useState<string | null>(null);
  const [sourceChoice, setSourceChoice] = useState<"fresh" | "existing" | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionEvents, setActionEvents] = useState<ActionEvent[]>([]);
  const [constructionStartedAt, setConstructionStartedAt] = useState(nowIso());
  const [showAdd, setShowAdd] = useState(false);
  const [addMenuSequence, setAddMenuSequence] = useState(0);
  const [addColourOptions, setAddColourOptions] = useState<Colour[]>(COLOUR_VALUES);
  const [addSizeOptions, setAddSizeOptions] = useState<ObjectSize[]>(SIZE_VALUES);
  const [addShapeOptions, setAddShapeOptions] = useState<Shape[]>(SHAPE_VALUES);
  const [addColour, setAddColour] = useState<Colour>("red");
  const [addSize, setAddSize] = useState<ObjectSize>("medium");
  const [addShape, setAddShape] = useState<Shape>("triangle");
  const [hypothesis, setHypothesis] = useState("");
  const [finalGuessDraft, setFinalGuessDraft] = useState("");
  const finalGuessRef = useRef<HTMLFormElement>(null);
  const [operations, setOperations] = useState<OperationId[]>([]);
  const [primaryOperation, setPrimaryOperation] = useState<OperationId | "">("");
  const [otherOperation, setOtherOperation] = useState("");
  const [additionalOperations, setAdditionalOperations] = useState("");
  const [lastFeedback, setLastFeedback] = useState<ActiveTestRecord | null>(null);
  const inlineFeedback = phase === "feedback" || phase === "practiceFeedback";
  const feedbackBoardRef = useRef<HTMLDivElement>(null);
  const feedbackVisibleAtRef = useRef(0);

  // Scroll before paint; the feedback overlays the existing board without reflow.
  useLayoutEffect(() => {
    if (!inlineFeedback) return;
    const board = feedbackBoardRef.current;
    if (!board) return;
    // Move keyboard focus as well: a focused operation/Test control must not
    // pull the viewport back down while feedback is being shown.
    board.focus({ preventScroll: true });
    const header = board.closest("main")?.querySelector(".study-header");
    const headerHeight = header instanceof HTMLElement && getComputedStyle(header).position === "sticky" ? header.offsetHeight + 24 : 16;
    window.scrollTo({ top: Math.max(0, window.scrollY + board.getBoundingClientRect().top - headerHeight), behavior: "instant" });
    feedbackVisibleAtRef.current = performance.now();
  }, [inlineFeedback, lastFeedback?.scene_id]);
  useLayoutEffect(() => {
    if (phase === "finalRuleGuess") finalGuessRef.current?.scrollIntoView({ behavior: "instant", block: "center" });
    if (phase === "generalisationIntro" || phase === "generalisation") window.scrollTo({ top: 0, behavior: "instant" });
  }, [phase]);
  const [comprehensionAnswers, setComprehensionAnswers] = useState<Record<string, boolean>>({});
  const [quizReviewed, setQuizReviewed] = useState(false);
  const checkpointRevisionRef = useRef(0);
  const [checkpointRevision, setCheckpointRevision] = useState(0);
  useEffect(() => {
    if (!collection) return;
    return collection.subscribe(() => {
      if (checkpointRevisionRef.current > 0 && collection.acknowledgedRevision() >= checkpointRevisionRef.current) {
        setSaveState("saved");
        if (session?.status === "complete") setPhase("complete");
      }
    });
  }, [collection, session?.status]);

  const currentTrial = session?.trials[trialPosition] ?? null;
  const currentRule = currentTrial ? getRule(currentTrial.rule_id, session!.ruleset_version) : null;

  useEffect(() => {
    if (inMemoryPreview) return;
    const pendingResume = window.setTimeout(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!isPersistedEnvelope(parsed, variant, language) || (collection && (parsed.session.participant_code !== collection.participantCode || parsed.session.experiment_version !== COLLECTION_EXPERIMENT_VERSION))) {
        if (collection) { setStorageError(true); return; }
        localStorage.removeItem(storageKey);
        return;
      }
      if (collection && parsed.session.status === "complete" && collection.acknowledgedRevision() >= (parsed.checkpointRevision ?? 0)) {
        setSession(parsed.session);
        setPhase("complete");
      } else if (parsed.session.status !== "complete" || collection) {
        setResumeCandidate(parsed);
      }
    } catch {
      if (collection) setStorageError(true);
      else localStorage.removeItem(storageKey);
    } finally {
      setDraftLoaded(true);
    }
    }, 0);
    return () => window.clearTimeout(pendingResume);
  }, [language, storageKey, variant, inMemoryPreview, collection]);

  useEffect(() => {
    if (!session || inMemoryPreview || (collection && !draftLoaded)) return;
    const envelope: PersistedEnvelope = {
      savedAt: nowIso(),
      finalQuestionnaireDraft,
      session,
      phase,
      trialPosition,
      editorScene,
      anchorSceneId,
      sourceChoice,
      selectedIds,
      constructionStartedAt,
      actionEvents,
      hypothesis,
      finalGuessDraft,
      operations,
      primaryOperation,
      otherOperation,
      additionalOperations,
      lastFeedback,
      checkpointRevision, instructionPage, instructionLayoutVersion: 3, viewedAdditionalExamples, comprehensionAnswers, quizReviewed,
    };
    try { localStorage.setItem(storageKey, JSON.stringify(envelope)); }
    catch { queueMicrotask(() => setStorageError(true)); }
  }, [
    instructionPage, viewedAdditionalExamples, comprehensionAnswers, quizReviewed, inMemoryPreview, collection, draftLoaded, finalQuestionnaireDraft,
    actionEvents,
    anchorSceneId,
    constructionStartedAt,
    checkpointRevision,
    editorScene,
    lastFeedback,
    phase,
    hypothesis,
    finalGuessDraft,
    operations,
    otherOperation,
    additionalOperations,
    primaryOperation,
    selectedIds,
    session,
    storageKey,
    sourceChoice,
    trialPosition,
  ]);

  async function checkpoint(
    nextSession: StudySession,
    checkpointType: string,
    trialIndex: number | null = null,
    sceneIndex: number | null = null,
  ): Promise<{ ok: boolean; stamped: StudySession; revision: number }> {
    const clientTimestamp = nowIso();
    const stamped = { ...nextSession, last_checkpoint_at: clientTimestamp };
    const revision = checkpointRevisionRef.current + 1;
    checkpointRevisionRef.current = revision;
    setCheckpointRevision(revision);
    setSaveState("saving");
    if (reviewOnly || inMemoryPreview) {
      setSaveState("saved");
      setSession((current) =>
        current?.session_id === stamped.session_id
          ? { ...current, last_checkpoint_at: clientTimestamp }
          : current,
      );
      return { ok: true, stamped, revision };
    }
    try {
      if (collection) {
        await collection.save({
          checkpoint_id: crypto.randomUUID(), checkpoint_type: checkpointType,
          checkpoint_revision: revision, trial_index: trialIndex, scene_index: sceneIndex,
          client_timestamp: clientTimestamp, session: stamped,
        });
        if (checkpointRevisionRef.current === revision) {
          setSaveState("saved");
          setSession(current => current?.session_id === stamped.session_id ? { ...current, last_checkpoint_at: clientTimestamp } : current);
        }
        return { ok: true, stamped, revision };
      }
      const response = await fetch("/api/checkpoint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkpoint_id: crypto.randomUUID(),
          checkpoint_type: checkpointType,
          checkpoint_revision: revision,
          trial_index: trialIndex,
          scene_index: sceneIndex,
          client_timestamp: clientTimestamp,
          session: stamped,
        }),
      });
      if (!response.ok) throw new Error("save failed");
      if (checkpointRevisionRef.current === revision) {
        setSaveState("saved");
        setSession((current) =>
          current?.session_id === stamped.session_id
            ? { ...current, last_checkpoint_at: clientTimestamp }
            : current,
        );
      }
      return { ok: true, stamped, revision };
    } catch {
      if (checkpointRevisionRef.current === revision) setSaveState("error");
      return { ok: false, stamped, revision };
    }
  }

  function newAction(event: Omit<ActionEvent, "event_id" | "timestamp" | "elapsed_ms">): ActionEvent {
    return {
      ...event,
      event_id: crypto.randomUUID(),
      timestamp: nowIso(),
      elapsed_ms: elapsedSince(constructionStartedAt),
    };
  }

  function prepareEditor(source?: { id: string; scene: Scene }) {
    const startedAt = nowIso();
    setEditorScene(source ? cloneScene(source.scene) : { objects: [] });
    setAnchorSceneId(source?.id ?? null);
    setSourceChoice(source ? "existing" : null);
    setSelectedIds([]);
    setActionEvents(source ? [
      {
        event_id: crypto.randomUUID(),
        event_type: "anchor_selected",
        timestamp: startedAt,
        elapsed_ms: 0,
        anchor_scene_id: source.id,
      },
    ] : []);
    setConstructionStartedAt(startedAt);
    setHypothesis("");
    setOperations([]);
    setPrimaryOperation("");
    setOtherOperation("");
    setAdditionalOperations("");
    setShowAdd(false);
  }

  function beginEditor(_trial: TrialRecord, source?: { id: string; scene: Scene }) {
    prepareEditor(source);
    setPhase("editor");
  }

  function beginPracticeEditor(source?: { id: string; scene: Scene }) {
    prepareEditor(source);
    setPhase("practiceEditor");
  }

  function startStudy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const code = participantCode.trim();
    if (code.length < 2 || !consent || (collection && (!draftLoaded || resumeCandidate))) return;
    const startedAt = nowIso();
    const newSession: StudySession = {
      schema_version: collection ? "2.6.0" : "2.6.0",
      experiment_version: collection ? COLLECTION_EXPERIMENT_VERSION : CURRENT_EXPERIMENT_VERSION,
      ruleset_version: CURRENT_RULESET_VERSION,
      session_id: crypto.randomUUID(),
      completion_code: makeCompletionCode(),
      participant_code: code,
      variant,
      language,
      status: "instructions",
      started_at: startedAt,
      completed_at: null,
      consent_confirmed_at: startedAt,
      rule_order: shuffle(RULES.map((rule) => rule.id)),
      practice_demo: {
        practice_order: samplePracticeOrder(),
        rule_id: PRACTICE_RULE.id,
        rule_text: isEnglish ? PRACTICE_RULE_ENGLISH_TEXT : PRACTICE_RULE.slovene,
        started_at: null,
        active_tests: [],
        generalisation_probes: [],
        generalisation_selection_events: [],
        generalisation_started_at: null,
        generalisation_completed_at: null,
        completed_at: null,
      },
      instruction_comprehension_attempts: [],
      comprehension_attempts: [],
      trials: [],
      demographics: {
        ...(collection ? isAdult ? {
          study_year: String(data.get("study_year") ?? "").trim(),
          study_level: String(data.get("study_level") ?? "").trim(),
        } : {
          school: String(data.get("school") ?? "").trim(),
          class_number: String(data.get("class_number") ?? "").trim(),
          class_letter: String(data.get("class_letter") ?? "").trim(),
        } : {}),
        age_years: Number(data.get("age_years")),
        age_months: Number(data.get("age_months")),
        gender: String(data.get("gender") ?? ""),
        collected_at: startedAt,
        engagement: null, difficulty: null, feedback: "", submitted_at: null,
      },
      device: {
        user_agent: navigator.userAgent,
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      resume_count: 0,
      ...(collection ? { interruptions: [] } : {}),
      last_checkpoint_at: null,
    };
    setSession(newSession);
    setInstructionPage(0);
    setViewedAdditionalExamples([]);
    setExtraExampleIndex(null);
    setExplanationIndex(null);
    setComprehensionAnswers({});
    setQuizReviewed(false);
    checkpointRevisionRef.current = 0;
    setCheckpointRevision(0);
    setNotice("");
    setPhase("instructions");
    void checkpoint(newSession, "session_started");
  }

  function resumeStudy() {
    if (collection && resumeCandidate?.session.status === "complete") {
      setSession(resumeCandidate.session);
      setPhase("demographics");
      setCheckpointRevision(resumeCandidate.checkpointRevision ?? 0);
      checkpointRevisionRef.current = resumeCandidate.checkpointRevision ?? 0;
      setResumeCandidate(null);
      return;
    }
    if (!resumeCandidate || !canResumeInCurrentExperiment(resumeCandidate.session)) return;
    const restoredRevision = resumeCandidate.checkpointRevision ?? 0;
    checkpointRevisionRef.current = restoredRevision;
    setCheckpointRevision(restoredRevision);
    const restored = {
      ...resumeCandidate.session,
      resume_count: resumeCandidate.session.resume_count + 1,
      ...(collection ? { interruptions: [...(resumeCandidate.session.interruptions ?? []), {
        resumed_at: nowIso(), last_local_save_at: resumeCandidate.savedAt ?? resumeCandidate.session.started_at,
        phase: resumeCandidate.phase, trial_index: resumeCandidate.trialPosition,
        construction_started_at: resumeCandidate.constructionStartedAt,
      }] } : {}),
    };
    setSession(restored);
    setTrialPosition(resumeCandidate.trialPosition);
    setEditorScene(resumeCandidate.editorScene);
    setAnchorSceneId(resumeCandidate.anchorSceneId);
    setSourceChoice(
      resumeCandidate.sourceChoice === undefined
        ? resumeCandidate.anchorSceneId ? "existing" : "fresh"
        : resumeCandidate.sourceChoice,
    );
    setSelectedIds(resumeCandidate.selectedIds ?? []);
    setConstructionStartedAt(resumeCandidate.constructionStartedAt);
    setActionEvents(resumeCandidate.actionEvents);
    setHypothesis(resumeCandidate.hypothesis ?? "");
    setFinalGuessDraft(resumeCandidate.finalGuessDraft ?? "");
    setFinalQuestionnaireDraft(resumeCandidate.finalQuestionnaireDraft ?? { engagement: 4, difficulty: 4, feedback: "" });
    const savedInstructionPage = resumeCandidate.instructionPage ?? 0;
    const layoutVersion = resumeCandidate.instructionLayoutVersion ?? 1;
    const pageWithIntroduction = layoutVersion < 2 && savedInstructionPage >= 4 ? savedInstructionPage + 1 : savedInstructionPage;
    // Old scope/check pages resume at the introduction; later pages keep their content.
    setInstructionPage(layoutVersion < 3 && pageWithIntroduction >= 2 ? Math.max(2, pageWithIntroduction - 2) : pageWithIntroduction);
    setViewedAdditionalExamples((resumeCandidate.viewedAdditionalExamples ?? []).filter((index) => Number.isInteger(index) && index >= 0 && index < OPERATION_THOUGHTS.length));
    setComprehensionAnswers(resumeCandidate.comprehensionAnswers ?? {});
    setQuizReviewed(resumeCandidate.quizReviewed ?? false);
    setOperations(resumeCandidate.operations ?? []);
    setPrimaryOperation(resumeCandidate.primaryOperation ?? "");
    setOtherOperation(resumeCandidate.otherOperation ?? "");
    setAdditionalOperations(resumeCandidate.additionalOperations ?? "");
    setLastFeedback(resumeCandidate.lastFeedback ?? null);
    setPhase(resumeCandidate.phase);
    setResumeCandidate(null);
    void checkpoint(restored, "session_resumed", resumeCandidate.trialPosition);
  }

  function goToComprehension() {
    setNotice("");
    setPhase("comprehension");
    if (session) void checkpoint(session, "instructions_completed");
  }

  function startPracticeDemo() {
    if (!session) return;
    const next = structuredClone(session);
    next.practice_demo.started_at = nowIso();
    setSession(next);
    beginPracticeEditor();
    void checkpoint(next, "practice_demo_started");
  }

  function testPracticeScene() {
    if (!reportReady || !session || (operationPrompted && !primaryOperation)) return;
    const testedAt = nowIso();
    const record: ActiveTestRecord = {
      scene_id: crypto.randomUUID(),
      scene_index: session.practice_demo.active_tests.length + 1,
      practice_stage: practiceStages(session.practice_demo.practice_order)[session.practice_demo.active_tests.length],
      transition_index: session.practice_demo.active_tests.length,
      anchor_scene_id: anchorSceneId,
      construction_mode: anchorSceneId ? "edit" : "fresh",
      scene: cloneScene(editorScene),
      label: PRACTICE_RULE.evaluate(editorScene),
      hypothesis_text: hypothesis.trim(),
      hypothesis_required: true,
      operation_prompted: operationPrompted,
      operations_selected: operationPrompted ? [...operations] : [],
      primary_operation: operationPrompted ? operations[0] ?? null : null,
      other_operation_text: operationPrompted && operations.includes("other") ? otherOperation.trim() : "",
      additional_operations_ranked_text: operationPrompted ? additionalOperations : "",
      action_events: [...actionEvents],
      construction_started_at: constructionStartedAt,
      report_completed_at: testedAt,
      tested_at: testedAt,
      feedback_shown_at: nowIso(),
      construction_duration_ms: elapsedSince(constructionStartedAt),
    };
    const next = structuredClone(session);
    next.practice_demo.active_tests.push(record);
    setLastFeedback(record);
    setSession(next);
    setPhase("practiceFeedback");
    void checkpoint(next, "practice_active_test", null, record.scene_index);
  }

  function continueAfterPracticeFeedback() {
    if (!session || !lastFeedback) return;
    if (session.practice_demo.active_tests.length < PRACTICE_STAGES.length) {
      beginPracticeEditor();
      setLastFeedback(null);
      return;
    }
    const next = structuredClone(session);
    const probes = shuffle(PRACTICE_GENERALISATION_PROBES);
    next.practice_demo.generalisation_started_at = nowIso();
    next.practice_demo.generalisation_probes = probes.map((probe, index) => ({
      probe_id: probe.id,
      scene: cloneScene(probe.scene),
      true_label: PRACTICE_RULE.evaluate(probe.scene),
      selected: false,
      display_position: index,
    }));
    setSession(next);
    setLastFeedback(null);
    setPhase("generalisationTutorial");
    void checkpoint(next, "practice_generalisation_started");
  }

  function togglePracticeProbe(probeId: string) {
    if (!session || session.practice_demo.generalisation_completed_at) return;
    const next = structuredClone(session);
    const probe = next.practice_demo.generalisation_probes.find((item) => item.probe_id === probeId);
    if (!probe) return;
    probe.selected = !probe.selected;
    next.practice_demo.generalisation_selection_events.push({
      probe_id: probeId,
      selected: probe.selected,
      timestamp: nowIso(),
      elapsed_ms: next.practice_demo.generalisation_started_at
        ? elapsedSince(next.practice_demo.generalisation_started_at)
        : 0,
    });
    setSession(next);
    void checkpoint(next, "practice_generalisation_selection");
  }

  function finishPracticeGeneralisation() {
    if (!session || !session.practice_demo.generalisation_probes.some((probe) => probe.selected)) return;
    const next = structuredClone(session);
    next.practice_demo.generalisation_completed_at = nowIso();
    next.practice_demo.completed_at = nowIso();
    setSession(next);
    void checkpoint(next, "practice_demo_completed");
  }

  function submitComprehension() {
    if (!session) return;
    if (Object.keys(comprehensionAnswers).length !== Object.keys(COMPREHENSION_KEY).length) {
      setNotice(participantText("Odgovorite na vseh pet vprašanj.", "Odgovori na vseh pet vprašanj.", "Answer all five questions."));
      return;
    }
    const correctCount = Object.entries(COMPREHENSION_KEY).filter(
      ([question, answer]) => comprehensionAnswers[question] === answer,
    ).length;
    const passed = correctCount === Object.keys(COMPREHENSION_KEY).length;
    const next = structuredClone(session);
    next.comprehension_attempts.push({
      attempt: next.comprehension_attempts.length + 1,
      answers: { ...comprehensionAnswers },
      correct_count: correctCount,
      passed,
      timestamp: nowIso(),
    });
    if (!passed) {
      setNotice(participantText(
        "Nekateri odgovori niso bili pravilni. Pod vsakim napačnim odgovorom je podan pravilen odgovor.",
        "Nekateri odgovori niso bili pravilni. Pod vsakim napačnim odgovorom je podan pravilen odgovor.",
        "Some answers were not correct. The correct answers and brief explanations are shown below.",
      ));
      setQuizReviewed(true);
      setSession(next);
      void checkpoint(next, "comprehension_reviewed");
      return;
    }
    beginMainTrials(next, "comprehension_passed");
  }

  function beginMainTrials(baseSession: StudySession, checkpointType: string) {
    const next = structuredClone(baseSession);
    next.status = "active";
    if (next.trials.length === 0) next.trials.push(makeTrial(next.rule_order[0], 0, next.ruleset_version));
    setNotice("");
    setSession(next);
    setTrialPosition(0);
    setPhase("ruleIntro");
    void checkpoint(next, checkpointType, 0);
  }

  function showInitialDemonstration() {
    if (!session || !currentTrial) return;
    setPhase("initial");
    void checkpoint(session, "initial_positive_shown", trialPosition, 1);
  }

  function continueFromInitial() {
    if (!session || !currentTrial) return;
    void checkpoint(session, "initial_positive_viewed", trialPosition, 1);
    beginEditor(currentTrial);
  }

  const history = useMemo(() => {
    if (!currentTrial) return [];
    return [
      {
        id: currentTrial.initial_scene_id,
        label: true,
        scene: currentTrial.initial_scene,
        title: isEnglish ? "Initial positive example" : "Začetni pozitivni primer",
      },
      ...currentTrial.active_tests.filter((test) => !inlineFeedback || test.scene_id !== lastFeedback?.scene_id).map((test) => ({
        id: test.scene_id,
        label: test.label,
        scene: test.scene,
        title: `${isEnglish ? "Scene" : "Prizor"} ${test.scene_index}`,
      })),
    ];
  }, [currentTrial, isEnglish, inlineFeedback, lastFeedback?.scene_id]);

  function renderFreshSceneCard() {
    return <button type="button" className={`history-card history-card--fresh ${sourceChoice === "fresh" ? "is-active" : ""}`} onClick={startFresh}>
      <span>{isEnglish ? "New empty scene" : "Nov prazen prizor"}</span>
      <div className="empty-source-card"><strong aria-hidden="true">＋</strong><span>{participantText("Začnite tukaj", "Začni tukaj", "Start here")}</span></div>
    </button>;
  }

  function renderEvidenceStrip(interactive = false) {
    return (
      <section className="evidence-strip" aria-label={isEnglish ? "Initial example and previous scenes" : "Začetni primer in prejšnji prizori"}>
        <div className="evidence-heading">
          <div><strong>{participantText("Začetni primer in vsi vaši prejšnji prizori", "Začetni primer in vsi tvoji prejšnji prizori", "Initial example and all your previous scenes")}</strong>{isEnglish ? <span>They always remain visible.</span> : null}</div>
          {interactive ? <small>{participantText("Kliknite katerikoli prizor, da ga kopirate in spremenite.", "Klikni katerikoli prizor, da ga kopiraš in spremeniš.", "Click a previous scene or a new empty scene.")}</small> : null}
        </div>
        <div className="history-list">
          {history.map((item, index) => {
            const contents = (
              <>
                <span>{item.title}</span>
                <div className="history-scene-wrap">
                  <SceneView scene={item.scene} compact language={language} />
                  <span className={item.label ? "history-result-star history-result-star--positive" : "history-result-star history-result-star--negative"} aria-label={item.label ? (isEnglish ? "Yellow stars appeared" : "Rumene zvezdice so se usule") : (isEnglish ? "No stars appeared" : "Zvezdice se niso usule")}>{item.label ? "★" : "☆"}</span>
                </div>
              </>
            );
            return interactive ? (
              <button type="button" key={item.id} onClick={() => chooseAnchor(item.id, item.scene)} className={`history-card ${index === 0 ? "history-card--initial" : ""} ${anchorSceneId === item.id ? "is-active" : ""}`}>{contents}</button>
            ) : (
              <article key={item.id} className={`history-card history-card--display ${index === 0 ? "history-card--initial" : ""}`}>{contents}</article>
            );
          })}
          {interactive ? renderFreshSceneCard() : null}
        </div>
      </section>
    );
  }

  function renderPracticeEvidenceStrip(interactive = true) {
    const tests = (session?.practice_demo.active_tests ?? []).filter((test) => !inlineFeedback || test.scene_id !== lastFeedback?.scene_id);
    const initialContents = <>
      <span>{isEnglish ? "Initial positive example" : "Začetni pozitivni primer"}</span>
      <div className="history-scene-wrap">
        <SceneView scene={PRACTICE_INITIAL_SCENE} compact language={language} />
        <span className="history-result-star history-result-star--positive" aria-label={isEnglish ? "Yellow stars appeared" : "Rumene zvezdice so se usule"}>★</span>
      </div>
    </>;
    return (
      <section className="evidence-strip" aria-label={isEnglish ? "Initial positive example and previous demonstration scenes" : "Začetni pozitivni primer in prejšnji prikazni prizori"}>
        <div className="evidence-heading"><div><strong>{participantText("Začetni primer in vsi vaši prejšnji prizori", "Začetni primer in vsi tvoji prejšnji prizori", "Initial example and all your previous scenes")}</strong>{interactive ? <span>{participantText("Kliknite prejšnji prizor ali nov prazen prizor.", "Klikni prejšnji prizor ali nov prazen prizor.", "Click a previous scene or a new empty scene.")}</span> : null}</div></div>
        <div className="history-list">
          {interactive ? (
            <button type="button" onClick={() => chooseAnchor("practice-initial", PRACTICE_INITIAL_SCENE)} className={`history-card history-card--initial ${anchorSceneId === "practice-initial" ? "is-active" : ""}`}>{initialContents}</button>
          ) : (
            <article className="history-card history-card--display history-card--initial">{initialContents}</article>
          )}
          {tests.map((test) => {
            const contents = <>
              <span>{isEnglish ? "Demonstration scene" : "Prikazni prizor"} {test.scene_index}</span>
              <div className="history-scene-wrap">
                <SceneView scene={test.scene} compact language={language} />
                <span className={test.label ? "history-result-star history-result-star--positive" : "history-result-star history-result-star--negative"} aria-label={test.label ? (isEnglish ? "Yellow stars appeared" : "Rumene zvezdice so se usule") : (isEnglish ? "No stars appeared" : "Zvezdice se niso usule")}>{test.label ? "★" : "☆"}</span>
              </div>
            </>;
            return interactive ? (
              <button type="button" key={test.scene_id} onClick={() => chooseAnchor(test.scene_id, test.scene)} className={`history-card ${anchorSceneId === test.scene_id ? "is-active" : ""}`}>{contents}</button>
            ) : (
              <article key={test.scene_id} className="history-card history-card--display">{contents}</article>
            );
          })}
          {interactive ? renderFreshSceneCard() : null}
        </div>
      </section>
    );
  }

  function chooseAnchor(id: string, source: Scene) {
    setEditorScene(cloneScene(source));
    setAnchorSceneId(id);
    setSourceChoice("existing");
    setSelectedIds([]);
    setActionEvents((events) => [
      ...events,
      newAction({ event_type: "anchor_selected", anchor_scene_id: id }),
    ]);
  }

  function startFresh() {
    setEditorScene({ objects: [] });
    setAnchorSceneId(null);
    setSourceChoice("fresh");
    setSelectedIds([]);
    setActionEvents((events) => [
      ...events,
      newAction({ event_type: "fresh_started", anchor_scene_id: null }),
    ]);
    setShowAdd(false);
  }

  function toggleAddPanel() {
    if (showAdd) {
      setShowAdd(false);
      return;
    }
    const nextSequence = (addMenuSequence + 1) % 3;
    const colours = rotate(COLOUR_VALUES, nextSequence);
    const sizes = rotate(SIZE_VALUES, (nextSequence + 1) % 3);
    const shapes = rotate(SHAPE_VALUES, (nextSequence + 2) % 3);
    setAddMenuSequence(nextSequence);
    setAddColourOptions(colours);
    setAddSizeOptions(sizes);
    setAddShapeOptions(shapes);
    setAddColour(colours[0]);
    setAddSize(sizes[0]);
    setAddShape(shapes[0]);
    setShowAdd(true);
  }

  function toggleObject(objectId: string) {
    setSelectedIds((selected) => {
      const next = selected.includes(objectId)
        ? selected.filter((id) => id !== objectId)
        : [...selected, objectId];
      setActionEvents((events) => [
        ...events,
        newAction({
          event_type: "selection_changed",
          object_ids: [objectId],
          before: selected,
          after: next,
        }),
      ]);
      return next;
    });
  }

  function addObject() {
    if (editorScene.objects.length >= MAX_OBJECTS) return;
    const item: SceneObject = {
      id: crypto.randomUUID(),
      colour: addColour,
      size: addSize,
      shape: addShape,
      slot: editorScene.objects.length,
    };
    setEditorScene((current) => ({ objects: [...current.objects, item] }));
    setSelectedIds([item.id]);
    setActionEvents((events) => [
      ...events,
      newAction({ event_type: "object_added", object_ids: [item.id], after: item }),
    ]);
    setShowAdd(false);
  }

  function removeSelected() {
    if (selectedIds.length === 0) return;
    const removed = editorScene.objects.filter((item) => selectedIds.includes(item.id));
    const remaining = editorScene.objects
      .filter((item) => !selectedIds.includes(item.id))
      .map((item, index) => ({ ...item, slot: index }));
    setEditorScene({ objects: remaining });
    setActionEvents((events) => [
      ...events,
      newAction({
        event_type: "objects_removed",
        object_ids: selectedIds,
        before: removed,
      }),
    ]);
    setSelectedIds([]);
  }

  function restorePracticeObjects() {
    const missing = practiceRemovalToRestore(editorScene, actionEvents);
    if (!missing.length || phase !== "practiceEditor") return;
    const restored = [...editorScene.objects, ...missing].sort((a,b) => a.slot - b.slot).map((item,slot) => ({...item,slot}));
    setEditorScene({objects: restored});
    setSelectedIds(missing.map(item => item.id));
    setActionEvents(events => [...events, newAction({event_type: "objects_restored", object_ids: missing.map(x=>x.id), before: cloneScene(editorScene), after: {objects: restored}})]);
  }

  function changeFeature(
    feature: "colour" | "size" | "shape",
    value: Colour | ObjectSize | Shape,
  ) {
    if (selectedIds.length === 0) return;
    const before = editorScene.objects
      .filter((item) => selectedIds.includes(item.id))
      .map((item) => ({ id: item.id, value: item[feature] }));
    const objects = editorScene.objects.map((item) =>
      selectedIds.includes(item.id) ? { ...item, [feature]: value } : item,
    );
    setEditorScene({ objects });
    setActionEvents((events) => [
      ...events,
      newAction({
        event_type: "feature_changed",
        object_ids: [...selectedIds],
        feature,
        before,
        after: selectedIds.map((id) => ({ id, value })),
      }),
    ]);
  }

  function toggleOperation(operation: OperationId) {
    setOperations([operation]);
    setPrimaryOperation(operation);
    if (operation !== "other") setOtherOperation("");
  }

  const practiceEditorMode = phase === "practiceEditor" || (inlineFeedback && phase === "practiceFeedback");
  const practiceIndex = (session?.practice_demo.active_tests.length ?? 0) - (inlineFeedback && phase === "practiceFeedback" ? 1 : 0);
  const practiceStage = practiceStages(session?.practice_demo.practice_order)[practiceIndex] ?? "open";
  const operationPrompted = phase === "editor" || (inlineFeedback && phase === "feedback") || (practiceEditorMode && practiceStage === "open");
  const practiceProgress = guidedPracticeProgress(practiceStage, editorScene, actionEvents, anchorSceneId, sourceChoice);
  const finalGuessRequired = (phase === "editor" && currentTrial?.active_tests.length === 6)
    || (inlineFeedback && phase === "feedback" && currentTrial?.active_tests.length === 7);
  const reportReady =
    (!practiceEditorMode || practiceProgress.ready) &&
    editorScene.objects.length > 0 &&
    (sourceChoice === "fresh" || anchorSceneId !== null) &&
    (hypothesis.trim().length >= (finalGuessRequired ? 3 : 1)) &&
    (!operationPrompted || (
      operations.length === 1 &&
      primaryOperation === operations[0] &&
      (!operations.includes("other") || otherOperation.trim().length >= 3)
    ));

  function testScene() {
    if (!reportReady || !session || !currentTrial || !currentRule || (operationPrompted && !primaryOperation)) return;
    const testedAt = nowIso();
    const record: ActiveTestRecord = {
      scene_id: crypto.randomUUID(),
      scene_index: currentTrial.active_tests.length + 2,
      transition_index: currentTrial.active_tests.length,
      anchor_scene_id: anchorSceneId,
      construction_mode: anchorSceneId ? "edit" : "fresh",
      scene: cloneScene(editorScene),
      label: currentRule.evaluate(editorScene),
      hypothesis_text: hypothesis.trim(),
      hypothesis_required: true,
      operation_prompted: operationPrompted,
      operations_selected: operationPrompted ? [...operations] : [],
      primary_operation: operationPrompted ? operations[0] ?? null : null,
      other_operation_text: operationPrompted && operations.includes("other") ? otherOperation.trim() : "",
      additional_operations_ranked_text: operationPrompted ? additionalOperations : "",
      action_events: [...actionEvents],
      construction_started_at: constructionStartedAt,
      report_completed_at: testedAt,
      tested_at: testedAt,
      feedback_shown_at: nowIso(),
      construction_duration_ms: elapsedSince(constructionStartedAt),
    };
    const next = structuredClone(session);
    next.trials[trialPosition].active_tests.push(record);
    setLastFeedback(record);
    setSession(next);
    setPhase("feedback");
    void checkpoint(next, "active_test", trialPosition, record.scene_index);
  }

  function continueAfterFeedback() {
    if (!session || !currentTrial || !lastFeedback) return;
    const latestTrial = session.trials[trialPosition];
    if (latestTrial.active_tests.length >= 7) {
      setLastFeedback(null);
      setPhase("generalisationIntro");
      return;
    }
    beginEditor(latestTrial);
    setLastFeedback(null);
  }

  function startGeneralisation() {
    if (!session || !currentTrial || phase !== "generalisationIntro" || currentTrial.active_tests.length !== 7) return;
    const next = structuredClone(session);
    const trial = next.trials[trialPosition];
    const probes = shuffle(getGeneralisationProbes(trial.rule_id, next.ruleset_version));
    // Start probe timing only when participants leave the untimed introduction.
    trial.generalisation_started_at = nowIso();
    trial.generalisation_probes = probes.map((probe, index) => ({
      probe_id: probe.id,
      scene: cloneScene(probe.scene),
      true_label: getRule(trial.rule_id, next.ruleset_version).evaluate(probe.scene),
      selected: false,
      display_position: index,
    }));
    setSession(next);
    setPhase("generalisation");
    void checkpoint(next, "generalisation_started", trialPosition);
  }

  const feedbackAdvanceRef = useRef<() => void>(() => {});
  feedbackAdvanceRef.current = () => phase === "practiceFeedback" ? continueAfterPracticeFeedback() : continueAfterFeedback();
  useEffect(() => {
    if ((phase !== "feedback" && phase !== "practiceFeedback") || !lastFeedback || saveState !== "saved") return;
    const duration = FEEDBACK_DURATION_MS;
    // eslint-disable-next-line react-hooks/purity -- Clock read occurs inside this effect, after the board has scrolled into view.
    const elapsed = performance.now() - feedbackVisibleAtRef.current;
    const remaining = Math.max(0, duration - elapsed);
    const timer = window.setTimeout(() => feedbackAdvanceRef.current(), remaining);
    return () => window.clearTimeout(timer);
  }, [phase, lastFeedback, saveState, isEnglish]);

  function toggleProbe(probeId: string) {
    if (!session) return;
    const next = structuredClone(session);
    const trial = next.trials[trialPosition];
    const probe = trial.generalisation_probes.find((item) => item.probe_id === probeId);
    if (!probe) return;
    probe.selected = !probe.selected;
    trial.generalisation_selection_events.push({
      probe_id: probeId,
      selected: probe.selected,
      timestamp: nowIso(),
      elapsed_ms: trial.generalisation_started_at
        ? elapsedSince(trial.generalisation_started_at)
        : 0,
    });
    setSession(next);
    void checkpoint(next, "generalisation_selection", trialPosition);
  }

  useEffect(() => {
    if (phase !== "generalisationSubmitted" || saveState !== "saved") return;
    const timer = window.setTimeout(() => {
      setPhase("finalRuleGuess");
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [phase, saveState]);

  useEffect(() => {
    if (phase !== "generalisationConfirmed" || saveState !== "saved") return;
    const timer = window.setTimeout(() => {
      setPhase(session?.status === "debrief" ? "results" : "ruleIntro");
    }, isEnglish ? 2000 : 3500);
    return () => window.clearTimeout(timer);
  }, [phase, saveState, session?.status, isEnglish]);

  function submitGeneralisation() {
    if (!session || !currentTrial || phase !== "generalisation") return;
    const next = structuredClone(session);
    next.trials[trialPosition].generalisation_completed_at = nowIso();
    setFinalGuessDraft("");
    setSession(next);
    setPhase("generalisationSubmitted");
    void checkpoint(next, "generalisation_completed", trialPosition);
  }

  function submitFinalRuleGuess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !currentTrial?.generalisation_completed_at || phase !== "finalRuleGuess" || finalGuessDraft.trim().length < 3) return;
    const next = structuredClone(session);
    const trial = next.trials[trialPosition];
    trial.final_rule_guess = finalGuessDraft.trim();
    trial.final_rule_guess_at = nowIso();
    trial.ended_at = trial.final_rule_guess_at;
    const isLast = trialPosition === next.rule_order.length - 1;
    if (isLast) {
      next.status = "debrief";
    } else {
      const nextPosition = trialPosition + 1;
      next.trials.push(makeTrial(next.rule_order[nextPosition], nextPosition, next.ruleset_version));
      setTrialPosition(nextPosition);
    }
    setSession(next);
    setPhase("generalisationConfirmed");
    void checkpoint(next, "trial_completed", trialPosition);
  }

  async function submitDemographics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const data = new FormData(event.currentTarget);

    const engagement = Number(data.get("engagement"));
    const difficulty = Number(data.get("difficulty"));
    if (!session.demographics || !engagement || !difficulty) {
      setNotice(participantText("Izpolnite vsa obvezna polja.", "Izpolni vsa obvezna polja.", "Complete all required fields."));
      return;
    }
    const next = structuredClone(session);
    next.demographics = session.status === "complete" ? session.demographics : {
      ...session.demographics,
      engagement,
      difficulty,
      feedback: String(data.get("feedback") ?? "").trim(),
      submitted_at: nowIso(),
    };
    const completed = structuredClone(next);
    completed.status = "complete";
    completed.completed_at = session.completed_at ?? nowIso();
    setNotice("");
    setSession(collection ? completed : next);
    const result = await checkpoint(completed, "session_completed", trialPosition);
    if (!result.ok) {
      setNotice(participantText(
        "Končno shranjevanje ni uspelo. Podatki ostajajo v tem brskalniku; preverite povezavo in poskusite znova.",
        "Končno shranjevanje ni uspelo. Podatki ostajajo v tem brskalniku; preveri povezavo in poskusi znova.",
        "The final save failed. The data remain in this browser; check the connection and try again.",
      ));
      return;
    }
    setSession(result.stamped);
    setPhase("complete");
  }

  function emphasiseInstruction(text: string) {
    return text.split(/(svoje ugibanje o skritem pravilu|kaj bi po tvojem lahko bilo skrito pravilo|kaj bi po vašem lahko bilo skrito pravilo|your guess about the hidden rule|Začetni pozitivni primer|»Odstrani«|Initial positive example|Remove)/g)
      .map((part, index) => index % 2 ? <strong key={index}>{part}</strong> : part);
  }

  function emphasiseDemoQuotes(text: string) {
    return text.split(/(»[^«]+«|“[^”]+”|"[^"\n]+")/g).map((part, index) => {
      if (index % 2 === 0) return <span key={index}>{part.split(/(majhen rdeč krog|velik moder kvadrat|pred dodajanjem|po dodajanju lika|že dodanega lika|modre obrobe|modro obrobo|modra obroba)/g).map((fragment, fragmentIndex) => fragmentIndex % 2 ? <strong key={fragmentIndex}>{fragment}</strong> : <span key={fragmentIndex}>{emphasiseInstruction(fragment)}</span>)}</span>;
      return <strong className="demo-quoted-label" key={index}>{part[0] + part[1].toLocaleUpperCase() + part.slice(2)}</strong>;
    });
  }

  function renderWelcome() {
    return (
      <main lang={language} className="welcome-shell">
        <section className="welcome-card">
          <img className="university-logo" src={assetUrl("/university-of-primorska-logo.png")} alt={isEnglish ? "University of Primorska" : "Univerza na Primorskem"} />
          {reviewOnly ? <p className="review-copy-notice">{isEnglish ? "Review copy · responses remain in this browser and are not submitted." : "Predogled · odgovori ostanejo v tem brskalniku in se ne pošiljajo."}</p> : null}
          <h1>{participantText("Ali ste pripravljeni, da začnete nalogo?", "Ali si pripravljen(a), da začneš nalogo?", "Are you ready to begin the task?")}</h1>
          {resumeCandidate && (canResumeInCurrentExperiment(resumeCandidate.session) || collection) ? (
            <div className="resume-card">
              <strong>{isEnglish ? "An unfinished session is safely stored in this browser." : "Nedokončana seja je varno shranjena v tem brskalniku."}</strong>
              <button className="button button--secondary" type="button" onClick={resumeStudy}>
                {participantText("Nadaljujte shranjeno sejo", "Nadaljuj shranjeno sejo", "Continue saved session")}
              </button>
            </div>
          ) : null}
          {resumeCandidate && !canResumeInCurrentExperiment(resumeCandidate.session) ? (
            <div className="resume-card" role="status">
              <strong>{isEnglish ? "The previous unfinished session cannot be continued because the response options have changed." : "Prejšnje nedokončane seje ni mogoče nadaljevati, ker so se možnosti odgovorov spremenile."}</strong>
              <p>{participantText("Začnite novo sejo z novo šifro udeleženca; že shranjeni podatki bodo ostali pri raziskovalcu(ki).", "Začni novo sejo z novo šifro udeleženca; že shranjeni podatki bodo ostali pri raziskovalcu(ki).", "Start a new session with a new participant code; the data already saved will remain with the researcher.")}</p>
            </div>
          ) : null}
          <form onSubmit={startStudy} className="stack-form" hidden={Boolean(collection && resumeCandidate)}>
            <label>
              {isEnglish ? "Participant code" : "Šifra udeleženca"}
              <input
                value={participantCode}
                readOnly={Boolean(collection)}
                onChange={(event) => setParticipantCode(event.target.value)}
                autoComplete="off"
                maxLength={60}
                required
              />
            </label>
            <div className="form-row"><label>{isEnglish ? "Age in years" : "Starost v letih"}<input name="age_years" type="number" min="5" max="100"  required /></label><label>{isEnglish ? "Additional months" : "Dodatni meseci"}<input name="age_months" type="number" min="0" max="11" defaultValue={0} required /></label></div>
            <label>{isEnglish ? "Gender" : "Spol"}<select name="gender" required defaultValue=""><option value="" disabled>{isEnglish ? "Select" : "Izberite"}</option><option value="female">{isEnglish ? "female" : "ženski"}</option><option value="male">{isEnglish ? "male" : "moški"}</option><option value="nonbinary">{isEnglish ? "non-binary" : "nebinaren"}</option><option value="self_describe">{isEnglish ? "other" : "drugo"}</option><option value="prefer_not">{isEnglish ? "prefer not to answer" : "ne želim odgovoriti"}</option></select></label>
            {collection ? (isAdult ? [["study_year", "Letnik študija"], ["study_level", "Stopnja študija"]] : [["school", "Šola"], ["class_number", "Razred"], ["class_letter", "Oddelek"]]).map(([name, label]) => <label key={name}>{label}<input name={name} type="text" maxLength={200} required autoComplete="off" onChange={event => event.currentTarget.setCustomValidity(event.currentTarget.value.trim() ? "" : "Izpolnite to polje.")} /></label>) : null}
            <label className="check-row">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span>
                {isEnglish ? "I want to start the game and understand that I can stop playing at any time if I do not feel comfortable." : "Želim začeti igro in razumem, da jo lahko kadarkoli preneham igrati, če se ne počutim dobro."}
              </span>
            </label>
            <button className="button button--primary" disabled={!consent || participantCode.trim().length < 2 || Boolean(collection && !draftLoaded)}>
              {participantText("Poglejte navodila", "Poglej navodila", "View the instructions")}
            </button>
          </form>
        </section>
      </main>
    );
  }

  function renderOperationThought(index: number) {
    const thought = OPERATION_THOUGHTS[index];
    const showAdditional = extraExampleIndex === index;
    const showExplanation = explanationIndex === index;
    const operation = OPERATION_IDS[index];
    const example = showAdditional ? ADDITIONAL_OPERATION_EXAMPLES[index] : { ...thought, scene: THOUGHT_SCENE };
    // Necessity and sufficiency refer to one particular object as "this".
    const referencedIds = index <= 1 ? [example.scene.objects[0].id] : [];
    return <>
      <header className="operation-teaching-header">
        <h1><OperationIcon operation={operation} />{OPERATION_NAMES[operation][isEnglish ? "en" : "sl"]}</h1>
        <span aria-label={isEnglish ? `Operation ${index + 1} of 5` : `Operacija ${index + 1} od 5`}>{index + 1} / 5</span>
      </header>
      <div className="thought-example"><SceneView scene={example.scene} language={language} referencedIds={referencedIds} />{isEnglish ? <span className="star-key star-key--positive" aria-label="Stars appear">★</span> : null}</div>
      <div className="thought-layout">
        <img src={assetUrl("/thoughtful-astronaut.png")} alt="" width="1237" height="1272" />
        <blockquote className="thought-bubble" aria-live="polite"><span className="thought-caption">{isEnglish ? "The researcher wonders:" : "Raziskovalec se sprašuje:"}</span>{isEnglish ? example.en : example.sl}</blockquote>
      </div>
      <div className="operation-teaching-actions">
        <button className="button button--secondary" type="button" aria-expanded={showExplanation} aria-controls={`operation-explanation-${index}`} onClick={() => setExplanationIndex(showExplanation ? null : index)}><span className="thought-help-icon" aria-hidden="true">?</span>{isEnglish ? "What does this mean?" : "Kaj to pomeni?"}</button>
        <button className="button button--secondary" type="button" onClick={() => { setExtraExampleIndex(showAdditional ? null : index); if (!showAdditional) setViewedAdditionalExamples((seen) => seen.includes(index) ? seen : [...seen, index]); }}><span aria-hidden="true">↻</span>{showAdditional ? (isEnglish ? "First example" : "Prvi primer") : (isEnglish ? "Additional example" : "Dodaten primer")}</button>
      </div>
      <div className="operation-teaching-description" id={`operation-explanation-${index}`} hidden={!showExplanation}><p>{operationLabel(operation)}</p></div>
    </>;
  }

  function renderInstructions() {
    const isOperationPage = instructionPage >= 3 && instructionPage <= 7;
    const additionalExampleRequired = isOperationPage && !viewedAdditionalExamples.includes(instructionPage - 3);
    return (
      <main lang={language} className="content-shell">
        <section className={`paper-card instructions-card${isOperationPage ? " instructions-card--operation" : instructionPage === 2 ? " instructions-card--operation-intro" : ""}`}>
          <div className="instruction-progress" hidden={isOperationPage} aria-label={isEnglish ? "Instruction progress" : "Napredek skozi navodila"}>
            {Array.from({length: 9}, (_, index) => <span className={index === instructionPage ? "is-active" : index < instructionPage ? "is-done" : ""} key={index}>{index + 1}</span>)}
          </div>
          {notice ? <p className="form-notice">{notice}</p> : null}
          {instructionPage === 0 ? (
            <>
              <p className="eyebrow">{isEnglish ? "Instructions" : "Navodila"}</p>
              <h1>{participantText("Dobrodošli v moji igri!", "Dobrodošel/dobrodošla v moji igri!", "Welcome to the game from planet Zendo")}</h1>
              <p className={isEnglish ? "lead" : "instruction-copy"}>{participantText("Hvala, da ste se odločili igrati mojo igro!", "Hvala, da si se odločil(a) igrati mojo igro!", "Thank you for choosing to play my game! In this game, you will learn about an alien planet called Zendo. Special shapes live on planet Zendo, as shown below.")}</p>
              {isAdult && !isEnglish ? <p className="instruction-copy">Igro bodo igrali tudi otroci, zato so navodila napisana na otrokom prijazen način. Prosimo, da kljub temu igro igrate kot običajno.</p> : null}
              <img className="zendo-intro-image" src={assetUrl("/zendo-shapes-intro.png")} alt={isEnglish ? "A red triangle, blue square and green circle among astronauts on planet Zendo" : "Rdeč trikotnik, moder kvadrat in zelen krog med astronavti na planetu Zendo"} width="1536" height="1024" />
              <p className="instruction-copy">{isEnglish ? <>The shapes differ in colour, size and form, and they appear together in scenes. But look! Some scenes cause yellow stars to appear. Scenes that cause stars to appear follow a hidden rule. If a scene does not follow the rule, the stars do not appear. The stars therefore provide feedback about the whole scene; they are not a property of an individual shape.</> : <>{participantText("V tej igri se boste učili o tujem planetu, ki se imenuje Zendo.", "V tej igri se boš učil(a) o tujem planetu, ki se imenuje Zendo.", "")} Na planetu Zendo živijo posebni liki. Liki se razlikujejo po barvi, velikosti in obliki ter se pojavljajo skupaj v prizorih. {isAdult ? "Ampak poglejte!" : "Ampak poglej!"} Pri nekaterih prizorih se pokažejo rumene zvezdice. Prizori, ki povzročijo prikaz zvezdic, sledijo skritemu pravilu. Če prizor pravilu ne ustreza, se zvezdice ne pokažejo. Zvezdice so torej povratna informacija o celotnem prizoru, ne lastnost posameznega lika. Skrito pravilo je lahko povezano z barvo, velikostjo, obliko, številom likov ali kombinacijo teh lastnosti.</>}</p>
              {isEnglish ? <p className="instruction-copy">{`The hidden rule may concern colour, size, shape, number of shapes, or a combination of these features. The instructions for these scenes have been lost in the star laboratory. You will be a ${isAdult ? "researcher" : "young researcher"} and use tests to help rediscover how they work.`}</p> : null}
              {!isEnglish ? <p className="instruction-copy laboratory-paragraph">V zvezdnem laboratoriju so izgubili navodila za sestavljanje prizorov. {isAdult ? "V moji igri boste igrali vlogo raziskovalca oziroma raziskovalke: sestavljali boste prizore likov in tako pomagali ponovno odkriti pet skritih pravil!" : "V moji igri boš igral(a) vlogo mladega raziskovalca oziroma mlade raziskovalke: sestavljal(a) boš prizore likov in tako pomagal(a) ponovno odkriti pet skritih pravil!"}</p> : null}
              <img className="zendo-intro-image zendo-lab-image" src={assetUrl("/zendo-lab-two-platforms.png")} alt={isEnglish ? "Two young astronauts test scenes: yellow stars appear over the scene on the left, while no stars appear over the scene on the right" : "Dva mlada astronavta preizkušata prizora: pri levem se usujejo rumene zvezdice, pri desnem se zvezdice ne usujejo"} width="1536" height="1024" />
            </>
          ) : null}

          {instructionPage === 1 ? (
            <>
              <p className="eyebrow">{isEnglish ? "Instructions" : "Navodila"}</p>
              <p className="lead-small">{participantText("Pravila za delovanje nekaterih skupin likov smo že odkrili. Poglejmo, kako delujejo tri skupine. Zapomnite si: vsaka skupina deluje po svojem pravilu.", "Pravila za delovanje nekaterih skupin likov smo že odkrili. Poglejmo, kako delujejo tri skupine. Zapomni si: vsaka skupina deluje po svojem pravilu.", "We have already discovered the rules followed by some groups of shapes. Let us look at how three groups work. Remember: each group follows its own rule.")}</p>
              <div className="worked-rules">
                {INSTRUCTION_EXAMPLES.map((example) => (
                  <article key={example.id}>
                    <h2><strong>{isEnglish ? "Rule:" : "Pravilo:"}</strong> {isEnglish ? ENGLISH_INSTRUCTION_RULE_LABELS[example.id] : example.slovene}</h2>
                    <p>{isEnglish ? "Stars shower down when the scene follows this rule." : "Zvezdice se usujejo, če je prizor v skladu s tem pravilom."}</p>
                    <div className="worked-scenes">
                      {example.positiveScenes.map((exampleScene, index) => <div key={`${example.id}-positive-${index}`}><span className="star-key star-key--positive">★</span><SceneView scene={exampleScene} compact language={language} /></div>)}
                      {example.negativeScenes.map((exampleScene, index) => <div key={`${example.id}-negative-${index}`}><span className="star-key star-key--negative">☆</span><SceneView scene={exampleScene} compact language={language} /></div>)}
                    </div>
                  </article>
                ))}
              </div>
              <p className="instruction-copy instruction-summary">{participantText("Torej obstaja veliko načinov, kako lahko iz prizorov prikličete zvezdice! Zvezdice lahko prikličejo prizori z različnim številom likov, različnimi barvami, različnimi velikostmi, različnimi oblikami in kombinacijami teh lastnosti.", "Torej obstaja veliko načinov, kako lahko iz prizorov prikličeš zvezdice! Zvezdice lahko prikličejo prizori z različnim številom likov, različnimi barvami, različnimi velikostmi, različnimi oblikami in kombinacijami teh lastnosti.", "So there are many ways for scenes made from the special shapes to summon stars! Scenes with different numbers of shapes, colours, sizes, forms and combinations of these features can summon stars.")}</p>
            </>
          ) : null}

          {instructionPage === 2 ? (
            <>
              <p className="eyebrow">{isEnglish ? "Instructions" : "Navodila"}</p>
              <h1>{participantText("Kaj se sprašujete, ko sestavljate prizor?", "Kaj se sprašuješ, ko sestavljaš prizor?", "What do you ask yourself when you build a scene?")}</h1>
              <div className="operation-intro-copy">
                <img src={assetUrl("/thoughtful-astronaut.png")} alt="" width="1237" height="1272" />
                <div>
                  <p>{isEnglish ? "When we build a scene, we can ask ourselves what we want to find out with it." : "Ko sestavljamo prizor, se lahko vprašamo, kaj želimo z njim ugotoviti."}</p>
                  <p>{participantText("Na naslednjih straneh boste videli raziskovalca, ki sestavlja prizor in razmišlja o skritem pravilu. Ob tem se sprašuje, kaj želi s prizorom ugotoviti.", "Na naslednjih straneh boš videl(a) raziskovalca, ki sestavlja prizor in razmišlja o skritem pravilu. Ob tem se sprašuje, kaj želi s prizorom ugotoviti.", "On the next pages, you will see what a researcher wonders about when looking at a scene. The researcher does not know the answer yet. They can build a new scene and check whether stars appear.")}</p>
                  <p>{participantText("Tudi vi boste med igro izbrali opis, ki najbolje pove, kaj ste želeli ugotoviti s svojim prizorom.", "Tudi ti boš med igro izbral(a) opis, ki najbolje pove, kaj si želel(a) ugotoviti s svojim prizorom.", "During the game, you too will choose the description that best explains what you wanted to find out with your scene.")}</p>
                </div>
              </div>
            </>
          ) : null}
          {instructionPage >= 3 && instructionPage <= 7 ? renderOperationThought(instructionPage - 3) : null}
          {instructionPage === 8 ? (
            <>
              <p className="eyebrow">{isEnglish ? "Instructions" : "Navodila"}</p>
              <h1>{participantText("Vaša raziskovalna naloga", "Tvoja raziskovalna naloga", "Your research task")}</h1>
              <div className="research-task-copy">
                <p>{participantText("Na planetu Zorb so odkrili, da obstaja še pet skritih pravil! Vi boste raziskovalec oziroma raziskovalka in boste s preizkusi pomagali ponovno odkriti pet različnih pravil, zaradi katerih prizori prikličejo zvezdice. Vaša naloga bo:", "Na planetu Zorb so odkrili, da obstaja še pet skritih pravil! V vlogi mladega raziskovalca oziroma mlade raziskovalke boš s preizkusi pomagal(a) ponovno odkriti pet različnih pravil, zaradi katerih prizori prikličejo zvezdice. Tvoja naloga bo:", `On planet Zorb, five more hidden rules have been discovered! You will be a ${isAdult ? "researcher" : "young researcher"} and use tests to help rediscover the five different rules that make scenes summon stars.`)}</p>
                {isEnglish ? (
                  <ol>
                    <li><strong>construct scenes</strong>: you will add and remove shapes and change their colour, size and form;</li>
                    <li>{emphasiseInstruction("before every test, you will write your guess about the hidden rule if you have one; if you do not have a current best guess yet, that is fine, we want you to be honest. Then just write “I don’t know”;" )}</li>
                    <li><strong>choose an operation description</strong> that best describes why you chose the scene; choose one description. You will then test the scene and find out whether it follows the rule.</li>
                  </ol>
                ) : (
                  <ul>
                    <li><strong>Sestavljati prizore:</strong> {isAdult ? "dodajali in odstranjevali boste like ter jim spreminjali barvo, velikost in obliko." : "dodajal(a) in odstranjeval(a) boš like ter jim spreminjal(a) barvo, velikost in obliko."}</li>
                    <li><strong>{isAdult ? "Pred vsakim preizkusom napisati, kaj bi po vašem lahko bilo skrito pravilo." : "Pred vsakim preizkusom napisati, kaj bi po tvojem lahko bilo skrito pravilo."}</strong> {isAdult ? "Če še nimate ideje, ni nič narobe; pomembno je samo, da ste iskreni. V tem primeru preprosto napišite »Ne vem«." : "Če še nimaš ideje, ni nič narobe; pomembno je samo, da si iskren(a). V tem primeru preprosto napiši »Ne vem«."}</li>
                    <li><strong>Izbrati opis ene operacije,</strong> {isAdult ? "ki najbolje pove, zakaj ste izbrali prizor." : "ki najbolje pove, zakaj si izbral(a) prizor."}</li>
                    <li>{isAdult ? <>Nato boste <strong>prizor preizkusili</strong> in izvedeli, ali sledi pravilu.</> : <>Nato boš <strong>prizor preizkusil(a)</strong> in izvedel(a), ali sledi pravilu.</>}</li>
                  </ul>
                )}
                <section className="building-rules"><h2>{isEnglish ? "Building a scene" : "Sestavljanje prizora"}</h2>
                  <p>{participantText(`V enem prizoru lahko uporabite največ ${MAX_OBJECTS} like.`, `V enem prizoru lahko uporabiš največ ${MAX_OBJECTS} like.`, `You can use at most ${MAX_OBJECTS} shapes in one scene.`)}</p>
                  <p>{participantText("Vrstni red, v katerem dodate like, ni pomemben. Zvezdice so odvisne od likov v prizoru, ne od tega, katerega dodate najprej.", "Vrstni red, v katerem dodaš like, ni pomemben. Zvezdice so odvisne od likov v prizoru, ne od tega, katerega dodaš najprej.", "The order in which you add shapes does not matter. Stars depend on the shapes in the scene, regardless of which one you add first.")}</p>
                </section>
                <p>{participantText("Najprej boste sestavili dva prizora z navodili po korakih. Nato boste sestavili še en prizor po svoji izbiri. To je vaja pred glavno igro.", "Najprej boš sestavil(a) dva prizora z navodili po korakih. Nato boš sestavil(a) še en prizor po svoji izbiri. To je vaja pred glavno igro.", "First you will build two scenes with step-by-step guidance, then one scene of your own choice. This is practice before the main game.")}</p>
              </div>
            </>
          ) : null}

          <div className="instruction-actions">
            {instructionPage > 0 ? <button className="button button--secondary" type="button" onClick={() => { setExtraExampleIndex(null); setExplanationIndex(null); setInstructionPage((value) => value - 1); }}>{isEnglish ? "Back" : "Nazaj"}</button> : <span />}
            {instructionPage < 8 ? (
              <button className="button button--primary" type="button" disabled={additionalExampleRequired} onClick={() => { if (additionalExampleRequired) return; setNotice(""); setExtraExampleIndex(null); setExplanationIndex(null); setInstructionPage((value) => value + 1); }}>{instructionPage === 2 ? (isEnglish ? "Let’s look at the first example" : "Poglejmo prvi primer") : participantText("Nadaljujte", "Nadaljuj", "Continue")}</button>
            ) : (
              <button className="button button--primary" type="button" onClick={startPracticeDemo}>{participantText("Začnite prikaz", "Začni prikaz", "Start the demonstration")}</button>
            )}
          </div>
        </section>
      </main>
    );
  }


  function renderGeneralisationTutorial() {
    if (!session) return null;
    const demo = session.practice_demo;
    const revealed = Boolean(demo.generalisation_completed_at);
    const anySelected = demo.generalisation_probes.some(probe => probe.selected);
    const score = demo.generalisation_probes.filter(probe => probe.selected === probe.true_label).length;
    return <main lang={language} className="study-shell">
      {renderPracticeEvidenceStrip(false)}
      <section className="paper-card generalisation-card">
        <p className="eyebrow">{isEnglish ? "Instructions · practice with new scenes" : "Navodila · vaja z novimi prizori"}</p>
        <h1>{isEnglish ? "Let us practise choosing new scenes" : "Vadimo izbiro novih prizorov"}</h1>
        <p className="lead-small">{participantText("V glavni igri boste po sedmih preizkusih v vsaki nalogi ugibali, kateri novi prizori sledijo istemu pravilu. Zdaj bomo to vadili. Izberite vse prizore, za katere mislite, da prikličejo zvezdice po pravilu naše vaje.", "V glavni igri boš po sedmih preizkusih v vsaki nalogi ugibal(a), kateri novi prizori sledijo istemu pravilu. Zdaj bomo to vadili. Izberi vse prizore, za katere misliš, da prikličejo zvezdice po pravilu naše vaje.", "In the main game, after seven tests in each problem, you will guess which new scenes follow the same rule. Let us practise this now. Select all scenes you think get stars under our practice rule.")}</p>
        <p>{participantText("Za vsako pravilno odločitev dobite eno točko: če izberete prizor, ki prikliče zvezdice, ali če pustite neizbran prizor, ki jih ne prikliče.", "Za vsako pravilno odločitev dobiš eno točko: če izbereš prizor, ki prikliče zvezdice, ali če pustiš neizbran prizor, ki jih ne prikliče.", "Each correct decision earns one point: selecting a scene that gets stars or leaving a scene without stars unselected.")}</p>
        <div className="probe-grid">{demo.generalisation_probes.map(probe => <button type="button" key={probe.probe_id} disabled={revealed} className={`probe-card ${probe.selected ? "is-selected" : ""} ${revealed ? probe.selected === probe.true_label ? "is-correct" : "is-incorrect" : ""}`} onClick={() => togglePracticeProbe(probe.probe_id)} aria-pressed={probe.selected}>
          <span className="probe-check">{probe.selected ? participantText("Vaša izbira", "Tvoja izbira", "Your choice") : ""}</span>
          <div className="practice-probe-result"><SceneView scene={probe.scene} compact language={language} />
            {revealed && probe.true_label ? <StarShower /> : null}
            {revealed ? <span className={`history-result-star ${probe.true_label ? "history-result-star--positive" : "history-result-star--negative"}`} aria-label={probe.true_label ? (isEnglish ? "Stars appear" : "Zvezdice se usujejo") : (isEnglish ? "No stars" : "Brez zvezdic")}>{probe.true_label ? "★" : "☆"}</span> : null}
          </div>
        </button>)}</div>
        {!revealed ? <button className="button button--primary" type="button" disabled={!anySelected} onClick={finishPracticeGeneralisation}>{participantText("Preverite izbiro za vajo", "Preveri izbiro za vajo", "Check practice choices")}</button> : <>
          <h2>{participantText(`Pravilno ste ocenili ${score} od 8 prizorov.`, `Pravilno si ocenil(a) ${score} od 8 prizorov.`, `You correctly classified ${score} of 8 scenes.`)}</h2>
          <div className="practice-probe-legend">
            <span><strong>{isEnglish ? "Green outline:" : "Zelena obroba:"}</strong> {isEnglish ? "your decision was correct." : "odločitev je bila pravilna."}</span>
            <span><strong>{isEnglish ? "Red outline:" : "Rdeča obroba:"}</strong> {isEnglish ? "your decision was incorrect." : "odločitev je bila napačna."}</span>
            <span><strong>{participantText("»Vaša izbira«:", "»Tvoja izbira«:", "“Your choice”:")}</strong> {isEnglish ? "a scene you selected." : "izbrani prizor."}</span>
            <span><strong>{isEnglish ? "Yellow stars:" : "Rumene zvezdice:"}</strong> {isEnglish ? "the scene follows the rule." : "prizor sledi pravilu."}</span>
          </div>
          <p className="practice-rule-reveal"><strong>{isEnglish ? "The practice rule was: " : "Pravilo vaje je bilo: "}</strong>{isEnglish ? PRACTICE_RULE_ENGLISH_TEXT : PRACTICE_RULE.slovene}</p>
          <p>{isEnglish ? "In the main game, you will see the correct rules and your scores at the end of all five problems." : "V glavni igri bodo pravilna pravila in rezultati prikazani na koncu vseh petih nalog."}</p>
          <button className="button button--primary" type="button" onClick={goToComprehension}>{participantText("Preverite razumevanje", "Preveri razumevanje", "Check your understanding")}</button>
        </>}
      </section>
    </main>;
  }

  const comprehensionQuestions = isEnglish ? [
    { id: "star", adult: "Do yellow stars mean that a scene follows the hidden rule?", child: "Do yellow stars mean that a scene follows the hidden rule?", adultExplanation: "When yellow stars appear, the scene follows the hidden rule. If they do not appear, it does not follow the rule.", childExplanation: "When yellow stars appear, the scene follows the hidden rule. If they do not appear, it does not follow the rule." },
    { id: "demonstration", adult: "Does the same hidden rule apply across all five problems?", child: "Does the same hidden rule apply across all five problems?", adultExplanation: "No. Each problem has a different hidden rule. Within one problem, that rule stays the same for every scene you test.", childExplanation: "No. Each problem has a different hidden rule. Within one problem, that rule stays the same for every scene you test." },
    { id: "source", adult: "Can you start with a new empty scene or choose any previous scene?", child: "Can you start with a new empty scene or choose any previous scene?", adultExplanation: "For every test, you can choose a fresh empty scene or a copy of any previous scene.", childExplanation: "For every test, you can choose a fresh empty scene or a copy of any previous scene." },
    { id: "gate", adult: "Before every test, must you choose a description of what you want to find out with your scene?", child: "Before every test, must you choose a description of what you want to find out with your scene?", adultExplanation: "Yes. Before every test, including the first, you must choose exactly one description of your reason.", childExplanation: "Yes. Before every test, including the first, you must choose exactly one description of your reason." },
    { id: "batch", adult: "Can you select several shapes and change the same feature for all of them at once?", child: "Can you select several shapes and change the same feature for all of them at once?", adultExplanation: "You can select several shapes and then change their colour, size or form at the same time.", childExplanation: "You can select several shapes and then change their colour, size or form at the same time." },
  ] : [
    { id: "star", adult: "Ali rumene zvezdice pomenijo, da prizor sledi skritemu pravilu?", child: "Ali rumene zvezdice pomenijo, da prizor sledi skritemu pravilu?", adultExplanation: "Ko se usujejo rumene zvezdice, prizor sledi skritemu pravilu. Če se ne usujejo, mu ne sledi.", childExplanation: "Ko se usujejo rumene zvezdice, prizor sledi skritemu pravilu. Če se ne usujejo, mu ne sledi." },
    { id: "demonstration", adult: "Ali v vseh petih nalogah velja isto skrito pravilo?", child: "Ali v vseh petih nalogah velja isto skrito pravilo?", adultExplanation: "Ne. Vsaka naloga ima drugo skrito pravilo. Znotraj posamezne naloge pa isto pravilo velja za vse preizkušene prizore.", childExplanation: "Ne. Vsaka naloga ima drugo skrito pravilo. Znotraj posamezne naloge pa isto pravilo velja za vse preizkušene prizore." },
    { id: "source", adult: "Ali lahko začnete z novim praznim prizorom ali izberete katerikoli stari prizor?", child: "Ali lahko začneš z novim praznim prizorom ali izbereš katerikoli stari prizor?", adultExplanation: "Pri vsakem preizkusu lahko izberete svež prazen prizor ali kopijo kateregakoli prejšnjega prizora.", childExplanation: "Pri vsakem preizkusu lahko izbereš svež prazen prizor ali kopijo kateregakoli prejšnjega prizora." },
    { id: "gate", adult: "Ali morate pred vsakim preizkusom izbrati opis o tem, kaj želite ugotoviti s svojim prizorom?", child: "Ali moraš pred vsakim preizkusom izbrati opis o tem, kaj želiš ugotoviti s svojim prizorom?", adultExplanation: "Da. Pred vsakim preizkusom izberete natanko en opis svojega namena.", childExplanation: "Da. Pred vsakim preizkusom izbereš natanko en opis svojega namena." },
    { id: "batch", adult: "Ali lahko označite več likov in jim hkrati spremenite isto lastnost?", child: "Ali lahko označiš več likov in jim hkrati spremeniš isto lastnost?", adultExplanation: "Izberete lahko več likov in nato vsem hkrati spremenite barvo, velikost ali obliko.", childExplanation: "Izbereš lahko več likov in nato vsem hkrati spremeniš barvo, velikost ali obliko." },
  ];

  function renderComprehension() {
    return (
      <main lang={language} className="content-shell">
        <section className="paper-card quiz-card">
          <p className="eyebrow">{isEnglish ? "Understanding check" : "Preverjanje razumevanja"}</p>
          <p className="lead-small">{participantText("Pred začetkom odgovorite na pet vprašanj.", "Pred začetkom odgovori na pet vprašanj.", "Answer five questions before you begin.")} {participantText("Če se zmotite, boste na koncu videli pravilen odgovor in kratko razlago.", "Če se zmotiš, boš na koncu videl(a) pravilen odgovor in kratko razlago.", "If you make a mistake, you will immediately see the correct answer and a brief explanation.")}</p>
          {comprehensionQuestions.map((question, index) => (
            <fieldset key={question.id} className={quizReviewed && comprehensionAnswers[question.id] !== COMPREHENSION_KEY[question.id] ? "quiz-question quiz-question--incorrect" : "quiz-question"}>
              <legend>{index + 1}. {question[variant]}</legend>
              <div className="segmented">
                {[true, false].map((answer) => (
                  <button
                    key={String(answer)}
                    type="button"
                    className={comprehensionAnswers[question.id] === answer ? "is-active" : ""}
                    disabled={quizReviewed}
                    onClick={() => setComprehensionAnswers((current) => ({ ...current, [question.id]: answer }))}
                  >
                    {answer ? (isEnglish ? "Yes" : "Da") : (isEnglish ? "No" : "Ne")}
                  </button>
                ))}
              </div>
              {quizReviewed && comprehensionAnswers[question.id] !== COMPREHENSION_KEY[question.id] ? (
                <p className="quiz-correction"><strong>{isEnglish ? "Correct answer:" : "Pravilen odgovor:"} {COMPREHENSION_KEY[question.id] ? (isEnglish ? "Yes" : "Da") : (isEnglish ? "No" : "Ne")}.</strong> {(isAdult ? question.adultExplanation : question.childExplanation).replace(isEnglish ? /^(Yes|No)\.\s*/ : /^(Da|Ne)\.\s*/, "")}</p>
              ) : null}
            </fieldset>
          ))}
          {notice ? <p className="form-notice">{notice}</p> : null}
          <button className="button button--primary" type="button" onClick={quizReviewed && session ? () => beginMainTrials(session, "comprehension_feedback_acknowledged") : submitComprehension}>{quizReviewed ? participantText("Nadaljujte v igro", "Nadaljuj v igro", "Continue to the game") : participantText("Preverite odgovore", "Preveri odgovore", "Check answers")}</button>
        </section>
      </main>
    );
  }

  function renderRuleIntro() {
    return (
      <main lang={language} className="content-shell rule-intro-shell">
        <section className="paper-card rule-intro-card">
          {previewFifthRule ? <p className="eyebrow">Predogled pete naloge · odgovori se ne shranjujejo.</p> : null}
          <div className="rule-number">{trialPosition + 1}</div>
          <p className="eyebrow">{trialPosition === 0 ? (isEnglish ? "The first task begins" : "Začenja se prva naloga") : (isEnglish ? "New hidden rule" : "Novo skrito pravilo")}</p>
          <h1>{isEnglish ? "Rule" : "Pravilo"} {trialPosition + 1} {isEnglish ? "of" : "od"} 5</h1>
          <p className="lead">
            {isEnglish
              ? trialPosition === 0
                ? "The star laboratory is opening its first station. First look at a positive scene that summons a star, and then you will begin constructing scenes."
                : "You have arrived at a new star station. A completely new rule applies here, so you no longer need the previous one. First, simply observe the initial example."
              : isAdult
              ? trialPosition === 0
                ? "Zvezdni laboratorij odpira prvo postajo. Najprej poglejte pozitiven prizor, ki prikliče zvezdo, nato pa boste vi začeli sestavljati prizore."
                : "Prispeli ste na novo zvezdno postajo, kjer velja povsem novo pravilo. Najprej samo opazujte začetni primer."
              : trialPosition === 0
                ? "Zvezdni laboratorij odpira prvo postajo. Najprej poglej pozitiven prizor, ki prikliče zvezdo, nato pa boš ti začel(a) sestavljati prizore."
                : "Prispel(a) si na novo zvezdno postajo, kjer velja povsem novo pravilo. Najprej samo opazuj začetni primer."}
          </p>
          {(!isEnglish || variant === "child") ? <div className="story-box"><span aria-hidden="true">★</span><p>{isEnglish ? "Every test helps the laboratory restore part of the lost star instructions." : "Vsak preizkus pomaga laboratoriju obnoviti del izgubljenih zvezdnih navodil."}</p></div> : null}
          <button className="button button--primary" type="button" onClick={showInitialDemonstration}>{participantText("Poglejte prvi namig", "Poglej prvi namig", "Show the initial example")}</button>
        </section>
      </main>
    );
  }

  function renderInitial() {
    if (!currentTrial) return null;
    return (
      <main lang={language} className="study-shell">
        <ProgressHeader variant={variant} language={language} reviewOnly={reviewOnly} trialPosition={trialPosition} sceneNumber={1} saveState={saveState} />
        <section className="paper-card initial-card">
          <p className="eyebrow">{participantText("Začetni pozitivni primer", "Začetni pozitivni primer", "Initial positive example · just observe")}</p>
          <h1>{isEnglish ? "This scene follows the hidden rule" : "Ta prizor sledi skritemu pravilu"}</h1>
          <p className="lead-small">{participantText("To je prvi namig za novo pravilo. Prizora ne spreminjajte in ga ne preizkušajte.", "To je prvi namig za novo pravilo. Prizora ne spreminjaj in ga ne preizkušaj.", "This is the first clue to the new rule. Do not change or test the scene.")}</p>
          <div className="feedback-board-wrap"><SceneView scene={currentTrial.initial_scene} language={language} />{!isEnglish ? <StarShower gentle once /> : null}</div>
          <div className="result-banner result-banner--positive">{isEnglish ? <span>★</span> : null}<div><strong>{isEnglish ? "Yellow stars appeared." : "Rumene zvezdice so se usule."}</strong><p>{isEnglish ? "This scene follows the hidden rule." : "Ta prizor sledi skritemu pravilu."}</p></div></div>
          <button className="button button--primary" type="button" onClick={continueFromInitial}>{participantText("Nadaljujte na sestavljanje prizora", "Nadaljuj na sestavljanje prizora", "Continue to scene construction")}</button>
        </section>
      </main>
    );
  }

  function renderEditor() {
    const practiceMode = practiceEditorMode;
    const editorText = (adult: string, child: string, english: string) => {
      const text = participantText(adult, child, english);
      return practiceMode ? emphasiseDemoQuotes(text) : text;
    };
    if (!practiceMode && !currentTrial) return null;
    const sceneNumber = practiceMode
      ? practiceIndex + 1
      : (currentTrial?.active_tests.length ?? 0) + 2 - (inlineFeedback ? 1 : 0);
    const sourceReady = sourceChoice === "fresh" || (sourceChoice === "existing" && anchorSceneId !== null);
    const guidedPractice = practiceMode && practiceStage !== "open";
    const constructionHeading = (<div className="section-heading"><h1 className="construction-heading">{editorText("Sestavite prizor", "Sestavi prizor", "Construct a scene")}</h1><span>{editorScene.objects.length}/{MAX_OBJECTS} {isEnglish ? "shapes" : "likov"}</span></div>);
    return (
      <main lang={language} className={`study-shell${inlineFeedback ? " is-showing-feedback" : ""}`}>
        <fieldset className="editor-lock" disabled={inlineFeedback}>
        {practiceMode ? (
          <header className="study-header demo-study-header"><div><span className="eyebrow">{isEnglish ? "Construction demonstration" : "Prikaz sestavljanja"}</span><strong>{isEnglish ? "Practice: two guided scenes and one of your own" : "Vaja: dva vodena prizora in en samostojen"}</strong></div><div className="study-progress"><span>{isEnglish ? "Demonstration scene" : "Prikazni prizor"} {sceneNumber} {isEnglish ? "of" : "od"} 3</span></div><span className={`save-state save-state--${saveState}`}>{previewDemo ? (isEnglish ? "Demo preview" : "Predogled vaje") : reviewOnly ? "Saved in this browser · review copy" : saveState === "saved" ? (isEnglish ? "Saved securely" : "Varno shranjeno") : (isEnglish ? "Demonstration" : "Prikaz")}</span></header>
        ) : <ProgressHeader variant={variant} language={language} reviewOnly={reviewOnly} trialPosition={trialPosition} sceneNumber={sceneNumber} saveState={saveState} />}

        {practiceMode ? <section className="paper-card practice-guide" aria-live="polite">
          <h2>{isEnglish ? "Practice" : "Vaja"} {practiceIndex + 1} · {practiceStage === "guided_edit" ? (isEnglish ? "edit a scene" : "urejanje prizora") : practiceStage === "guided_fresh" ? (isEnglish ? "start fresh" : "nov prazen prizor") : (isEnglish ? "your own scene" : "prizor po lastni izbiri")}</h2>
          {practiceIndex < 2 ? <><ol>{(isEnglish ? practiceProgress.stepsEn : isAdult ? practiceProgress.stepsAdult : practiceProgress.stepsSl).map((step, i) => <li key={step} className={practiceProgress.checks[i] ? "is-done" : ""}><span aria-hidden="true">{practiceProgress.checks[i] ? "✓" : `${i + 1}.`}</span><div>{emphasiseDemoQuotes(step)}</div></li>)}</ol></> : <p>{editorText("Zdaj si sami izberite vprašanje, ki ga želite raziskati, in sestavite prizor. Začnete lahko s prejšnjim prizorom ali praznim prizorom.", "Zdaj si sam(a) izberi vprašanje, ki ga želiš raziskati, in sestavi prizor. Začneš lahko s prejšnjim prizorom ali praznim prizorom.", "Now choose a question to explore and construct your own scene. Start from a previous scene or an empty scene.")}</p>}
          {practiceIndex < 2 ? <p>{editorText("Če pomotoma odstranite lik, kliknite »Vrnite odstranjene like«. Že opravljeni koraki ostanejo označeni.", "Če pomotoma odstraniš lik, klikni »Vrni odstranjene like«. Že opravljeni koraki ostanejo označeni.", "If you remove a shape by mistake, click “Restore removed shapes”. Completed steps stay ticked.")}</p> : null}
          {practiceRemovalToRestore(editorScene, actionEvents).length > 0 ? <button type="button" className="button button--secondary" onClick={restorePracticeObjects}>{participantText("Vrnite odstranjene like", "Vrni odstranjene like", "Restore removed shapes")}</button> : null}
        </section> : null}

        {!isEnglish && (practiceMode || sceneNumber === 2) ? <p className="paper-card response-order-instruction">{participantText("Najprej sestavite prizor. Nato ", "Najprej sestavi prizor. Nato ", "")}{guidedPractice
          ? <>{participantText("zapišite ", "zapiši ", "")}<strong>ugibanje o pravilu</strong></>
          : <>{participantText("po vrsti zapišite ", "po vrsti zapiši ", "")}<strong>ugibanje o pravilu</strong>{participantText(" in izberite ", " in izberi ", "")}<strong>{participantText("opis, kaj ste želeli ugotoviti s tem prizorom", "opis, kaj si želel(a) ugotoviti s tem prizorom", "")}</strong></>}{participantText(". Ko nadaljujete na naslednji korak, se ne vračajte več k prejšnjemu.", ". Ko nadaljuješ na naslednji korak, se ne vračaj več k prejšnjemu.", "")}</p> : null}

        {!guidedPractice ? (practiceMode ? renderPracticeEvidenceStrip() : renderEvidenceStrip(true)) : null}

        {guidedPractice || sourceReady ? <>
        <section className="editor-layout">
          <div className="paper-card board-card">
            {constructionHeading}
            {guidedPractice && isEnglish ? renderPracticeEvidenceStrip() : null}
            <div className="feedback-board-wrap" ref={feedbackBoardRef} tabIndex={-1} aria-label={isEnglish ? "Scene feedback" : "Povratna informacija o prizoru"}>
              <SceneView scene={editorScene} selectedIds={selectedIds} onObjectClick={toggleObject} editable language={language} />
              {inlineFeedback && lastFeedback ? <>
                {lastFeedback.label ? <StarShower gentle /> : null}
                <div className="inline-feedback-status" role="status">
                  <strong>{lastFeedback.label ? (isEnglish ? "★ Stars appeared" : "★ Zvezdice so se usule") : (isEnglish ? "☆ No stars appeared" : "☆ Zvezdice se niso usule")}</strong>
                  <span>{isEnglish ? "The next step will follow automatically." : "Samodejno sledi naslednji korak."}</span>
                </div>
              </> : null}
            </div>
            <div className="board-actions">
              <button type="button" className="button button--secondary" onClick={toggleAddPanel} disabled={editorScene.objects.length >= MAX_OBJECTS}>＋ {editorText("Dodajte lik", "Dodaj lik", "Add a shape")}</button>
              <button type="button" className="button button--danger" onClick={removeSelected} disabled={selectedIds.length === 0}>{editorText("Odstranite", "Odstrani", "Remove")}</button>
            </div>
            {showAdd ? (
              <div className="add-panel">
                <label>{isEnglish ? "Colour" : "Barva"}<select value={addColour} onChange={(event) => setAddColour(event.target.value as Colour)}>{addColourOptions.map((value) => <option value={value} key={value}>{colourLabels[value]}</option>)}</select></label>
                <label>{isEnglish ? "Size" : "Velikost"}<select value={addSize} onChange={(event) => setAddSize(event.target.value as ObjectSize)}>{addSizeOptions.map((value) => <option value={value} key={value}>{sizeLabels[value]}</option>)}</select></label>
                <label>{isEnglish ? "Shape" : "Oblika"}<select value={addShape} onChange={(event) => setAddShape(event.target.value as Shape)}>{addShapeOptions.map((value) => <option value={value} key={value}>{shapeLabels[value]}</option>)}</select></label>
                <button type="button" className="button button--primary" onClick={addObject}>{editorText("Dodajte lik", "Dodaj lik", "Add a shape")}</button>
              </div>
            ) : null}
          </div>

          <aside className="paper-card controls-card">
            <p className="eyebrow">{isEnglish ? "Selected shapes" : "Izbrani liki"}</p>
            <h2>{selectedIds.length ? `${isEnglish ? "Selected" : "Izbrano"}: ${selectedIds.length}` : editorText("Kliknite lik za urejanje", "Klikni lik za urejanje", "Click a shape to edit it")}</h2>
            <p className="muted">{isEnglish ? "Click one shape, or several shapes in succession. A blue outline shows which shapes are selected." : <>{editorText("Kliknite en lik ali zaporedoma več likov.", "Klikni en lik ali zaporedoma več likov.", "")}<strong className="selection-hint">Modra obroba pokaže, kateri liki so označeni.</strong></>}</p>
            <ControlButtons label={isEnglish ? "Colour" : "Barva"} values={colourLabels} selectedObjects={editorScene.objects.filter((item) => selectedIds.includes(item.id))} feature="colour" disabled={!selectedIds.length} onChange={(value) => changeFeature("colour", value as Colour)} />
            <ControlButtons label={isEnglish ? "Size" : "Velikost"} values={sizeLabels} selectedObjects={editorScene.objects.filter((item) => selectedIds.includes(item.id))} feature="size" disabled={!selectedIds.length} onChange={(value) => changeFeature("size", value as ObjectSize)} />
            <ControlButtons label={isEnglish ? "Shape" : "Oblika"} values={shapeLabels} selectedObjects={editorScene.objects.filter((item) => selectedIds.includes(item.id))} feature="shape" disabled={!selectedIds.length} onChange={(value) => changeFeature("shape", value as Shape)} />
          </aside>
        </section>

        {guidedPractice && !isEnglish ? renderPracticeEvidenceStrip() : null}

        <section className="paper-card report-card">
          <label className="hypothesis-field">
            <span>{editorText("Imate idejo, kaj bi lahko bilo skrito pravilo? Zapišite svoje ugibanje. Če še ne veste, napišite »Ne vem«.", "Imaš idejo, kaj bi lahko bilo skrito pravilo? Zapiši svoje ugibanje. Če še ne veš, napiši »Ne vem«.", "Do you have an idea about what the hidden rule could be? Write your guess. If you do not know yet, write “I don’t know”.")}</span>

            <textarea required value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} rows={3} placeholder={isEnglish ? "My best guess about the rule is …" : "Moje najboljše ugibanje o pravilu je …"} />
          </label>
          {operationPrompted ? (
            <>
              <p>{editorText("Izberite opis, ki najbolje opisuje, zakaj ste sestavili ta prizor. Ta izbira šteje kot 1. mesto. Spodaj lahko napišete še druge opise, ki ste jih upoštevali, in jih razvrstite.", "Izberi opis, ki najbolje opisuje, zakaj si sestavil(a) ta prizor. Ta izbira šteje kot 1. mesto. Spodaj lahko napišeš še druge opise, ki si jih upošteval(a), in jih razvrstiš.", "Choose the description that best explains why you built this scene. This choice is rank 1. Below, you can write any additional descriptions you considered and rank them.")}</p>
              <fieldset className="operations-fieldset">
                <legend>{editorText("Zakaj ste izbrali ta prizor za preizkus? Izberite en opis.", "Zakaj si izbral(a) ta prizor za preizkus? Izberi en opis.", "Why did you pick this scene to test? Choose one description.")}</legend>
                <div className="operation-grid">
                  {OPERATION_IDS.map((operation) => (
                    <label key={operation} className={operations.includes(operation) ? "operation-choice is-active" : "operation-choice"}>
                      <input type="radio" name="operation" checked={operations.includes(operation)} onChange={() => toggleOperation(operation)} />
                      <span><span className="operation-name"><OperationIcon operation={operation} />{OPERATION_NAMES[operation][isEnglish ? "en" : "sl"]}</span>{operationLabel(operation)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {operations.includes("other") ? (
                <textarea className="other-operation-input" aria-label={operationLabel("other")} placeholder={operationLabel("other")} rows={2} value={otherOperation} onChange={(event) => setOtherOperation(event.target.value)} />
              ) : null}
              <label className="additional-operations-field">
                <strong>{editorText("Ali še kateri od zgornjih opisov opisuje vaš končni prizor?", "Ali še kateri od zgornjih opisov opisuje tvoj končni prizor?", "Do any additional descriptions above describe your final scene?")}</strong>
                <span>{editorText("Če da, jih napišite spodaj. Uporabite iste opise kot zgoraj. Ob vsakem napišite mesto: 2 za naslednji najpomembnejši opis, nato 3 in tako naprej. Glavna izbira zgoraj je že na 1. mestu. Če dodatnih opisov ni, pustite polje prazno.", "Če da, jih napiši spodaj. Uporabi iste opise kot zgoraj. Ob vsakem napiši mesto: 2 za naslednji najpomembnejši opis, nato 3 in tako naprej. Glavna izbira zgoraj je že na 1. mestu. Če dodatnih opisov ni, pusti polje prazno.", "If so, write them below, using the same descriptions as above. Write a rank beside each: 2 for the next most prominent description, then 3, and so on. Your main choice above is already rank 1. Leave this box empty if there are no additional descriptions.")}</span>
                <textarea className="other-operation-input" name="additional_operations_ranked_text" rows={4} maxLength={4000} value={additionalOperations} onChange={(event) => setAdditionalOperations(event.target.value)} placeholder={"2. …\n3. …"} />
              </label>
            </>
          ) : null}
          {sourceChoice === null ? <p className="form-notice">{editorText("Pred nadaljevanjem zgoraj izberite nov prazen prizor ali obstoječi prizor.", "Pred nadaljevanjem zgoraj izberi nov prazen prizor ali obstoječi prizor.", "Before continuing, choose a new empty scene or an existing scene above.")}</p> : null}
          {editorScene.objects.length === 0 ? <p className="form-notice">{editorText("Pred preizkusom dodajte vsaj en lik.", "Pred preizkusom dodaj vsaj en lik.", "Add at least one shape before testing.")}</p> : null}
          <button type="button" className="button button--test" disabled={!reportReady} onClick={practiceMode ? testPracticeScene : testScene}>▷ {editorText("Preizkusite prizor", "Preizkusi prizor", "Test the scene")}</button>
          {!reportReady ? <p className="test-gate" role="status">{practiceMode && !practiceProgress.ready
            ? editorText("Najprej dokončajte sestavljanje po korakih zgoraj.", "Najprej dokončaj sestavljanje po korakih zgoraj.", "First complete the construction steps above.")
            : editorScene.objects.length === 0
              ? editorText("Dodajte vsaj en lik.", "Dodaj vsaj en lik.", "Add at least one shape.")
              : operationPrompted && operations.length !== 1
                ? editorText("Prizor je pripravljen. Zgoraj izberite en opis, zakaj ste izbrali ta prizor, nato kliknite »Preizkusite prizor«.", "Prizor je pripravljen. Zgoraj izberi en opis, zakaj si izbral(a) ta prizor, nato klikni »Preizkusi prizor«.", "The scene is ready. Choose one reason above, then click “Test the scene”.")
                : operationPrompted && operations.includes("other") && otherOperation.trim().length < 3
                  ? editorText("Dopišite svoj razlog ali izberite drug opis.", "Dopiši svoj razlog ali izberi drug opis.", "Write your reason or choose a different description.")
                  : editorText("Pred preizkusom zapišite ugibanje ali »Ne vem«.", "Pred preizkusom zapiši ugibanje ali »Ne vem«.", "Before testing, write your guess or “I don’t know”.")}</p> : null}
        </section>
        </> : null}
      </fieldset>
        {inlineFeedback && saveState === "error" && session && lastFeedback ? <div className="feedback-save-error" role="alert">
          <p>{participantText("Shranjevanje ni uspelo. Za nadaljevanje poskusite znova.", "Shranjevanje ni uspelo. Za nadaljevanje poskusi znova.", "Saving failed. Please retry to continue.")}</p>
          <button className="button button--primary" type="button" onClick={() => void checkpoint(session, practiceMode ? "practice_active_test" : "active_test", practiceMode ? null : trialPosition, lastFeedback.scene_index)}>{participantText("Ponovite shranjevanje", "Ponovi shranjevanje", "Retry saving")}</button>
        </div> : null}
      </main>
    );
  }

  function renderGeneralisationIntro() {
    return <main lang={language} className="study-shell">
      <ProgressHeader variant={variant} language={language} reviewOnly={reviewOnly} trialPosition={trialPosition} saveState={saveState} />
      <section className="paper-card generalisation-card">
        <p className="lead-small">{participantText("Za to pravilo ste končali sestavljanje prizorov. Zdaj boste videli osem novih prizorov.", "Za to pravilo si končal(a) sestavljanje prizorov. Zdaj boš videl(a) osem novih prizorov.", "You have finished constructing scenes for this rule. You will now see eight new scenes.")} <strong>{isEnglish ? "The hidden rule remains the same." : "Skrito pravilo ostaja enako."}</strong> {participantText("Vaša naloga je izbrati vse prizore, za katere mislite, da prikličejo zvezdice.", "Tvoja naloga je izbrati vse prizore, za katere misliš, da prikličejo zvezdice.", "Your task is to select all the scenes that you think make stars appear.")}</p>
        <button className="button button--primary" type="button" onClick={startGeneralisation}>{participantText("Nadaljujte", "Nadaljuj", "Continue")}</button>
      </section>
    </main>;
  }

  function renderGeneralisation() {
    if (!currentTrial) return null;
    return (
      <main lang={language} className="study-shell">
        <ProgressHeader variant={variant} language={language} reviewOnly={reviewOnly} trialPosition={trialPosition} saveState={saveState} />
        {previewGeneralisation ? <p className="preview-results-notice">{isEnglish ? "Preview · the construction history contains illustrative examples, not participant responses." : "Predogled · zgodovina sestavljanja vsebuje ponazoritvene primere, ne odgovorov udeležencev."}</p> : null}
        {renderEvidenceStrip()}
        <section className="paper-card generalisation-card">
          <h1>{participantText("Kateri prizori prikličejo zvezdo?", "Kateri prizori prikličejo zvezdo?", "Which scenes summon a star?")}</h1>
          <p className="lead-small">{participantText("Izberite vse prizore, za katere mislite, da sledijo skritemu pravilu. Če mislite, da ne sledi noben, ne izberite nobenega.", "Izberi vse prizore, za katere misliš, da sledijo skritemu pravilu. Če misliš, da ne sledi noben, ne izberi nobenega.", "Select every scene that you think follows the hidden rule. If you think none of them follow it, do not select any.")}</p>
          <div className="probe-grid">
            {currentTrial.generalisation_probes.map((probe) => (
              <button type="button" key={probe.probe_id} className={probe.selected ? "probe-card is-selected" : "probe-card"} onClick={() => toggleProbe(probe.probe_id)} disabled={phase !== "generalisation"} aria-pressed={probe.selected}>
                <span className="probe-check">{probe.selected ? participantText("Vaša izbira", "Tvoja izbira", "Your choice") : ""}</span>
                <SceneView scene={probe.scene} compact language={language} />
              </button>
            ))}
          </div>
          {phase !== "finalRuleGuess" ? <button className="button button--primary" type="button" disabled={phase !== "generalisation"} onClick={submitGeneralisation}>{participantText("Potrdite izbiro", "Potrdi izbiro", "Confirm selection")}</button> : null}
          {phase === "generalisationSubmitted" && saveState === "error" && session ? <div role="alert"><p>{participantText("Shranjevanje ni uspelo. Poskusite znova.", "Shranjevanje ni uspelo. Poskusi znova.", "Saving failed. Please retry.")}</p><button type="button" className="button button--secondary" onClick={() => void checkpoint(session, "generalisation_completed", trialPosition)}>{participantText("Ponovno shranite", "Ponovno shrani", "Retry saving")}</button></div> : null}
        </section>
        {phase === "finalRuleGuess" ? <section className="paper-card guess-card">
          <form ref={finalGuessRef} onSubmit={submitFinalRuleGuess}>
            <label className="hypothesis-field" htmlFor="final-rule-guess"><strong>{participantText("Kaj mislite, da je skrito pravilo?", "Kaj misliš, da je skrito pravilo?", "What do you think the hidden rule is?")}</strong></label>
            <p id="final-rule-help">{isEnglish ? "Based on everything you have seen in this block so far, what do you think the rule is? Type your answer in the box below." : <>{participantText("Kaj je po vašem mnenju skrito pravilo na podlagi ", "Kaj je po tvojem mnenju skrito pravilo na podlagi ", "")}<strong>{participantText("vsega, kar ste do zdaj videli v tej nalogi", "vsega, kar si do zdaj videl(a) v tej nalogi", "")} ({trialPosition + 1} od 5)</strong>{participantText("? Svoj odgovor napišite v spodnje polje.", "? Svoj odgovor napiši v spodnje polje.", "")}</>}</p>
            <textarea id="final-rule-guess" aria-describedby="final-rule-help" required minLength={3} maxLength={5000} rows={5} value={finalGuessDraft} onChange={event => setFinalGuessDraft(event.target.value)} />
            <button className="button button--primary" type="submit" disabled={finalGuessDraft.trim().length < 3}>{participantText("Potrdite odgovor", "Potrdi odgovor", "Confirm answer")}</button>
          </form>
        </section> : null}
      </main>
    );
  }

  function renderResults() {
    const trialResults = (previewResults ? RULES.map((rule) => ({
      trial_id: `preview-rule-${rule.id}`,
      rule_id: rule.id,
      final_rule_guess: "",
      generalisation_probes: GENERALISATION_PROBES[rule.id].map((probe) => ({
        selected: false,
        true_label: rule.evaluate(probe.scene),
      })),
    })) : session?.trials ?? []).map((trial) => ({
      trial,
      rule: getRule(trial.rule_id, previewResults ? CURRENT_RULESET_VERSION : session!.ruleset_version),
      correct: trial.generalisation_probes.filter((probe) => probe.selected === probe.true_label).length,
    }));
    const total = trialResults.reduce((sum, result) => sum + result.correct, 0);
    const maximum = trialResults.length * 8;
    return (
      <main lang={language} className="content-shell">
        <section className="paper-card results-card">
          {previewResults ? <p className="preview-results-notice">{isEnglish ? "Results preview · scores are examples." : "Predogled rezultatov · točke so zgolj primer."}</p> : null}
          <p className="eyebrow">{isEnglish ? "Game results" : "Rezultati igre"}</p>
          <h1>{isEnglish ? `You scored ${total} out of ${maximum} points in total.` : isAdult ? `Skupaj ste dosegli ${total} od ${maximum} točk.` : `Skupaj si dosegel(a) ${total} od ${maximum} točk.`}</h1>
          <p className="lead-small">{participantText("Spodaj vidite pravila in svoj rezultat pri izbiri novih prizorov.", "Spodaj vidiš pravila in svoj rezultat pri izbiri novih prizorov.", "Below you can see the rules and your score for choosing new scenes.")}</p>
          <ol className="results-list">
            {trialResults.map(({ trial, rule, correct }) => (
              <li key={trial.trial_id}>
                <div className="result-score"><strong>{correct}</strong><span>{isEnglish ? "of 8" : "od 8"}</span></div>
                <div>
                  <p><strong>{isEnglish ? "The rule was:" : "Pravilo je bilo:"}</strong> {isEnglish ? (rule.id === 2 && (previewResults || session?.ruleset_version === CURRENT_RULESET_VERSION) ? "There are no large shapes in the scene." : ENGLISH_RULE_LABELS[rule.id]) : rule.slovene}</p>
                  <p>{isEnglish ? `You correctly classified ${correct} of the 8 test scenes.` : isAdult ? `Pravilno ste ocenili ${correct} od 8 testnih prizorov.` : `Pravilno si ocenil(a) ${correct} od 8 testnih prizorov.`}</p>
                  {isEnglish && !previewResults ? <p className="result-guess"><strong>{participantText("Vaše ugibanje pravila je bilo:", "Tvoje ugibanje pravila je bilo:", "Your rule guess was:")}</strong> {trial.final_rule_guess || (isEnglish ? "I don't know." : "Ne vem.")}</p> : null}
                </div>
              </li>
            ))}
          </ol>
          {previewResults ? null : <button className="button button--primary" type="button" onClick={() => setPhase("demographics")}>{participantText("Nadaljujte na zaključna vprašanja", "Nadaljuj na zaključna vprašanja", "Continue to the final questions")}</button>}
        </section>
      </main>
    );
  }

  function renderDemographics() {
    return (
      <main lang={language} className="content-shell">
        <section className="paper-card demographics-card">
          {isEnglish ? <p className="eyebrow">A few more questions</p> : null}<h1>{isEnglish ? "Thank you for completing the game" : "Hvala za opravljeno igro"}</h1>
          <form onSubmit={submitDemographics} className="stack-form" onChange={collection ? event => { const data = new FormData(event.currentTarget); setFinalQuestionnaireDraft({ engagement: Number(data.get("engagement")), difficulty: Number(data.get("difficulty")), feedback: String(data.get("feedback") ?? "") }); } : undefined}>
            <label>{isEnglish ? "How interesting was the game?" : "Kako zanimiva je bila igra?"} <span className="range-labels"><span>1 — {isEnglish ? "not at all" : "sploh ne"}</span><span>7 — {isEnglish ? "very" : "zelo"}</span></span><input name="engagement" type="range" min="1" max="7" defaultValue={collection ? finalQuestionnaireDraft.engagement : session?.demographics?.engagement ?? 4} /></label>
            <label>{isEnglish ? "How difficult was the game?" : "Kako težka je bila igra?"} <span className="range-labels"><span>1 — {isEnglish ? "very easy" : "zelo lahka"}</span><span>7 — {isEnglish ? "very difficult" : "zelo težka"}</span></span><input name="difficulty" type="range" min="1" max="7" defaultValue={collection ? finalQuestionnaireDraft.difficulty : session?.demographics?.difficulty ?? 4} /></label>
            <label>{participantText("Ali nam želite še kaj sporočiti?", "Ali nam želiš še kaj sporočiti?", "Is there anything else you would like to tell us?")}<textarea name="feedback" rows={4} defaultValue={collection ? finalQuestionnaireDraft.feedback : session?.demographics?.feedback ?? ""} /></label>
            {notice ? <p className="form-notice">{notice}</p> : null}
            <button className="button button--primary" disabled={saveState === "saving"}>{saveState === "saving" ? (isEnglish ? "Saving …" : "Shranjujem …") : reviewOnly ? "Finish review" : participantText("Končajte in shranite", "Končaj in shrani", "Finish and save")}</button>
          </form>
        </section>
      </main>
    );
  }

  function renderComplete() {
    return (
      <main lang={language} className="welcome-shell">
        <section className="welcome-card completion-card">
          <div className="brand-mark">★</div><p className="eyebrow">{isEnglish ? "Successfully completed" : "Uspešno zaključeno"}</p><h1>{isEnglish ? "Thank you very much!" : "Najlepša hvala!"}</h1>
          <p className="lead">{inMemoryPreview ? (isEnglish ? "This was a preview. No responses were submitted." : "To je bil predogled. Odgovori niso bili poslani.") : reviewOnly ? "This was a review session. No responses were submitted." : isEnglish ? "All responses have been sent and saved securely." : "Vsi odgovori so bili poslani in varno shranjeni."}</p>
          {reviewOnly || inMemoryPreview ? null : <div className="completion-code"><span>{isEnglish ? "Completion code" : "Zaključna šifra"}</span><strong>{session?.completion_code}</strong></div>}
          <p className="muted">{isEnglish ? "You can now close this page." : "To stran lahko zdaj zaprete."}</p>
        </section>
      </main>
    );
  }

  if (storageError && collection) return <main className="content-shell"><section className="paper-card" role="alert"><h1>Shranjevanje v brskalniku ni na voljo.</h1><p>Prosimo, obvestite raziskovalca. Te strani še ne zaprite in ne brišite podatkov brskalnika.</p><button type="button" className="button button--secondary" onClick={() => { try { localStorage.setItem(`${storageKey}:check`, "ok"); localStorage.removeItem(`${storageKey}:check`); setStorageError(false); } catch { /* Keep the warning visible. */ } }}>Ponovi preverjanje</button></section></main>;
  if (phase === "welcome") return renderWelcome();
  if (phase === "instructions") return renderInstructions();
  if (phase === "practiceEditor") return renderEditor();
  if (phase === "practiceFeedback") return renderEditor();
  if (phase === "generalisationTutorial") return renderGeneralisationTutorial();
  if (phase === "comprehension") return renderComprehension();
  if (phase === "ruleIntro") return renderRuleIntro();
  if (phase === "initial") return renderInitial();
  if (phase === "editor") return renderEditor();
  if (phase === "feedback") return renderEditor();
  if (phase === "generalisationIntro") return renderGeneralisationIntro();
  if (phase === "generalisation" || phase === "generalisationSubmitted" || phase === "finalRuleGuess") return renderGeneralisation();
  if (phase === "generalisationConfirmed") return <main lang={language} className="content-shell"><section className="paper-card">
    <h1>{saveState === "saved" ? (isEnglish ? "Your answers are saved." : "Odgovori so shranjeni.") : saveState === "error" ? participantText("Shranjevanje ni uspelo. Poskusite znova.", "Shranjevanje ni uspelo. Poskusi znova.", "Saving failed. Please try again.") : (isEnglish ? "Saving your answers…" : "Shranjujem odgovore …")}</h1>
    <p>{session?.status === "debrief" ? (isEnglish ? "The results of all five problems will appear shortly." : "Kmalu sledi prikaz rezultatov vseh petih nalog.") : (isEnglish ? "The next problem has a new hidden rule. It will start shortly." : "V naslednji nalogi bo novo skrito pravilo. Začela se bo čez nekaj trenutkov.")}</p>
    {saveState === "error" && session ? <button className="button button--secondary" onClick={() => void checkpoint(session, "trial_completed", session.status === "debrief" ? 4 : trialPosition - 1)}>{participantText("Ponovno shranite", "Ponovno shrani", "Try saving again")}</button> : null}
  </section></main>;
  if (phase === "results") return renderResults();
  if (phase === "demographics") return renderDemographics();
  return renderComplete();
}

function ControlButtons({
  label,
  values,
  selectedObjects,
  feature,
  disabled,
  onChange,
}: {
  label: string;
  values: Record<string, string>;
  selectedObjects: SceneObject[];
  feature: "colour" | "size" | "shape";
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="control-group">
      <span>{label}</span>
      <div>
        {Object.entries(values).map(([value, text]) => (
          <button
            type="button"
            key={value}
            className={selectedObjects.length > 0 && selectedObjects.every((item) => item[feature] === value) ? "is-current" : ""}
            aria-pressed={selectedObjects.length > 0 && selectedObjects.every((item) => item[feature] === value)}
            onClick={() => onChange(value)}
            disabled={disabled}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
