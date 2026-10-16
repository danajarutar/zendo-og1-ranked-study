export type Variant = "adult" | "child";
export type Language = "sl" | "en";
export type Colour = "red" | "blue" | "green";
export type ObjectSize = "small" | "medium" | "large";
export type Shape = "triangle" | "square" | "circle";
export type OperationId =
  | "necessity"
  | "sufficiency"
  | "role_filler"
  | "counterexample"
  | "discovery"
  | "other";

export const CURRENT_EXPERIMENT_VERSION = "zendo-og1-ranked-preview-1.0.0" as const;
// Collection release preserves the 1.4 task protocol; old sessions keep their tags.
export const COLLECTION_EXPERIMENT_VERSION = "zendo-og1-ranked-1.0.0" as const;
export const LEGACY_RULESET_VERSION = "2026-09-28-og1-confirmed" as const;
export const CURRENT_RULESET_VERSION = "2026-10-13-og1-no-large" as const;
export type RulesetVersion = typeof LEGACY_RULESET_VERSION | typeof CURRENT_RULESET_VERSION;
export const MAX_SCENE_OBJECTS = 4;

export const OPERATION_IDS = [
  "necessity",
  "sufficiency",
  "role_filler",
  "counterexample",
  "discovery",
  "other",
] as const satisfies readonly OperationId[];

export interface SceneObject {
  id: string;
  colour: Colour;
  size: ObjectSize;
  shape: Shape;
  slot: number;
}

export interface Scene {
  objects: SceneObject[];
}

export interface RuleDefinition {
  id: number;
  slovene: string;
  formal: string;
  evaluate: (scene: Scene) => boolean;
  initialScene: Scene;
}

export interface ProbeDefinition {
  id: string;
  scene: Scene;
}

export interface InstructionExampleDefinition {
  id: string;
  slovene: string;
  evaluate: (scene: Scene) => boolean;
  positiveScenes: [Scene, Scene];
  negativeScenes: [Scene];
}

export interface ActionEvent {
  event_id: string;
  event_type:
    | "anchor_selected"
    | "fresh_started"
    | "object_added"
    | "objects_removed"
    | "objects_restored"
    | "feature_changed"
    | "selection_changed";
  timestamp: string;
  elapsed_ms: number;
  object_ids?: string[];
  feature?: "colour" | "size" | "shape";
  before?: unknown;
  after?: unknown;
  anchor_scene_id?: string | null;
}

export interface ActiveTestRecord {
  scene_id: string;
  scene_index: number;
  transition_index: number;
  anchor_scene_id: string | null;
  construction_mode: "edit" | "fresh";
  scene: Scene;
  label: boolean;
  hypothesis_text: string;
  // Absent on records saved before guesses became mandatory on every test.
  hypothesis_required?: boolean;
  operation_prompted: boolean;
  operations_selected: OperationId[];
  primary_operation: OperationId | null;
  other_operation_text: string;
  additional_operations_ranked_text?: string;
  action_events: ActionEvent[];
  practice_stage?: "guided_edit" | "guided_fresh" | "open";
  construction_started_at: string;
  report_completed_at: string;
  tested_at: string;
  feedback_shown_at: string;
  construction_duration_ms: number;
}

export interface GeneralisationProbeRecord {
  probe_id: string;
  scene: Scene;
  true_label: boolean;
  selected: boolean;
  display_position: number;
}

export interface GeneralisationSelectionEvent {
  probe_id: string;
  selected: boolean;
  timestamp: string;
  elapsed_ms: number;
}

export interface PracticeDemoRecord {
  /** Absent in legacy sessions, whose guided exercises always used edit first. */
  practice_order?: "edit_first" | "fresh_first";
  rule_id: "practice-exactly-two";
  rule_text: string;
  started_at: string | null;
  active_tests: ActiveTestRecord[];
  generalisation_probes: GeneralisationProbeRecord[];
  generalisation_selection_events: GeneralisationSelectionEvent[];
  generalisation_started_at: string | null;
  generalisation_completed_at: string | null;
  completed_at: string | null;
}

export interface TrialRecord {
  trial_id: string;
  trial_index: number;
  rule_id: number;
  started_at: string;
  ended_at: string | null;
  initial_scene_id: string;
  initial_scene: Scene;
  initial_label: true;
  baseline_hypothesis: string;
  baseline_hypothesis_at: string | null;
  active_tests: ActiveTestRecord[];
  generalisation_probes: GeneralisationProbeRecord[];
  generalisation_selection_events: GeneralisationSelectionEvent[];
  generalisation_started_at: string | null;
  generalisation_completed_at: string | null;
  final_rule_guess: string;
  final_rule_guess_at: string | null;
}

export interface ComprehensionAttempt {
  attempt: number;
  answers: Record<string, boolean>;
  correct_count: number;
  passed: boolean;
  timestamp: string;
}

export interface Demographics {
  study_year?: string;
  study_level?: string;
  school?: string;
  class_number?: string;
  class_letter?: string;
  age_years: number;
  age_months: number;
  gender: string;
  collected_at: string;
  engagement: number | null;
  difficulty: number | null;
  feedback: string;
  submitted_at: string | null;
}

export interface DeviceInfo {
  user_agent: string;
  viewport_width: number;
  viewport_height: number;
  timezone: string;
}

export interface StudySession {
  schema_version: "2.3.0" | "2.6.0";
  experiment_version:
    | "zendo-simplified-1.6.2"
    | "zendo-simplified-1.7.0"
    | "zendo-simplified-1.8.0"
    | "zendo-simplified-1.9.0"
    | "zendo-og1-ranked-1.3.0"
    | typeof COLLECTION_EXPERIMENT_VERSION
    | typeof CURRENT_EXPERIMENT_VERSION;
  ruleset_version: RulesetVersion;
  session_id: string;
  completion_code: string;
  participant_code: string;
  variant: Variant;
  language: Language;
  status: "instructions" | "active" | "debrief" | "complete";
  started_at: string;
  completed_at: string | null;
  consent_confirmed_at: string;
  rule_order: number[];
  practice_demo: PracticeDemoRecord;
  instruction_comprehension_attempts: ComprehensionAttempt[];
  comprehension_attempts: ComprehensionAttempt[];
  trials: TrialRecord[];
  demographics: Demographics | null;
  device: DeviceInfo;
  resume_count: number;
  interruptions?: Array<{
    resumed_at: string;
    last_local_save_at: string;
    phase: string;
    trial_index: number;
    construction_started_at: string;
  }>;
  last_checkpoint_at: string | null;
}

const object = (
  id: string,
  colour: Colour,
  size: ObjectSize,
  shape: Shape,
  slot: number,
): SceneObject => ({ id, colour, size, shape, slot });

const scene = (...objects: SceneObject[]): Scene => ({ objects });

export const INSTRUCTION_EXAMPLES: InstructionExampleDefinition[] = [
  {
    id: "instruction-exactly-three",
    slovene: "V prizoru so natanko trije liki.",
    evaluate: ({ objects }) => objects.length === 3,
    positiveScenes: [
      scene(
        object("ins-three-a", "green", "small", "square", 0),
        object("ins-three-b", "red", "medium", "circle", 1),
        object("ins-three-c", "blue", "large", "triangle", 2),
      ),
      scene(
        object("ins-three-two-a", "blue", "medium", "square", 0),
        object("ins-three-two-b", "green", "large", "circle", 1),
        object("ins-three-two-c", "red", "small", "triangle", 2),
      ),
    ],
    negativeScenes: [scene(
      object("ins-two-a", "red", "small", "triangle", 0),
      object("ins-two-b", "blue", "large", "circle", 1),
    )],
  },
  {
    id: "instruction-no-red",
    slovene: "V prizoru ni nobenega rdečega lika.",
    evaluate: ({ objects }) => objects.every((item) => item.colour !== "red"),
    positiveScenes: [
      scene(
        object("ins-nored-a", "green", "medium", "circle", 0),
        object("ins-nored-b", "blue", "small", "square", 1),
      ),
      scene(
        object("ins-nored-two-a", "blue", "large", "triangle", 0),
        object("ins-nored-two-b", "green", "small", "circle", 1),
        object("ins-nored-two-c", "blue", "medium", "square", 2),
      ),
    ],
    negativeScenes: [scene(
      object("ins-red-a", "green", "large", "triangle", 0),
      object("ins-red-b", "red", "small", "circle", 1),
    )],
  },
  {
    id: "instruction-at-least-one-large",
    slovene: "V prizoru je vsaj en velik lik.",
    evaluate: ({ objects }) => objects.some((item) => item.size === "large"),
    positiveScenes: [
      scene(
        object("ins-large-a", "blue", "small", "circle", 0),
        object("ins-large-b", "green", "large", "triangle", 1),
      ),
      scene(
        object("ins-large-two-a", "red", "large", "square", 0),
        object("ins-large-two-b", "blue", "medium", "triangle", 1),
        object("ins-large-two-c", "green", "small", "circle", 2),
      ),
    ],
    negativeScenes: [scene(
      object("ins-small-a", "red", "small", "square", 0),
      object("ins-medium-a", "blue", "medium", "circle", 1),
    )],
  },
];

export const PRACTICE_RULE = {
  id: "practice-exactly-two" as const,
  slovene: "V prizoru sta natanko dva lika.",
  evaluate: ({ objects }: Scene) => objects.length === 2,
};
export const PRACTICE_RULE_ENGLISH_TEXT = "There are exactly two shapes in the scene.";

export const PRACTICE_INITIAL_SCENE: Scene = scene(
  object("practice-initial-a", "red", "small", "triangle", 0),
  object("practice-initial-b", "blue", "large", "circle", 1),
);

export const PRACTICE_GENERALISATION_PROBES: ProbeDefinition[] = [
  { id: "practice-p1", scene: scene(object("practice-p1-a", "red", "small", "triangle", 0), object("practice-p1-b", "blue", "large", "circle", 1)) },
  { id: "practice-p2", scene: scene(object("practice-p2-a", "green", "medium", "square", 0), object("practice-p2-b", "red", "medium", "circle", 1)) },
  { id: "practice-p3", scene: scene(object("practice-p3-a", "blue", "small", "square", 0), object("practice-p3-b", "green", "large", "triangle", 1)) },
  { id: "practice-p4", scene: scene(object("practice-p4-a", "red", "large", "circle", 0), object("practice-p4-b", "green", "small", "circle", 1)) },
  { id: "practice-n1", scene: scene(object("practice-n1-a", "blue", "medium", "triangle", 0)) },
  { id: "practice-n2", scene: scene(object("practice-n2-a", "green", "small", "square", 0), object("practice-n2-b", "red", "large", "triangle", 1), object("practice-n2-c", "blue", "medium", "circle", 2)) },
  { id: "practice-n3", scene: scene(object("practice-n3-a", "red", "small", "circle", 0), object("practice-n3-b", "green", "small", "square", 1), object("practice-n3-c", "blue", "large", "triangle", 2), object("practice-n3-d", "red", "medium", "square", 3)) },
  { id: "practice-n4", scene: scene(object("practice-n4-a", "green", "large", "circle", 0), object("practice-n4-b", "blue", "small", "circle", 1), object("practice-n4-c", "red", "medium", "triangle", 2)) },
];

export const RULES: RuleDefinition[] = [
  {
    id: 1,
    slovene: "Vsaj dva lika sta enake oblike.",
    formal: "exists x,y: x != y and shape(x) = shape(y)",
    evaluate: ({ objects }) =>
      objects.some((item, index) =>
        objects.some((other, otherIndex) =>
          index !== otherIndex && item.shape === other.shape,
        ),
      ),
    initialScene: scene(
      object("r1-i1", "red", "small", "triangle", 0),
      object("r1-i2", "green", "large", "triangle", 1),
      object("r1-i3", "blue", "large", "circle", 2),
    ),
  },
  {
    id: 2,
    slovene: "V prizoru ni nobenega velikega lika.",
    formal: "not exists x: size(x) = large",
    evaluate: ({ objects }) =>
      objects.length > 0 && !objects.some((item) => item.size === "large"),
    initialScene: scene(
      object("r2-i1", "red", "small", "triangle", 0),
      object("r2-i2", "blue", "medium", "circle", 1),
      object("r2-i3", "green", "medium", "square", 2),
    ),
  },
  {
    id: 3,
    slovene: "V prizoru je vsaj en rdeč lik.",
    formal: "exists x: colour(x) = red",
    evaluate: ({ objects }) =>
      objects.some((item) => item.colour === "red"),
    initialScene: scene(
      object("r3-i1", "red", "small", "triangle", 0),
      object("r3-i2", "green", "large", "circle", 1),
      object("r3-i3", "blue", "large", "triangle", 2),
    ),
  },
  {
    id: 4,
    slovene: "Natanko en lik je moder.",
    formal: "exactly 1 x: colour(x) = blue",
    evaluate: ({ objects }) => objects.filter((item) => item.colour === "blue").length === 1,
    initialScene: scene(
      object("r4-i1", "blue", "small", "circle", 0),
      object("r4-i2", "red", "small", "square", 1),
      object("r4-i3", "red", "large", "triangle", 2),
    ),
  },
  {
    id: 5,
    slovene: "V prizoru je vsaj en majhen moder lik.",
    formal: "exists x: size(x) = small and colour(x) = blue",
    evaluate: ({ objects }) =>
      objects.some(
        (item) =>
          item.size === "small" && item.colour === "blue",
      ),
    initialScene: scene(
      object("r5-i1", "green", "small", "square", 0),
      object("r5-i2", "green", "large", "circle", 1),
      object("r5-i3", "blue", "small", "triangle", 2),
    ),
  },
];

export const GENERALISATION_PROBES: Record<number, ProbeDefinition[]> = {
  1: [
    { id: "r1-p1", scene: scene(object("r1-p1-a", "red", "small", "triangle", 0), object("r1-p1-b", "blue", "large", "triangle", 1)) },
    { id: "r1-p2", scene: scene(object("r1-p2-a", "green", "medium", "square", 0), object("r1-p2-b", "blue", "small", "circle", 1), object("r1-p2-c", "red", "large", "square", 2)) },
    { id: "r1-p3", scene: scene(object("r1-p3-a", "green", "small", "circle", 0), object("r1-p3-b", "red", "medium", "circle", 1), object("r1-p3-c", "blue", "large", "triangle", 2)) },
    { id: "r1-p4", scene: scene(object("r1-p4-a", "blue", "large", "square", 0), object("r1-p4-b", "blue", "small", "square", 1), object("r1-p4-c", "green", "medium", "circle", 2)) },
    { id: "r1-n1", scene: scene(object("r1-n1-a", "red", "small", "triangle", 0)) },
    { id: "r1-n2", scene: scene(object("r1-n2-a", "green", "large", "triangle", 0), object("r1-n2-b", "green", "large", "circle", 1)) },
    { id: "r1-n3", scene: scene(object("r1-n3-a", "blue", "small", "triangle", 0), object("r1-n3-b", "blue", "medium", "circle", 1), object("r1-n3-c", "red", "large", "square", 2)) },
    { id: "r1-n4", scene: scene(object("r1-n4-a", "green", "small", "square", 0), object("r1-n4-b", "red", "large", "circle", 1)) },
  ],
  2: [
    { id: "r2-p1", scene: scene(object("r2-p1-a", "red", "small", "triangle", 0), object("r2-p1-b", "blue", "small", "circle", 1)) },
    { id: "r2-p2", scene: scene(object("r2-p2-a", "green", "small", "square", 0), object("r2-p2-b", "red", "medium", "circle", 1)) },
    { id: "r2-p3", scene: scene(object("r2-p3-a", "red", "medium", "circle", 0), object("r2-p3-b", "green", "medium", "triangle", 1), object("r2-p3-c", "blue", "medium", "square", 2)) },
    { id: "r2-p4", scene: scene(object("r2-p4-a", "blue", "medium", "triangle", 0), object("r2-p4-b", "red", "small", "square", 1), object("r2-p4-c", "blue", "medium", "circle", 2)) },
    { id: "r2-n1", scene: scene(object("r2-n1-a", "red", "small", "triangle", 0), object("r2-n1-b", "blue", "large", "circle", 1)) },
    { id: "r2-n2", scene: scene(object("r2-n2-a", "green", "large", "square", 0), object("r2-n2-b", "green", "small", "square", 1)) },
    { id: "r2-n3", scene: scene(object("r2-n3-a", "blue", "small", "circle", 0), object("r2-n3-b", "red", "medium", "triangle", 1), object("r2-n3-c", "green", "large", "square", 2)) },
    { id: "r2-n4", scene: scene(object("r2-n4-a", "red", "large", "circle", 0), object("r2-n4-b", "blue", "large", "triangle", 1), object("r2-n4-c", "green", "medium", "square", 2)) },
  ],
  3: [
    { id: "r3-p1", scene: scene(object("r3-p1-a", "red", "small", "triangle", 0), object("r3-p1-b", "blue", "large", "circle", 1)) },
    { id: "r3-p2", scene: scene(object("r3-p2-a", "green", "medium", "circle", 0), object("r3-p2-b", "green", "medium", "triangle", 1), object("r3-p2-c", "red", "large", "square", 2)) },
    { id: "r3-p3", scene: scene(object("r3-p3-a", "red", "small", "triangle", 0), object("r3-p3-b", "blue", "small", "circle", 1), object("r3-p3-c", "green", "small", "circle", 2)) },
    { id: "r3-p4", scene: scene(object("r3-p4-a", "red", "large", "square", 0), object("r3-p4-b", "green", "large", "triangle", 1), object("r3-p4-c", "blue", "medium", "circle", 2)) },
    { id: "r3-n1", scene: scene(object("r3-n1-a", "green", "small", "triangle", 0), object("r3-n1-b", "blue", "medium", "square", 1)) },
    { id: "r3-n2", scene: scene(object("r3-n2-a", "green", "large", "circle", 0), object("r3-n2-b", "blue", "small", "square", 1)) },
    { id: "r3-n3", scene: scene(object("r3-n3-a", "blue", "medium", "square", 0), object("r3-n3-b", "green", "small", "square", 1)) },
    { id: "r3-n4", scene: scene(object("r3-n4-a", "green", "large", "triangle", 0), object("r3-n4-b", "blue", "small", "triangle", 1)) },
  ],
  4: [
    { id: "r4-p1", scene: scene(object("r4-p1-a", "blue", "small", "triangle", 0)) },
    { id: "r4-p2", scene: scene(object("r4-p2-a", "blue", "large", "circle", 0), object("r4-p2-b", "red", "small", "square", 1)) },
    { id: "r4-p3", scene: scene(object("r4-p3-a", "green", "medium", "triangle", 0), object("r4-p3-b", "blue", "medium", "square", 1), object("r4-p3-c", "red", "large", "circle", 2)) },
    { id: "r4-p4", scene: scene(object("r4-p4-a", "red", "small", "circle", 0), object("r4-p4-b", "green", "large", "square", 1), object("r4-p4-c", "blue", "small", "triangle", 2)) },
    { id: "r4-n1", scene: scene(object("r4-n1-a", "red", "small", "triangle", 0)) },
    { id: "r4-n2", scene: scene(object("r4-n2-a", "green", "large", "circle", 0), object("r4-n2-b", "red", "medium", "square", 1)) },
    { id: "r4-n3", scene: scene(object("r4-n3-a", "blue", "small", "triangle", 0), object("r4-n3-b", "blue", "large", "circle", 1)) },
    { id: "r4-n4", scene: scene(object("r4-n4-a", "blue", "medium", "square", 0), object("r4-n4-b", "red", "small", "circle", 1), object("r4-n4-c", "blue", "large", "triangle", 2)) },
  ],
  5: [
    { id: "r5-p1", scene: scene(object("r5-p1-a", "blue", "small", "square", 0)) },
    { id: "r5-p2", scene: scene(object("r5-p2-a", "blue", "small", "circle", 0), object("r5-p2-b", "blue", "large", "circle", 1)) },
    { id: "r5-p3", scene: scene(object("r5-p3-a", "red", "medium", "triangle", 0), object("r5-p3-b", "blue", "small", "triangle", 1), object("r5-p3-c", "green", "large", "circle", 2)) },
    { id: "r5-p4", scene: scene(object("r5-p4-a", "blue", "small", "circle", 0), object("r5-p4-b", "blue", "small", "square", 1), object("r5-p4-c", "red", "large", "square", 2)) },
    { id: "r5-n1", scene: scene(object("r5-n1-a", "green", "small", "circle", 0)) },
    { id: "r5-n2", scene: scene(object("r5-n2-a", "green", "small", "square", 0), object("r5-n2-b", "blue", "large", "square", 1)) },
    { id: "r5-n3", scene: scene(object("r5-n3-a", "red", "small", "square", 0), object("r5-n3-b", "green", "medium", "triangle", 1)) },
    { id: "r5-n4", scene: scene(object("r5-n4-a", "blue", "medium", "triangle", 0), object("r5-n4-b", "green", "large", "circle", 1), object("r5-n4-c", "red", "medium", "square", 2)) },
  ],
};

export const COLOUR_LABELS: Record<Colour, string> = {
  red: "rdeča",
  blue: "modra",
  green: "zelena",
};

export const SIZE_LABELS: Record<ObjectSize, string> = {
  small: "majhna",
  medium: "srednja",
  large: "velika",
};

export const SHAPE_LABELS: Record<Shape, string> = {
  triangle: "trikotnik",
  square: "kvadrat",
  circle: "krog",
};

export const OPERATION_LABELS: Record<OperationId, { adult: string; child: string }> = {
  necessity: {
    adult: "Želeli ste preveriti, ali je določena lastnost potrebna, da se usujejo zvezdice.",
    child: "Želel(a) si preveriti, ali je določena lastnost potrebna, da se usujejo zvezdice.",
  },
  sufficiency: {
    adult: "Želeli ste ustvariti najpreprostejši prizor, ki še prikliče zvezdice.",
    child: "Želel(a) si ustvariti najpreprostejši prizor, ki še prikliče zvezdice.",
  },
  role_filler: {
    adult: "Želeli ste preveriti, ali zvezdice prikliče določena lastnost, na primer zelena barva, ali pa to, da imajo liki enako lastnost, na primer vsi enako barvo.",
    child: "Želel(a) si preveriti, ali zvezdice prikliče določena lastnost, na primer zelena barva, ali pa to, da imajo liki enako lastnost, na primer vsi enako barvo.",
  },
  counterexample: {
    adult: "Glede na vaše ugibanje o pravilu ta prizor ne bi smel dobiti zvezdic. Želeli ste preveriti, ali jih vseeno dobi. Torej ste želeli ustvariti protiprimer.",
    child: "Glede na tvoje ugibanje o pravilu ta prizor ne bi smel dobiti zvezdic. Želel(a) si preveriti, ali jih vseeno dobi. Torej si želel(a) ustvariti protiprimer.",
  },
  discovery: {
    adult: "Želeli ste preizkusiti čisto drugačen prizor kot do sedaj in preveriti, ali se usujejo zvezdice.",
    child: "Želel(a) si preizkusiti čisto drugačen prizor kot do sedaj in preveriti, ali se usujejo zvezdice.",
  },
  other: {
    adult: "Želel(a) sem preveriti nekaj drugega…",
    child: "Želel(a) sem preveriti nekaj drugega…",
  },
};

export function canResumeInCurrentExperiment(
  session: Pick<StudySession, "experiment_version" | "status">,
): boolean {
  return [CURRENT_EXPERIMENT_VERSION, COLLECTION_EXPERIMENT_VERSION].includes(session.experiment_version as typeof CURRENT_EXPERIMENT_VERSION) && session.status !== "complete";
}

// Preserve the original materials for historical data and resumed sessions.
const LEGACY_RULE_TWO: RuleDefinition = {
    id: 2,
    slovene: "Vsi liki so enake velikosti.",
    formal: "forall x,y: size(x) = size(y)",
    evaluate: ({ objects }) =>
      objects.length > 0 && objects.every((item) => item.size === objects[0].size),
    initialScene: scene(
      object("r2-i1", "red", "medium", "triangle", 0),
      object("r2-i2", "blue", "medium", "circle", 1),
      object("r2-i3", "green", "medium", "square", 2),
    ),
  };
const LEGACY_RULE_TWO_PROBES: ProbeDefinition[] = [
    { id: "r2-p1", scene: scene(object("r2-p1-a", "red", "small", "triangle", 0), object("r2-p1-b", "blue", "small", "circle", 1)) },
    { id: "r2-p2", scene: scene(object("r2-p2-a", "green", "large", "square", 0), object("r2-p2-b", "red", "large", "circle", 1)) },
    { id: "r2-p3", scene: scene(object("r2-p3-a", "red", "medium", "circle", 0), object("r2-p3-b", "green", "medium", "triangle", 1), object("r2-p3-c", "blue", "medium", "square", 2)) },
    { id: "r2-p4", scene: scene(object("r2-p4-a", "blue", "large", "triangle", 0), object("r2-p4-b", "red", "large", "square", 1), object("r2-p4-c", "blue", "large", "circle", 2)) },
    { id: "r2-n1", scene: scene(object("r2-n1-a", "red", "small", "triangle", 0), object("r2-n1-b", "blue", "medium", "circle", 1)) },
    { id: "r2-n2", scene: scene(object("r2-n2-a", "green", "large", "square", 0), object("r2-n2-b", "green", "small", "square", 1)) },
    { id: "r2-n3", scene: scene(object("r2-n3-a", "blue", "small", "circle", 0), object("r2-n3-b", "red", "medium", "triangle", 1), object("r2-n3-c", "green", "large", "square", 2)) },
    { id: "r2-n4", scene: scene(object("r2-n4-a", "red", "large", "circle", 0), object("r2-n4-b", "blue", "large", "triangle", 1), object("r2-n4-c", "green", "medium", "square", 2)) },
  ];

export function isRulesetVersion(value: unknown): value is RulesetVersion {
  return value === CURRENT_RULESET_VERSION || value === LEGACY_RULESET_VERSION;
}

export function getGeneralisationProbes(ruleId: number, ruleset: RulesetVersion = CURRENT_RULESET_VERSION): ProbeDefinition[] {
  getRule(ruleId, ruleset); // Reject unknown rules and versions.
  return ruleId === 2 && ruleset === LEGACY_RULESET_VERSION ? LEGACY_RULE_TWO_PROBES : GENERALISATION_PROBES[ruleId];
}

export function getRule(ruleId: number, ruleset: RulesetVersion = CURRENT_RULESET_VERSION): RuleDefinition {
  if (!isRulesetVersion(ruleset)) throw new Error(`Unknown ruleset ${ruleset}`);
  if (ruleId === 2 && ruleset === LEGACY_RULESET_VERSION) return LEGACY_RULE_TWO;
  const rule = RULES.find((item) => item.id === ruleId);
  if (!rule) throw new Error(`Unknown rule ${ruleId}`);
  return rule;
}

export function cloneScene(source: Scene): Scene {
  return { objects: source.objects.map((item) => ({ ...item })) };
}

export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function makeTrial(ruleId: number, trialIndex: number, ruleset: RulesetVersion = CURRENT_RULESET_VERSION): TrialRecord {
  const rule = getRule(ruleId, ruleset);
  return {
    trial_id: crypto.randomUUID(),
    trial_index: trialIndex,
    rule_id: ruleId,
    started_at: new Date().toISOString(),
    ended_at: null,
    initial_scene_id: `rule-${ruleId}-initial`,
    initial_scene: cloneScene(rule.initialScene),
    initial_label: true,
    baseline_hypothesis: "",
    baseline_hypothesis_at: null,
    active_tests: [],
    generalisation_probes: [],
    generalisation_selection_events: [],
    generalisation_started_at: null,
    generalisation_completed_at: null,
    final_rule_guess: "",
    final_rule_guess_at: null,
  };
}

export function validateMaterials(): void {
  for (const example of INSTRUCTION_EXAMPLES) {
    if (example.positiveScenes.length !== 2 || example.negativeScenes.length !== 1) {
      throw new Error(`Instruction example ${example.id} requires two positive and one negative scene.`);
    }
    example.positiveScenes.forEach((exampleScene, index) => {
      if (!example.evaluate(exampleScene)) {
        throw new Error(`Instruction example ${example.id} positive scene ${index + 1} is not positive.`);
      }
    });
    example.negativeScenes.forEach((exampleScene, index) => {
      if (example.evaluate(exampleScene)) {
        throw new Error(`Instruction example ${example.id} negative scene ${index + 1} is not negative.`);
      }
    });
    const canonicalScenes = [...example.positiveScenes, ...example.negativeScenes].map((exampleScene) =>
      JSON.stringify(exampleScene.objects.map(({ colour, size, shape }) => ({ colour, size, shape }))),
    );
    if (new Set(canonicalScenes).size !== canonicalScenes.length) {
      throw new Error(`Instruction example ${example.id} contains a duplicate scene.`);
    }
  }
  if (!PRACTICE_RULE.evaluate(PRACTICE_INITIAL_SCENE)) {
    throw new Error("Practice initial scene is not positive.");
  }
  const practicePositives = PRACTICE_GENERALISATION_PROBES.filter((probe) =>
    PRACTICE_RULE.evaluate(probe.scene),
  ).length;
  if (PRACTICE_GENERALISATION_PROBES.length !== 8 || practicePositives !== 4) {
    throw new Error(
      `Practice requires 8 probes with 4 positives; got ${PRACTICE_GENERALISATION_PROBES.length}/${practicePositives}.`,
    );
  }
  for (const ruleset of [LEGACY_RULESET_VERSION, CURRENT_RULESET_VERSION]) {
    for (const entry of RULES) {
      const rule = getRule(entry.id, ruleset);
      if (!rule.evaluate(rule.initialScene)) {
        throw new Error(`Initial scene for rule ${rule.id} is not positive.`);
      }
      const probes = getGeneralisationProbes(rule.id, ruleset);
      const positives = probes.filter((probe) => rule.evaluate(probe.scene)).length;
      if (probes.length !== 8 || positives !== 4) {
        throw new Error(
          `Rule ${rule.id} requires 8 probes with 4 positives; got ${probes.length}/${positives}.`,
        );
      }
      const seenScenes = new Set<string>();
      for (const probe of probes) {
        const expectedPositive = probe.id.includes("-p");
        const actualPositive = rule.evaluate(probe.scene);
        if (actualPositive !== expectedPositive) {
          throw new Error(
            `Probe ${probe.id} has label ${actualPositive}, expected ${expectedPositive}.`,
          );
        }
        const canonical = JSON.stringify(
          probe.scene.objects.map(({ colour, size, shape }) => ({ colour, size, shape })),
        );
        if (seenScenes.has(canonical)) {
          throw new Error(`Rule ${rule.id} has a duplicate generalisation scene.`);
        }
        seenScenes.add(canonical);
      }
    }
  }
}

validateMaterials();
