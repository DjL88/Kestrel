"""Run with:  python -m pytest tools/denoise-training/test_raw_to_pairs.py

Covers the parts that do not need a real RAW file: pattern naming from LibRaw's indices and picking clean frames from
read_lrcat.py output. Decoding itself is exercised by running the tool on real files.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from raw_to_pairs import from_recipes, pattern_name  # noqa: E402


class PatternName(unittest.TestCase):
    def test_libraw_indices_become_bayer_names(self):
        # LibRaw numbers colours by color_desc 'RGBG': 0 R, 1 G, 2 B, 3 second G.
        self.assertEqual(pattern_name(np.array([[0, 1], [3, 2]]), b"RGBG"), "RGGB")
        self.assertEqual(pattern_name(np.array([[1, 2], [0, 3]]), b"RGBG"), "GBRG")
        self.assertEqual(pattern_name(np.array([[2, 3], [1, 0]]), b"RGBG"), "BGGR")
        self.assertEqual(pattern_name(np.array([[1, 0], [2, 3]]), b"RGBG"), "GRBG")


class FromRecipes(unittest.TestCase):
    def test_only_clean_rated_raw_files_that_exist_are_picked(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            here = folder / "a.NEF"
            here.write_bytes(b"x")
            rows = [
                {"file": str(here), "extension": "nef", "iso": 200, "rating": 3, "camera": "NIKON Z fc"},
                {"file": str(here), "extension": "nef", "iso": 3200, "rating": 3, "camera": "NIKON Z fc"},  # too noisy
                {"file": str(here), "extension": "jpg", "iso": 100, "rating": 3, "camera": "NIKON Z fc"},  # not RAW
                {"file": str(here), "extension": "nef", "iso": 100, "rating": None, "camera": "NIKON Z fc"},  # unrated
                {"file": str(folder / "gone.NEF"), "extension": "nef", "iso": 100, "rating": 5, "camera": "Z 8"},  # missing
                {"file": str(here), "extension": "nef", "iso": None, "rating": 5, "camera": "Z 8"},  # ISO unknown
            ]
            recipes = folder / "recipes.jsonl"
            recipes.write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")
            picked = from_recipes(recipes, max_iso=400, min_rating=1)
            self.assertEqual([(p, f["source_iso"]) for p, f in picked], [(here, 200)])
            self.assertEqual(len(from_recipes(recipes, max_iso=400, min_rating=0)), 2)


if __name__ == "__main__":
    unittest.main()
