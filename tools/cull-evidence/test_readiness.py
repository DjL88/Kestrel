import importlib.util
import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("cull_readiness", HERE / "readiness.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def report():
    return {
        "real_labelled_count": 500, "synthetic_count": 1,
        "real_truth_counts": {"aircraft": 100, "bird": 200, "person": 50, "other": 100, "other-animal": 50},
        "real_small_bird_count": 75,
        "real_risk_denominators": {"aircraft": 100, "nonanimal": 250, "human_keepers": 180, "tiny_distant_bird_keepers": 60},
        "real_risk_events": {"aircraft_osprey": 0, "aircraft_any_species": 0, "nonanimal_any_species": 0,
                             "human_keeper_false_auto_reject": 0, "tiny_distant_bird_keeper_false_auto_reject": 0},
    }


class ReadinessTests(unittest.TestCase):
    def test_real_stratified_coverage_not_a_release_approval(self):
        result = module.assess(report())
        self.assertEqual(result["measurement_status"], "coverage_sufficient_for_human_review")
        self.assertFalse(result["release_approval"])
        self.assertEqual(result["real_coverage"]["ordinary_birds"], 125)
        self.assertEqual(result["synthetic_excluded_from_readiness"], 1)

    def test_500_all_birds_is_not_aircraft_evidence(self):
        r = report()
        r["real_truth_counts"] = {"bird": 500, "aircraft": 0, "other": 0, "person": 0, "other-animal": 0}
        r["real_small_bird_count"] = 0
        r["real_risk_denominators"] = {"aircraft": 0, "nonanimal": 0, "human_keepers": 180, "tiny_distant_bird_keepers": 0}
        output = module.assess(r)
        self.assertEqual(output["measurement_status"], "insufficient_real_coverage")
        self.assertIsNone(output["real_event_uncertainty"]["aircraft_osprey"]["wilson_95_upper"])
        self.assertIn("aircraft", [x["stratum"] for x in output["missing_strata"]])

    def test_one_unsafe_aircraft_and_false_rejects_are_not_hidden(self):
        r = report()
        r["real_risk_events"].update(aircraft_osprey=1, aircraft_any_species=1, nonanimal_any_species=1,
                                      human_keeper_false_auto_reject=1, tiny_distant_bird_keeper_false_auto_reject=1)
        out = module.assess(r)
        self.assertEqual(out["measurement_status"], "observed_safety_events")
        self.assertEqual(out["observed_safety_events"]["aircraft_osprey"], 1)

    def test_wilson_bounds_and_zero_data(self):
        self.assertIsNone(module.wilson_upper(0, 0))
        self.assertGreater(module.wilson_upper(0, 50), 0.05)
        self.assertLess(module.wilson_upper(0, 50), 0.10)
        self.assertEqual(module.wilson_upper(1, 1), 1.0)

    def test_reject_corrupt_and_contradictory_aggregates(self):
        for mutate in [
            lambda r: r.update(real_labelled_count=499),
            lambda r: r["real_truth_counts"].update(aircraft=-1),
            lambda r: r["real_risk_denominators"].update(aircraft=99),
            lambda r: r["real_risk_denominators"].update(nonanimal=300),
            lambda r: r["real_risk_events"].update(aircraft_osprey=10),
            lambda r: r["real_risk_events"].update(aircraft_osprey=1),
            lambda r: r["real_risk_events"].update(aircraft_any_species=101, nonanimal_any_species=101),
            lambda r: r["real_risk_events"].update(tiny_distant_bird_keeper_false_auto_reject=1),
        ]:
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                r = report()
                mutate(r)
                module.assess(r)
        with self.assertRaises(ValueError):
            module.assess(report(), {"aircraft": 10})


if __name__ == "__main__":
    unittest.main()
