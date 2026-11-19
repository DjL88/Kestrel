import importlib.util
import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("cull_evaluate", HERE / "evaluate.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def row(ident, truth="bird", predicted="bird", decision="keep", keeper=True,
        auto_species=None, provenance="synthetic"):
    return dict(id=ident, truth=truth, predicted=predicted, decision=decision,
                keeper=keeper, auto_species=auto_species, provenance=provenance)


class EvidenceTests(unittest.TestCase):
    def test_aircraft_osprey_and_review_metrics(self):
        report = module.evaluate([
            row("helicopter-1", "aircraft", "bird", "review", True, "Osprey"),
            row("tiny-bird", "bird", "unknown", "review", True),
            row("distant-bird", "bird", "other", "reject", True),
            row("good-bird", "bird", "bird", "keep", True, "Dipper"),
            row("plane", "aircraft", "aircraft", "review", False),
        ])
        self.assertEqual(report["aircraft_osprey"], 1)
        self.assertEqual(report["unsafe_nonanimal_species"], 1)
        self.assertEqual(report["false_auto_reject"], 1)
        self.assertEqual(report["abstained_subject"], 1)
        self.assertEqual(report["review_only"], 3)
        self.assertEqual(report["confusion"]["aircraft"]["bird"], 1)
        self.assertFalse(report["real_500_photo_benchmark"])

    def test_real_500_requires_all_real(self):
        samples = [row(f"real-{i}", provenance="real-labelled") for i in range(500)]
        self.assertTrue(module.evaluate(samples)["real_500_photo_benchmark"])
        self.assertFalse(module.evaluate(samples[:499])["real_500_photo_benchmark"])
        self.assertFalse(module.evaluate(samples + [row("synthetic")])["real_500_photo_benchmark"])

    def test_fail_closed_incomplete_duplicate_invalid(self):
        for rows in [
            [], [dict(id="a")], [row("A"), row("a")],
            [row("a", truth="helicopter")], [row("a", predicted="osprey")],
            [row("a", keeper=1)], [row("a", auto_species="")],
            [row("a", provenance="unknown")], [row("../private")],
            [row("a", decision="automatic")],
        ]:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                module.evaluate(rows)


    def test_tiny_distant_bird_subgroups_do_not_hide_false_rejects(self):
        records = [
            dict(row("tiny-1", predicted="unknown", decision="review"), subject_size="tiny"),
            dict(row("distant-1", predicted="aircraft", decision="reject"), subject_size="distant"),
            dict(row("normal-1", predicted="bird"), subject_size="normal"),
            row("unmeasured-1"),
        ]
        report = module.evaluate(records)
        self.assertEqual(report["small_bird_total"], 2)
        self.assertEqual(report["small_bird_abstained"], 1)
        self.assertEqual(report["small_bird_review"], 1)
        self.assertEqual(report["small_bird_false_auto_reject"], 1)
        self.assertEqual(report["bird_size_counts"], {"distant": 1, "normal": 1, "tiny": 1, "unknown": 1})
        self.assertFalse(report["real_500_photo_benchmark"])

    def test_malformed_unhashable_labels_and_privacy_sensitive_ids_fail_closed(self):
        for changes in [
            {"truth": []}, {"predicted": {}}, {"decision": []},
            {"provenance": []}, {"subject_size": []}, {"subject_size": "microscopic"},
            {"id": "C:private"}, {"id": "photo.jpg"}, {"id": "a@example.com"},
            {"id": " "}, {"id": 42},
        ]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                module.evaluate([dict(row("safe"), **changes)])


    def test_500_real_birds_without_aircraft_is_not_stratified_evidence(self):
        samples = [row(f"bird-{i}", provenance="real-labelled") for i in range(500)]
        report = module.evaluate(samples)
        self.assertTrue(report["real_500_photo_benchmark"], "legacy count flag remains a provenance gate")
        self.assertEqual(report["real_truth_counts"]["aircraft"], 0)
        self.assertEqual(report["real_small_bird_count"], 0)
        self.assertIn("real aircraft", report["coverage_gaps"])
        self.assertIn("real tiny/distant birds", report["coverage_gaps"])
        self.assertIn("real non-bird/non-aircraft negatives", report["coverage_gaps"])

    def test_real_strata_are_not_filled_by_synthetic_examples(self):
        samples = [
            row("real-aircraft", truth="aircraft", predicted="unknown", provenance="real-labelled"),
            dict(row("real-small", provenance="real-labelled"), subject_size="tiny"),
            row("real-bird", provenance="real-labelled"),
            row("real-other", truth="other", predicted="other", provenance="real-labelled"),
            dict(row("synthetic-small"), subject_size="distant"),
        ]
        report = module.evaluate(samples)
        self.assertEqual(report["real_truth_counts"]["aircraft"], 1)
        self.assertEqual(report["real_small_bird_count"], 1)
        self.assertEqual(report["real_truth_counts"]["bird"], 2)
        self.assertEqual(report["coverage_gaps"], ["500 independently labelled real photos"])
        self.assertFalse(report["real_500_photo_benchmark"])


    def test_real_risk_events_have_real_only_denominators(self):
        records = [
            row("heli-real", "aircraft", "bird", "review", True, "Osprey", "real-labelled"),
            row("heli-synthetic", "aircraft", "bird", "review", True, "Osprey", "synthetic"),
            row("plane-real", "aircraft", "aircraft", "keep", False, None, "real-labelled"),
            row("landscape-real", "other", "other", "review", False, "Osprey", "real-labelled"),
            dict(row("tiny-real", "bird", "unknown", "reject", True, None, "real-labelled"), subject_size="tiny"),
            dict(row("small-synthetic", "bird", "unknown", "reject", True), subject_size="distant"),
            row("safe-bird-real", "bird", "bird", "keep", True, "Dipper", "real-labelled"),
        ]
        report = module.evaluate(records)
        self.assertEqual(report["aircraft_osprey"], 2, "legacy aggregate includes synthetic")
        self.assertEqual(report["false_auto_reject"], 2, "legacy aggregate includes synthetic")
        self.assertEqual(report["real_risk_denominators"], {
            "aircraft": 2, "nonanimal": 3, "human_keepers": 3, "tiny_distant_bird_keepers": 1,
        })
        self.assertEqual(report["real_risk_events"], {
            "aircraft_osprey": 1, "aircraft_any_species": 1,
            "nonanimal_any_species": 2, "human_keeper_false_auto_reject": 1,
            "tiny_distant_bird_keeper_false_auto_reject": 1,
        })

    def test_synthetic_only_evidence_has_zero_real_risk_even_when_unsafe(self):
        report = module.evaluate([
            row("synthetic-hel", "aircraft", "bird", "reject", True, "Osprey"),
            dict(row("synthetic-tiny", "bird", "unknown", "reject", True), subject_size="tiny"),
        ])
        self.assertEqual(report["aircraft_osprey"], 1)
        self.assertEqual(report["false_auto_reject"], 2)
        self.assertTrue(all(value == 0 for value in report["real_risk_denominators"].values()))
        self.assertTrue(all(value == 0 for value in report["real_risk_events"].values()))



if __name__ == "__main__":
    unittest.main()
