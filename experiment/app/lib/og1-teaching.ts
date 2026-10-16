import type { ActionEvent, Scene, OperationId } from "./experiment.ts";

export const FEEDBACK_DURATION_MS = 3000;
export const PRACTICE_STAGES = ["guided_edit", "guided_fresh", "open"] as const;
export type PracticeStage = typeof PRACTICE_STAGES[number];
export type PracticeOrder = "edit_first" | "fresh_first";

// Draw once when creating a session; never redraw while rendering or resuming.
export function samplePracticeOrder(random: () => number = Math.random): PracticeOrder {
  return random() < 0.5 ? "edit_first" : "fresh_first";
}

export function practiceStages(order?: PracticeOrder): readonly PracticeStage[] {
  return order === "fresh_first" ? ["guided_fresh", "guided_edit", "open"] : PRACTICE_STAGES;
}
export const INSTRUCTION_CHECK_KEY: Record<string, boolean> = {
  count: true, size: true, order: false, position: false,
};
export const INSTRUCTION_CHECKS = [
  { id: "count", sl: "Zvezdice se usujejo, če so v prizoru natanko štirje liki.", en: "Stars appear if there are exactly four shapes in the scene." },
  { id: "size", sl: "Zvezdice se usujejo, če je v prizoru vsaj en velik lik.", en: "Stars appear if there is at least one large shape in the scene." },
  { id: "order", sl: "Zvezdice se usujejo, če najprej dodaš rdeči lik.", en: "Stars appear if you add the red shape first." },
  { id: "position", sl: "Zvezdice se usujejo, če je krog na levi strani prizora.", en: "Stars appear if a circle is on the left of the scene." },
] as const;

// Tutorial illustrations prompt questions; they do not reveal the test rules.
export const THOUGHT_SCENE: Scene = { objects: [
  { id: "thought-red", colour: "red", size: "small", shape: "circle", slot: 0 },
  { id: "thought-blue", colour: "blue", size: "large", shape: "circle", slot: 1 },
  { id: "thought-green", colour: "green", size: "medium", shape: "circle", slot: 2 },
] };
export const OPERATION_THOUGHTS = [
  { sl: "Ali ta krog mora biti rdeč, da se usujejo zvezdice?", en: "Does this circle have to be red for stars to appear?", captionSl: "Ali je neka lastnost potrebna?", captionEn: "Is a feature needed?" },
  { sl: "Bi se zvezdice usule tudi brez drugih likov, če bi bil tu samo ta rdeči krog?", en: "Would stars appear without the other shapes if only this red circle were here?", captionSl: "Kaj je dovolj za zvezdice?", captionEn: "What is enough for stars?" },
  { sl: "Ali se zvezdice usujejo zato, ker so vsi liki krogi, ali zato, ker so vsi enake oblike?", en: "Do stars appear because all the shapes are circles, or because they are all the same shape?", captionSl: "Ali šteje točna lastnost ali vzorec med liki?", captionEn: "Does the particular feature or the pattern matter?" },
  { sl: "Mislim, da je za zvezdice potreben rdeč krog. Ali lahko najdem prizor brez njega, ki vseeno dobi zvezdice?", en: "I think stars need a red circle. Can I find a scene without one that still gets stars?", captionSl: "Ali se moje najboljše ugibanje lahko izkaže za napačno?", captionEn: "Could my best guess turn out to be wrong?" },
  { sl: "Kaj pa, če poskusim čisto drugačen prizor kot prej? Se bodo zvezdice usule?", en: "What if I try a completely different scene from before? Will stars appear?", captionSl: "Kaj se zgodi pri nečem zelo drugačnem?", captionEn: "What happens with something very different?" },
] as const;


// Required second illustrations, in the same order as OPERATION_THOUGHTS.
export const ADDITIONAL_OPERATION_EXAMPLES: {scene: Scene; sl: string; en: string}[] = [
  {
    scene: {objects: [
      {id: "extra-necessity-a", colour: "green", size: "large", shape: "triangle", slot: 0},
      {id: "extra-necessity-b", colour: "red", size: "small", shape: "square", slot: 1},
    ]},
    sl: "Ali ta trikotnik mora biti velik, da se usujejo zvezdice?",
    en: "Does this triangle have to be large for stars to appear?",
  },
  {
    scene: {objects: [
      {id: "extra-sufficiency-a", colour: "blue", size: "medium", shape: "square", slot: 0},
      {id: "extra-sufficiency-b", colour: "red", size: "large", shape: "circle", slot: 1},
      {id: "extra-sufficiency-c", colour: "green", size: "small", shape: "triangle", slot: 2},
    ]},
    sl: "Bi se zvezdice usule tudi brez drugih likov, če bi bil tu samo ta modri kvadrat?",
    en: "Would stars appear without the other shapes if only this blue square were here?",
  },
  {
    scene: {objects: [
      {id: "extra-relations-a", colour: "green", size: "small", shape: "triangle", slot: 0},
      {id: "extra-relations-b", colour: "green", size: "medium", shape: "square", slot: 1},
      {id: "extra-relations-c", colour: "green", size: "large", shape: "circle", slot: 2},
    ]},
    sl: "Ali se zvezdice usujejo zato, ker so vsi liki zeleni, ali zato, ker so vsi enake barve?",
    en: "Do stars appear because all the shapes are green, or because they are all the same colour?",
  },
  {
    scene: {objects: [
      {id: "extra-counterexample-a", colour: "blue", size: "large", shape: "square", slot: 0},
      {id: "extra-counterexample-b", colour: "green", size: "small", shape: "triangle", slot: 1},
    ]},
    sl: "Mislim, da je za zvezdice potreben velik lik. Ali lahko najdem prizor brez velikih likov, ki vseeno dobi zvezdice?",
    en: "I think stars need a large shape. Can I find a scene without any large shapes that still gets stars?",
  },
  {
    scene: {objects: [
      {id: "extra-exploration-a", colour: "red", size: "small", shape: "square", slot: 0},
      {id: "extra-exploration-b", colour: "red", size: "large", shape: "square", slot: 1},
    ]},
    sl: "Kaj pa, če poskusim čisto drugačen prizor kot prej? Se bodo zvezdice usule?",
    en: "What if, instead of these two shapes, I try a scene with four completely different shapes? Will stars appear?",
  },
];

export function guidedPracticeProgress(stage: PracticeStage, scene: Scene, events: ActionEvent[], _anchor: string | null, _source: string | null) {
  // Ticks record completed practice actions and never disappear after later edits.
  const currentEvents = events;
  if (stage === "guided_edit") {
    const copied = events.some(e => e.event_type === "anchor_selected" && e.anchor_scene_id === "practice-initial");
    const changed = events.some(e => e.event_type === "feature_changed" && e.feature === "colour" &&
      e.object_ids?.length === 1 && e.object_ids[0] === "practice-initial-a" &&
      Array.isArray(e.after) && e.after.some(x => x.value === "green"));
    const removed = events.some(e => e.event_type === "objects_removed" &&
      e.object_ids?.length === 1 && e.object_ids[0] === "practice-initial-b");
    const checks = [copied, changed, removed];
    return { checks, ready: checks.every(Boolean) && scene.objects.length > 0,
      stepsSl: ["Klikni »Začetni pozitivni primer« (spodaj), da ga kopiraš.", "Tokrat boš spremenil(a) lastnosti že dodanega lika. Klikni samo rdeči trikotnik, da dobi modro obrobo. Nato v orodni vrstici na desni izberi zeleno barvo.", "Klikni zeleni trikotnik, da njegova modra obroba izgine. Nato klikni modri krog, da bo označen samo le-ta, in pritisni »Odstrani«. Krog mora izginiti iz prizora."],
      stepsAdult: ["Kliknite »Začetni pozitivni primer« (spodaj), da ga kopirate.", "Tokrat boste spremenili lastnosti že dodanega lika. Kliknite samo rdeči trikotnik, da dobi modro obrobo. Nato v orodni vrstici na desni izberite zeleno barvo.", "Kliknite zeleni trikotnik, da njegova modra obroba izgine. Nato kliknite modri krog, da bo označen samo le-ta, in pritisnite »Odstranite«. Krog mora izginiti iz prizora."],
      stepsEn: ["Click “Initial positive example” to copy it.", "Select only the red triangle. Then click “Green” under “Colour” to turn it green.", "Click the green triangle so its blue outline disappears. Then select only the blue circle and click “Remove”. The circle must disappear from the scene."],
    };
  }
  if (stage === "guided_fresh") {
    const added = currentEvents.filter(e => e.event_type === "object_added").map(e => e.after as Scene["objects"][number]);
    const addedPair = added.some(x => x.colour === "red" && x.size === "small" && x.shape === "circle") && added.some(x => x.colour === "blue" && x.size === "large" && x.shape === "square");
    const groupChange = (feature: string, value: string) => currentEvents.some(e => e.event_type === "feature_changed" && e.feature === feature && e.object_ids?.length === 2 && Array.isArray(e.after) && e.after.length === 2 && e.after.every(x => x.value === value));
    const checks = [events.some(e => e.event_type === "fresh_started"), addedPair, groupChange("shape", "triangle"), groupChange("size", "medium")];
    return { checks, ready: checks.every(Boolean) && scene.objects.length > 0, stepsSl: ["Klikni kartico »Nov prazen prizor« (spodaj).", "Dodaj majhen rdeč krog in velik moder kvadrat. Tokrat izberi njune lastnosti pred dodajanjem. Za vsak lik klikni »＋ Dodaj lik«, v orodni vrstici pod prizorom na levi izberi njegove lastnosti in potrdi z gumbom »Dodaj lik«.", "Lastnosti lahko spremeniš tudi po dodajanju lika. Zdaj oba lika hkrati spremeni v trikotnika. Najprej označi oba: klikni tistega, ki še nima modre obrobe. Nato v orodni vrstici na desni izberi trikotnik.", "Oba lika naj ostaneta označena z modro obrobo. V orodni vrstici na desni izberi srednjo velikost, da hkrati spremeniš velikost obeh likov."], stepsAdult: ["Kliknite kartico »Nov prazen prizor« (spodaj).", "Dodajte majhen rdeč krog in velik moder kvadrat. Tokrat izberite njune lastnosti pred dodajanjem. Za vsak lik kliknite »＋ Dodajte lik«, v orodni vrstici pod prizorom na levi izberite njegove lastnosti in potrdite z gumbom »Dodajte lik«.", "Lastnosti lahko spremenite tudi po dodajanju lika. Zdaj oba lika hkrati spremenite v trikotnika. Najprej označite oba: kliknite tistega, ki še nima modre obrobe. Nato v orodni vrstici na desni izberite trikotnik.", "Oba lika naj ostaneta označena z modro obrobo. V orodni vrstici na desni izberite srednjo velikost, da hkrati spremenite velikost obeh likov."], stepsEn: ["Click the “New empty scene” card.", "You can choose an object’s colour, size and shape before adding it. Or you can add the shape first, then click it and change its features using the controls at the side. This time, choose the features before adding each shape. For the small red circle, click “＋ Add a shape”. Under “Colour”, select “Red”; under “Size”, select “Small”; and under “Shape”, select “Circle”. Then click the lower “Add a shape” button. For the large blue square, click “＋ Add a shape” again. Under “Colour”, select “Blue”; under “Size”, select “Large”; and under “Shape”, select “Square”. Then click the lower “Add a shape” button.", "Select both shapes: click the one without a blue outline. Then click “Triangle” under “Shape” to change both to triangles at once.", "When both shapes have a blue outline, click “Medium” under “Size”. This changes the size of both shapes at the same time."] };
  }
  return { checks: [], ready: true, stepsSl: [], stepsAdult: [], stepsEn: [] };
}

export const OPERATION_NAMES: Record<OperationId, {sl: string; en: string}> = {
  necessity: {sl: "Nujnost", en: "Necessity"},
  sufficiency: {sl: "Zadostnost", en: "Sufficiency"},
  role_filler: {sl: "Povezave med liki", en: "Relationships between shapes"},
  counterexample: {sl: "Protiprimer", en: "Counterexample"},
  discovery: {sl: "Raziskovanje", en: "Exploration"},
  other: {sl: "Drug razlog", en: "Other reason"},
};

export function practiceRemovalToRestore(scene: Scene, events: ActionEvent[]) {
  const restart = events.findLastIndex(e => e.event_type === "anchor_selected" || e.event_type === "fresh_started");
  for (let i = events.length - 1; i > restart; i--) {
    const event = events[i];
    if (event.event_type !== "objects_removed" || !Array.isArray(event.before)) continue;
    const missing = (event.before as Scene["objects"]).filter(item => !scene.objects.some(x => x.id === item.id));
    if (missing.length && scene.objects.length + missing.length <= 4) return missing;
  }
  return [];
}
