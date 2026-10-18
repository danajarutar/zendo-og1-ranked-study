# Zendo: ranked operations

Independent adult and child variant alongside [the original OG1 study](https://github.com/danajarutar/zendo-og1-study). The original study is unchanged.

Choose the most prominent operation as rank 1; optionally write additional operations below it, numbered 2, 3, etc. The descriptions, rules, scenes and 3-second feedback remain the same. Written ranks are stored verbatim in additional_operations_ranked_text.

- [Adult preview (no server logging)](https://danajarutar.github.io/zendo-og1-ranked-study/review/?variant=adult&stage=full)
- [Child preview (no server logging)](https://danajarutar.github.io/zendo-og1-ranked-study/review/?variant=child&stage=full)
- [Source and setup instructions](experiment/README.md)

Participant collection and encrypted backup are connected. Recovery verified on 2026-10-18: all 118 fictional setup checkpoints recovered exactly. Participants use fresh private researcher-issued links to /odrasli/ or /otroci/. The /review/ preview remains local-only.

Source is in experiment/. Compiled preview is in review/. Install dependencies at repository root with npm install, then npm test, npm run typecheck or npm run build:review. Response records, credentials, and private links are excluded from this public repository.
