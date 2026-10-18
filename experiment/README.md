# Zendo: ranked operations

Independent copy of OG1, in the sibling folder og-1-ranked. OG1 and the protected baseline are unchanged.

Participants choose one main operation (rank 1). An optional text box below asks them to write additional operations using the same descriptions, numbered 2, 3, and so on. Adult and child wording uses the appropriate form of address. The question appears wherever the existing operation question appears: open practice and the main trials. Guided practice remains unchanged.

primary_operation and operations_selected retain the original single choice. additional_operations_ranked_text stores the additional response verbatim (up to 4000 characters), including line breaks and participant-written ranks. Blank means no additional response. Ranks are not parsed or corrected. Drafts resume and reset with each new scene. Rules, stimuli, scene counts and 3-second feedback are inherited unchanged.

Experiment: zendo-og1-ranked-1.0.0. Schema: 2.6.0. Local review: zendo-og1-ranked-preview-1.0.0.

Public repository: https://github.com/danajarutar/zendo-og1-ranked-study
Private encrypted backup: https://github.com/danajarutar/zendo-og1-ranked-responses
Collector: https://zendo-og1-ranked-collector.rutar-danaja.workers.dev

The public repository stores source in experiment/ and compiled preview in review/. No credentials or participant records belong in that repository.

## Setup status

Participant collector and encrypted GitHub backup connected on 2026-10-18 using the existing GitHub credential explicitly authorized by the researcher. All 118 fictional setup checkpoints were exported and recovered exactly from three encrypted files, with no missing or duplicated records. Production participant routes are published separately from OG1. Issue fresh links with collection/scripts/researcher.mjs; do not reuse preview or fictional setup links for real participants.

## Local use

Install dependencies with npm install. npm run build:review builds a local-only preview; npm run build:production builds the data-collecting game. npm test and npm run typecheck verify collection and types. Browser tests use Playwright and local Chrome; adjust the runtime path on another machine.

Results are downloaded with collection/Researcher tools.cmd (option 2) into collection/private/Study data/Sessions/. The combined checkpoint backup is in Backup/full-checkpoints.json. This is separate from OG1 data. Fictional setup IDs are excluded using private/production-smoke.json.

BASELINE.json records the original OG1 source hashes before copying. No original participant data or study-specific secrets were copied.
