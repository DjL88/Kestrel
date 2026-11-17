# Culling benchmark uncertainty

`wilson95` reports 95% Wilson score intervals for binomial outcomes, without external services or dependencies. `categoryUncertainty` reports **separate** recall and automatic-Keep precision intervals for birds, aircraft, people, mammals, and landscapes.

A perfect score from one favourite is not evidence of near-certain performance: the 95% lower bound for 1/1 is about 0.21. With no favourites or no automatic Keeps, the corresponding interval is unavailable, not zero or 100%.

This module is an offline, pure calculation intended for independently photographer-labelled **real** shoots. The ten tests use synthetic counts and prove arithmetic/invariants only; they do not validate subject detection, eye tracking, calibration, independence of burst frames, Nikon colour or real-world culling accuracy.

**Interpretation cautions:** correlated burst frames are not independent trials; pooling them understates uncertainty. These intervals also do not correct biased shoot selection, imperfect human labels, class imbalance or detector domain shift. Never use the lower bounds alone to authorize automatic deletion. Preserve original files and nondestructive edits.

Integration with the stacked culling quality-gate PRs is intentionally deferred until their branch dependencies are merged or coordinated, avoiding concurrent edits to the same benchmark modules.
