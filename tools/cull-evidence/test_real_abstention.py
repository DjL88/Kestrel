"""Regression: unknown/review evidence must be real-only and correctly denominated."""
import importlib.util
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

evaluate = load("evaluate").evaluate
assess = load("readiness").assess

def row(i, truth="aircraft", predicted="unknown", decision="review", provenance="real-labelled", keeper=False):
    return dict(id="case"+str(i), truth=truth, predicted=predicted, decision=decision,
                keeper=keeper, auto_species=None, provenance=provenance)

class RealAbstentionTests(unittest.TestCase):
    def test_real_only_abstention_excludes_synthetic_and_preserves_aircraft(self):
        records = [row(1), row(2, predicted="aircraft", decision="keep"),
                   row(3, provenance="synthetic"), row(4, truth="bird", keeper=True, decision="reject")]
        summary = evaluate(records)
        a = summary["real_subject_abstention"]
        self.assertEqual((a["total"], a["denominator"]), (2, 3))
        self.assertEqual((a["by_truth"]["aircraft"]["unknown"], a["by_truth"]["aircraft"]["denominator"]), (1, 2))
        self.assertEqual(summary["real_review_only"], 1)
        ready = assess(summary)
        self.assertEqual(ready["real_subject_abstention"], a)
        self.assertFalse(ready["decision_origin_known"])
        self.assertFalse(ready["release_approval"])

    def test_inconsistent_abstention_fails_closed(self):
        summary = evaluate([row(1), row(2, predicted="aircraft", decision="keep")])
        summary["real_subject_abstention"]["by_truth"]["aircraft"]["unknown"] = 2
        with self.assertRaises(ValueError):
            assess(summary)

    def test_zero_real_cannot_masquerade_as_accuracy(self):
        summary = evaluate([row(1, provenance="synthetic")])
        result = assess(summary)
        self.assertEqual(result["real_subject_abstention"]["denominator"], 0)
        self.assertEqual(result["measurement_status"], "insufficient_real_coverage")
        self.assertIsNone(result["real_event_uncertainty"]["aircraft_osprey"]["wilson_95_upper"])

if __name__ == "__main__":
    unittest.main()
