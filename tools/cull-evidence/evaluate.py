#!/usr/bin/env python3
"""Offline, fail-closed metrics for independently labelled culling decisions.

Input JSONL contains anonymous fixture IDs and decisions, never photo paths/pixels.
No model is run here; results describe only the supplied labelled evidence.
"""
import argparse
import json
from collections import Counter
from pathlib import Path

TRUTH = {"bird", "aircraft", "person", "other-animal", "other"}
PREDICTED = TRUTH | {"unknown"}
DECISIONS = {"keep", "review", "reject"}
PROVENANCE = {"real-labelled", "synthetic"}


def evaluate(records):
    seen = set()
    matrix = Counter()
    counts = Counter()
    species_errors = []
    for line, record in enumerate(records, 1):
        if not isinstance(record, dict):
            raise ValueError(f"record {line}: expected object")
        required = {"id", "truth", "predicted", "decision", "keeper", "auto_species", "provenance"}
        if set(record) != required:
            raise ValueError(f"record {line}: fields missing or unexpected: {sorted(required ^ set(record))}")
        ident = record["id"]
        if not isinstance(ident, str) or not ident or "/" in ident or chr(92) in ident or ident.strip() != ident:
            raise ValueError(f"record {line}: invalid anonymous id")
        if ident.casefold() in seen:
            raise ValueError(f"record {line}: duplicate id")
        seen.add(ident.casefold())
        truth, predicted, decision = record["truth"], record["predicted"], record["decision"]
        if truth not in TRUTH or predicted not in PREDICTED or decision not in DECISIONS:
            raise ValueError(f"record {line}: invalid class or decision")
        if type(record["keeper"]) is not bool or record["provenance"] not in PROVENANCE:
            raise ValueError(f"record {line}: invalid keeper/provenance")
        species = record["auto_species"]
        if species is not None and (not isinstance(species, str) or not species.strip()):
            raise ValueError(f"record {line}: invalid auto_species")
        counts["total"] += 1
        counts[record["provenance"]] += 1
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
        "confusion": {truth: {pred: matrix[(truth, pred)] for pred in sorted(PREDICTED)} for truth in sorted(TRUTH)},
        "abstained_subject": counts["abstained_subject"],
        "review_only": counts["review_only"],
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
