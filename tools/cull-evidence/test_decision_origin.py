"""Synthetic end-to-end tests: human override must never count as auto rejection."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + ".py"))
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


evaluate = module("evaluate").evaluate
assess = module("readiness").assess


def row(i, origin=None, decision="reject", keeper=True, size="distant"):
    result = dict(id="origin-%d" % i, truth="bird", predicted="bird",
                  decision=decision, keeper=keeper, auto_species=None,
                  provenance="real-labelled", subject_size=size)
    if origin is not None:
        result["decision_origin"] = origin
    return result


class OriginSafetyTests(unittest.TestCase):
    def test_manual_reject_never_inflates_automatic_rate(self):
        result = assess(evaluate([row(1, "manual"), row(2, "auto"),
                                  row(3, "auto", decision="review"),
                                  row(4, "manual", decision="keep")]))
        self.assertTrue(result["decision_origin_known"])
        auto = result["real_automatic_keeper_reject_uncertainty"]
        self.assertEqual((auto["events"], auto["denominator"]), (1, 2))
        self.assertEqual(result["real_event_uncertainty"]["human_keeper_false_auto_reject"]["events"], 2)

    def test_legacy_and_unknown_origin_do_not_become_auto(self):
        result = assess(evaluate([row(1), row(2, "unknown"), row(3, "manual")]))
        self.assertFalse(result["decision_origin_known"])
        self.assertEqual(result["real_automatic_keeper_reject_uncertainty"]["events"], 0)
        self.assertEqual(result["real_automatic_keeper_reject_uncertainty"]["denominator"], 0)
        self.assertIsNone(result["real_automatic_keeper_reject_uncertainty"]["wilson_95_upper"])

    def test_reject_malformed_origin_and_tampered_summary(self):
        with self.assertRaises(ValueError):
            evaluate([row(1, "robot")])
        aggregate = evaluate([row(1, "auto"), row(2, "manual")])
        aggregate["real_decision_origin"]["auto_keeper_reject_events"] = 2
        with self.assertRaises(ValueError):
            assess(aggregate)

    def test_real_only_not_synthetic_and_tiny_distant(self):
        synthetic = row(3, "auto")
        synthetic["provenance"] = "synthetic"
        result = assess(evaluate([row(1, "auto"), row(2, "manual"), synthetic]))
        self.assertEqual(result["real_automatic_keeper_reject_uncertainty"]["denominator"], 1)
        self.assertEqual(result["real_automatic_keeper_reject_uncertainty"]["events"], 1)
        self.assertFalse(result["release_approval"])


if __name__ == "__main__":
    unittest.main()
