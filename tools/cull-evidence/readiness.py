"""Conservative review of anonymous Kestrel cull-evidence aggregate counts.

This is a *measurement readiness* aid, not a model acceptance/release gate.
Upstream labels and capture/build provenance are self-reported and unverified.
"""
import argparse
import json
import math
from pathlib import Path

DEFAULT_MINIMUMS = {
    "real_labelled": 500,
    "aircraft": 50,
    "ordinary_birds": 50,
    "tiny_distant_birds": 50,
    "nonanimal_negatives": 50,
    "human_keepers": 100,
}


def wilson_upper(errors: int, trials: int, z: float = 1.96):
    """Two-sided 95% Wilson upper confidence limit, or None without trials."""
    if type(errors) is not int or type(trials) is not int or not (0 <= errors <= trials):
        raise ValueError("event counts and denominators must be valid integers")
    if trials == 0:
        return None
    p = errors / trials
    z2 = z * z
    center = p + z2 / (2 * trials)
    radius = z * math.sqrt(p * (1 - p) / trials + z2 / (4 * trials * trials))
    return min(1.0, (center + radius) / (1 + z2 / trials))


def assess(report: dict, minimums: dict = DEFAULT_MINIMUMS):
    """Describe evidence coverage and observed safety events without verifying labels."""
    if not isinstance(report, dict):
        raise ValueError("aggregate report must be a JSON object")
    if set(minimums) != set(DEFAULT_MINIMUMS) or any(type(n) is not int or n <= 0 for n in minimums.values()):
        raise ValueError("minimums must be positive integers for every stratum")
    try:
        truth = report["real_truth_counts"]
        denominators = report["real_risk_denominators"]
        events = report["real_risk_events"]
        size_count = report["real_small_bird_count"]
        labelled = report["real_labelled_count"]
        synthetic = report["synthetic_count"]
        if not all(isinstance(group, dict) for group in (truth, denominators, events)):
            raise ValueError("invalid nested aggregate objects")
        numbers = [labelled, synthetic, size_count, *truth.values(), *denominators.values(), *events.values()]
        if any(type(n) is not int or n < 0 for n in numbers):
            raise ValueError("aggregate counts must be nonnegative integers")
        if labelled != sum(truth.values()):
            raise ValueError("real truth totals disagree with real labelled count")
        if size_count > truth["bird"]:
            raise ValueError("tiny/distant birds exceed real bird total")
        measured = {
            "real_labelled": labelled,
            "aircraft": truth["aircraft"],
            "ordinary_birds": truth["bird"] - size_count,
            "tiny_distant_birds": size_count,
            "nonanimal_negatives": denominators["nonanimal"],
            "human_keepers": denominators["human_keepers"],
        }
        if denominators["aircraft"] != truth["aircraft"]:
            raise ValueError("aircraft denominator does not match truth count")
        if denominators["nonanimal"] != sum(truth[k] for k in ("aircraft", "person", "other")):
            raise ValueError("nonanimal denominator does not match truth counts")
        if denominators["human_keepers"] > labelled or denominators["tiny_distant_bird_keepers"] > size_count:
            raise ValueError("keeper denominator exceeds evidence")
        risk_pairs = {
            "aircraft_osprey": "aircraft",
            "aircraft_any_species": "aircraft",
            "nonanimal_any_species": "nonanimal",
            "human_keeper_false_auto_reject": "human_keepers",
            "tiny_distant_bird_keeper_false_auto_reject": "tiny_distant_bird_keepers",
        }
        if events["aircraft_osprey"] > events["aircraft_any_species"] or events["aircraft_any_species"] > events["nonanimal_any_species"]:
            raise ValueError("aircraft species event counts are inconsistent")
        if events["tiny_distant_bird_keeper_false_auto_reject"] > events["human_keeper_false_auto_reject"]:
            raise ValueError("tiny/distant false rejects exceed total false rejects")
        bounds = {}
        for key, denominator_key in risk_pairs.items():
            count, total = events[key], denominators[denominator_key]
            bounds[key] = {"events": count, "denominator": total, "wilson_95_upper": wilson_upper(count, total)}
    except (KeyError, TypeError) as exc:
        raise ValueError("missing or invalid cull-evidence aggregate field") from exc
    abstention = report.get("real_subject_abstention")
    if abstention is not None:
        if not isinstance(abstention, dict) or type(abstention.get("total")) is not int or type(abstention.get("denominator")) is not int:
            raise ValueError("invalid real-only abstention summary")
        if abstention["denominator"] != labelled or not (0 <= abstention["total"] <= labelled):
            raise ValueError("abstention denominator inconsistent with real-labelled evidence")
        by_truth = abstention.get("by_truth")
        if not isinstance(by_truth, dict) or set(by_truth) != set(truth):
            raise ValueError("abstention class coverage incomplete")
        if sum(item.get("unknown", -1) for item in by_truth.values() if isinstance(item, dict)) != abstention["total"]:
            raise ValueError("abstention class totals inconsistent")
        for key, count in truth.items():
            item = by_truth[key]
            if not isinstance(item, dict) or item.get("denominator") != count or any(type(item.get(k)) is not int or not 0 <= item[k] <= count for k in ("unknown", "review")):
                raise ValueError("invalid per-class abstention/review count")
    missing = [{"stratum": key, "observed": measured[key], "minimum": required}
               for key, required in minimums.items() if measured[key] < required]
    unsafe = {key: row["events"] for key, row in bounds.items() if row["events"]}
    return {
        "measurement_status": "insufficient_real_coverage" if missing else ("observed_safety_events" if unsafe else "coverage_sufficient_for_human_review"),
        "real_coverage": measured,
        "minimums_are_configurable_not_validated": dict(minimums),
        "missing_strata": missing,
        "observed_safety_events": unsafe,
        "real_event_uncertainty": bounds,
        "synthetic_excluded_from_readiness": synthetic,
        "real_subject_abstention": abstention,
        "decision_origin_known": False,
        "keeper_reject_origin_warning": "Human-keeper rejection is observed; auto-vs-manual decision origin was not captured. Do not claim measured false AUTO reject rates.",
        "release_approval": False,
        "note": "Coverage and uncertainty only. Does not validate labels, sampling, model/build provenance, statistical power or real-world safety. Human review and independent photos required.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("aggregate", type=Path, help="Local aggregate JSON emitted by evaluate.py")
    args = parser.parse_args()
    with args.aggregate.open(encoding="utf-8") as stream:
        result = assess(json.load(stream))
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
