#!/usr/bin/env python3
"""Offline, fail-closed metrics for independently labelled culling decisions.

Input JSONL contains anonymous fixture IDs and decisions, never photo paths/pixels.
No model is run here; results describe only the supplied labelled evidence.
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path

TRUTH = {"bird", "aircraft", "person", "other-animal", "other"}
PREDICTED = TRUTH | {"unknown"}
DECISIONS = {"keep", "review", "reject"}
PROVENANCE = {"real-labelled", "synthetic"}
SUBJECT_SIZE = {"normal", "tiny", "distant", "unknown"}


def evaluate(records):
    seen = set()
    matrix = Counter()
    counts = Counter()
    species_errors = []
    for line, record in enumerate(records, 1):
        if not isinstance(record, dict):
            raise ValueError(f"record {line}: expected object")
        required = {"id", "truth", "predicted", "decision", "keeper", "auto_species", "provenance"}
        if not (set(record) == required or set(record) == required | {"subject_size"}):
            raise ValueError(f"record {line}: fields missing or unexpected: {sorted(required ^ set(record))}")
        ident = record["id"]
        if not isinstance(ident, str) or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", ident) is None:
            raise ValueError(f"record {line}: invalid anonymous id")
        if ident.casefold() in seen:
            raise ValueError(f"record {line}: duplicate id")
        seen.add(ident.casefold())
        truth, predicted, decision = record["truth"], record["predicted"], record["decision"]
        if not (isinstance(truth, str) and truth in TRUTH and isinstance(predicted, str) and predicted in PREDICTED and isinstance(decision, str) and decision in DECISIONS):
            raise ValueError(f"record {line}: invalid class or decision")
        if type(record["keeper"]) is not bool or not isinstance(record["provenance"], str) or record["provenance"] not in PROVENANCE:
            raise ValueError(f"record {line}: invalid keeper/provenance")
        species = record["auto_species"]
        if species is not None and (not isinstance(species, str) or not species.strip()):
            raise ValueError(f"record {line}: invalid auto_species")
        size = record.get("subject_size", "unknown")
        if not isinstance(size, str) or size not in SUBJECT_SIZE:
            raise ValueError(f"record {line}: invalid subject_size")
        counts["total"] += 1
        if truth == "bird":
            counts[f"bird_size_{size}"] += 1
            if size in {"tiny", "distant"}:
                counts["small_bird_total"] += 1
                if predicted == "unknown":
                    counts["small_bird_abstained"] += 1
                if decision == "review":
                    counts["small_bird_review"] += 1
                if record["keeper"] and decision == "reject":
                    counts["small_bird_false_auto_reject"] += 1
        counts[record["provenance"]] += 1
        if record["provenance"] == "real-labelled":
            counts[f"real_truth_{truth}"] += 1
            if truth == "bird" and size in {"tiny", "distant"}:
                counts["real_small_birds"] += 1
        counts[f"truth_{truth}"] += 1
        matrix[(truth, predicted)] += 1
        if predicted == "unknown":
            counts["abstained_subject"] += 1
        if decision == "review":
            counts["review_only"] += 1
        if record["keeper"] and decision == "reject":
            counts["false_auto_reject"] += 1
        if species is not None:
            counts["auto_species"] += 1
            if truth != "bird" and truth != "other-animal":
                counts["unsafe_nonanimal_species"] += 1
                species_errors.append(ident)
                if truth == "aircraft":
                    counts["aircraft_species"] += 1
                    if species.casefold() == "osprey":
                        counts["aircraft_osprey"] += 1
    if not counts["total"]:
        raise ValueError("empty evidence is not a benchmark")
    real = counts["real-labelled"]
    return {
        "sample_count": counts["total"],
        "real_labelled_count": real,
        "synthetic_count": counts["synthetic"],
        "real_500_photo_benchmark": real >= 500 and counts["synthetic"] == 0,
        "truth_counts": {key: counts[f"truth_{key}"] for key in sorted(TRUTH)},
        "real_truth_counts": {key: counts[f"real_truth_{key}"] for key in sorted(TRUTH)},
        "real_small_bird_count": counts["real_small_birds"],
        "coverage_gaps": [label for label, present in (
            ("500 independently labelled real photos", real >= 500 and counts["synthetic"] == 0),
            ("real aircraft", counts["real_truth_aircraft"] > 0),
            ("real ordinary birds", counts["real_truth_bird"] > counts["real_small_birds"]),
            ("real tiny/distant birds", counts["real_small_birds"] > 0),
            ("real non-bird/non-aircraft negatives", sum(counts[f"real_truth_{key}"] for key in ("person", "other-animal", "other")) > 0),
        ) if not present],
        "confusion": {truth: {pred: matrix[(truth, pred)] for pred in sorted(PREDICTED)} for truth in sorted(TRUTH)},
        "abstained_subject": counts["abstained_subject"],
        "review_only": counts["review_only"],
        "bird_size_counts": {size: counts[f"bird_size_{size}"] for size in sorted(SUBJECT_SIZE)},
        "small_bird_total": counts["small_bird_total"],
        "small_bird_abstained": counts["small_bird_abstained"],
        "small_bird_review": counts["small_bird_review"],
        "small_bird_false_auto_reject": counts["small_bird_false_auto_reject"],
        "false_auto_reject": counts["false_auto_reject"],
        "auto_species": counts["auto_species"],
        "unsafe_nonanimal_species": counts["unsafe_nonanimal_species"],
        "aircraft_species": counts["aircraft_species"],
        "aircraft_osprey": counts["aircraft_osprey"],
        "unsafe_species_ids": species_errors,
        "note": "Counts only; no calibrated accuracy, model performance, or independent label verification implied.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jsonl", type=Path, help="Anonymous, independently labelled JSONL")
    args = parser.parse_args()
    with args.jsonl.open(encoding="utf-8") as stream:
        result = evaluate(json.loads(line) for line in stream if line.strip())
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
