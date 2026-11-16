# Cull release-quality gate

The quality gate is an **offline, read-only benchmark assessment**, not a production culling action. It never deletes, moves, uploads, or changes a photograph.

It requires independent photographer labels, valid predictions, and enough evidence to judge both high recall and useful automatic selections. Defaults are provisional Alpha targets, not claims of measured performance:

- At least 50 independently labelled photographs and 10 photographer favourites
- At least 95% favourite recall
- At least 80% precision among explicit automatic **Keep** decisions
- At most 40% of photographs retained for human review
- At least 95% valid, unique prediction coverage
- **Zero** known automatically rejected photographer favourites
- No invalid, duplicate, or unexpected prediction identities

A gate can return `pass`, `fail`, or `insufficient-evidence`. No favourite labels, no auto-Keeps, and too-small samples cannot produce a pass. Each failure includes a plain-language reason; the gate does not expose filenames or photograph identities.

These are minimum engineering guardrails, **not sufficient proof of production readiness**. A meaningful Alpha evaluation should include independent, varied, real-world shoots across birds, aircraft, people, mammals and landscapes, varied cameras/RAW formats, difficult lighting, burst sequences and photographer review. Compare to a manual shortlist and report category-level metrics and confidence intervals before release. A synthetic passing fixture is only a regression test.

This gate is deliberately separate from the production culling path and is stacked on PRs #277, #278 and #280.

## Category coverage

A pooled result can hide failures on a rare subject. The gate now requires at least five independently labelled photographs and one photographer favourite **in each** of birds, aircraft, people, mammals, and landscapes. Missing category evidence returns `insufficient-evidence`, not `pass`. A known lost favourite in any category blocks release even when pooled recall looks high. These are deliberately small *minimum* fixtures for engineering validation, not statistically representative sample sizes. Real-shoot benchmarks need substantially more examples per category, difficult cases and independent human review.
