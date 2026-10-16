import { readFile, writeFile } from "node:fs/promises";
import { validateStudySessionPayload } from "../../app/lib/checkpoint-contract.ts";
// Explicit OG1 adapter. Never relabel an OG1 export as a historical 2.2 export.
export function modelInput(session) {
  validateStudySessionPayload(session);
  if (!["zendo-og1-ranked-preview-1.0.0", "zendo-og1-ranked-1.0.0"].includes(session.experiment_version)) throw new Error("This adapter handles post-generalisation OG1 final reports only.");
  return { format: "zendo-og1-ranked-model-input-v1", source_schema: session.schema_version, source_experiment: session.experiment_version, ruleset: session.ruleset_version, session_id: session.session_id, participant_code: session.participant_code, variant: session.variant, demographics: session.demographics, interruptions: session.interruptions ?? [], trials: session.trials.map(trial => ({ trial_index: trial.trial_index, rule_id: trial.rule_id, initial_scene: trial.initial_scene, active_tests: trial.active_tests, generalisation_probes: trial.generalisation_probes, generalisation_selection_events: trial.generalisation_selection_events, generalisation_started_at: trial.generalisation_started_at, generalisation_completed_at: trial.generalisation_completed_at, final_rule_guess: trial.final_rule_guess, final_rule_guess_at: trial.final_rule_guess_at, interrupted: (session.interruptions ?? []).some(event => event.trial_index === trial.trial_index && ["editor", "feedback", "generalisationIntro", "generalisation", "generalisationSubmitted", "finalRuleGuess"].includes(event.phase)) })) };
}
if (process.argv[1]?.endsWith("model-input.mjs")) {
  const source = JSON.parse(await readFile(process.argv[2], "utf8"));
  await writeFile(process.argv[3], JSON.stringify({ format: "zendo-og1-ranked-model-input-batch-v1", sessions: source.sessions.map(modelInput) }, null, 2), { flag: "wx", mode: 0o600 });
}
