"""Exercise the real evaluator -> safety-readiness boundary with synthetic records.

All records are anonymous, synthetic and deterministic; this is not model accuracy.
"""
import importlib.util
import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


evaluator = load("evaluate")
readiness = load("readiness")


def record(number, truth="bird", *, provenance="real-labelled", size=None,
           predicted=None, decision="review", keeper=False, species=None):
    item = {
        "id": "synthetic-%04d" % number,
        "truth": truth,
        "predicted": truth if predicted is None else predicted,
        "decision": decision,
        "keeper": keeper,
        "auto_species": species,
        "provenance": provenance,
    }
    if size is not None:
        item["subject_size"] = size
    return item


class EvidencePipelineTests(unittest.TestCase):
    def representative(self):
        rows = []
        for index in range(100):
            rows.append(record(len(rows), "aircraft"))
        for index in range(150):
            rows.append(record(len(rows), "bird", size="normal", keeper=True))
        for index in range(100):
            rows.append(record(len(rows), "bird", size="distant", keeper=True))
        for index in range(100):
            rows.append(record(len(rows), "other"))
        for index in range(50):
            rows.append(record(len(rows), "person"))
        return rows

    def test_500_real_strata_flow_through_both_modules_without_release_claim(self):
        source = self.representative()
        aggregate = evaluator.evaluate(source)
        result = readiness.assess(aggregate)
        self.assertEqual(aggregate["sample_count"], 500)
        self.assertEqual(result["measurement_status"], "coverage_sufficient_for_human_review")
        self.assertEqual(result["missing_strata"], [])
        self.assertFalse(result["release_approval"])
        self.assertGreater(result["real_event_uncertainty"]["aircraft_osprey"]["wilson_95_upper"], 0)

    def test_aircraft_osprey_and_tiny_bird_false_reject_survive_aggregation(self):
        source = self.representative()
        source[0]["auto_species"] = "Osprey"
        source[250]["decision"] = "reject"  # first distant bird, human-keeper
        aggregate = evaluator.evaluate(source)
        result = readiness.assess(aggregate)
        self.assertEqual(result["measurement_status"], "observed_safety_events")
        self.assertEqual(result["real_risk_denominators"]["aircraft"], 100)
        self.assertEqual(result["observed_safety_events"]["aircraft_osprey"], 1)
        self.assertEqual(result["observed_safety_events"]["tiny_distant_bird_keeper_false_auto_reject"], 1)

    def test_500_real_birds_and_synthetic_aircraft_cannot_pass_stratification(self):
        source = [record(i, "bird", keeper=True) for i in range(500)]
        source.append(record(500, "aircraft", provenance="synthetic", species="Osprey"))
        aggregate = evaluator.evaluate(source)
        result = readiness.assess(aggregate)
        self.assertEqual(result["measurement_status"], "insufficient_real_coverage")
        self.assertEqual(result["real_risk_denominators"]["aircraft"], 0)
        self.assertEqual(result["real_risk_events"]["aircraft_osprey"]["denominator"], 0)
        self.assertIsNone(result["real_risk_events"]["aircraft_osprey"]["wilson_95_upper"])

    def test_failed_or_missing_evaluator_inputs_do_not_become_success(self):
        with self.assertRaises(ValueError):
            evaluator.evaluate([])
        aggregate = evaluator.evaluate(self.representative())
        aggregate.pop("real_risk_denominators")
        with self.assertRaises(ValueError):
            readiness.assess(aggregate)


if __name__ == "__main__":
    unittest.main()
