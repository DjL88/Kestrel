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


if __name__ == "__main__":
    unittest.main()
