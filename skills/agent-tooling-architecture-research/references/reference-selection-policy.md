# Reference Selection Policy

Use references by relevance and authority, not by a fixed list.

## Order Of Preference

1. User-provided references.
2. Current repository source code and tests.
3. Well-known open-source agent/coding-agent projects with relevant implementations.
4. Primary sources from Anthropic, OpenAI, Google/DeepMind, Microsoft Research, Meta, Stanford, MIT, Berkeley, CMU, and benchmark maintainers.
5. Official docs and papers for benchmark/eval projects such as SWE-bench, Terminal-Bench, OSWorld, WebArena, GAIA, tau-bench, Inspect AI, OpenAI Evals, Braintrust, or LangSmith.

## Source Quality Rules

- Prefer source code over README claims for tool/runtime behavior.
- Prefer official papers, docs, and engineering posts over third-party summaries.
- Browse or otherwise refresh when the source could have changed.
- Compare at least 2-3 primary sources before making broad architecture claims.
- Cite or name sources clearly when presenting conclusions.

## Separation Rule

Label findings as:

- **Observed fact**: directly found in source/docs/article.
- **Inference**: a design principle inferred from multiple facts.
- **Recommendation**: what should be done in the current repo.
