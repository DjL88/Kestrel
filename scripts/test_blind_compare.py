"""Synthetic images only: checks blinding, bookkeeping and scoring, not real image quality."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from blind_compare import crop_metrics, make, score


class BlindCompareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        rng = np.random.default_rng(3)
        base = np.tile(np.linspace(0, 255, 128, dtype=np.float32), (96, 1))
        for name, noise in (('smooth', 0), ('noisy', 40)):
            pixels = np.clip(base + rng.normal(0, noise, base.shape), 0, 255).astype(np.uint8)
            Image.fromarray(np.stack([pixels] * 3, axis=2)).save(self.root / f'{name}.png')
        # Same shape, twice the size: cropped at the same place and shown at the same size.
        Image.open(self.root / 'smooth.png').resize((256, 192)).save(self.root / 'big.png')
        self.shoot = self.root / 'shoot.json'
        self.shoot.write_text(json.dumps({'frames': [{'id': 'f1', 'outputs': {'InFlight': 'smooth.png', 'Other': 'noisy.png', 'Big': 'big.png'},
                                                      'regions': {'background': [10, 10, 64, 48], 'eye': [40, 30, 32, 32]}}]}))

    def tearDown(self):
        self.temp.cleanup()

    def test_page_is_blind_and_key_unblinds(self):
        out = self.root / 'out'
        key = make(self.shoot, out, seed=1)
        page = (out / 'judge.html').read_text()
        for word in ('InFlight', 'Other', 'Big', 'smooth', 'noisy', 'key.json'):
            self.assertNotIn(word, page)
        self.assertEqual(len(key['rows']), 2)
        for row in key['rows'].values():
            self.assertEqual(sorted(row['letters'].values()), ['Big', 'InFlight', 'Other'])
            sizes = {Image.open(out / 'crops' / p).size for p in [f.name for f in (out / 'crops').iterdir()]}
            self.assertEqual(len(sizes), 2, 'every crop of a row has the same size')
        background = next(r for r in key['rows'].values() if r['region'] == 'background')
        self.assertLess(background['metrics']['InFlight']['noise'], background['metrics']['Other']['noise'])

    def test_scores_picks_as_made(self):
        key = make(self.shoot, self.root / 'out', seed=2)
        picks = {}
        for row_id, row in key['rows'].items():
            by_editor = {e: l for l, e in row['letters'].items()}
            picks[row_id] = {'best': by_editor['InFlight'], 'worst': by_editor['Other']}
        result = score(key, picks)
        self.assertEqual(result['editors']['InFlight']['best'], 2)
        self.assertEqual(result['editors']['Other']['worst'], 2)
        self.assertEqual(result['judged'], 2)
        result = score(key, {})
        self.assertEqual(result['skipped'], 2)
        row_id = next(iter(key['rows']))
        with self.assertRaises(ValueError):
            score(key, {row_id: {'best': 'A', 'worst': 'A'}})

    def test_refuses_bad_shoots(self):
        self.shoot.write_text(json.dumps({'frames': [{'id': 'f1', 'outputs': {'A': 'smooth.png'}, 'regions': {'eye': [0, 0, 32, 32]}}]}))
        with self.assertRaises(ValueError):
            make(self.shoot, self.root / 'out')
        self.shoot.write_text(json.dumps({'frames': [{'id': 'f1', 'outputs': {'A': 'smooth.png', 'B': 'missing.png'}, 'regions': {'eye': [0, 0, 32, 32]}}]}))
        with self.assertRaises(ValueError):
            make(self.shoot, self.root / 'out')

    def test_metrics_see_noise(self):
        flat = np.full((32, 32, 3), 0.5, np.float32)
        noisy = np.clip(flat + np.random.default_rng(1).normal(0, 0.05, flat.shape), 0, 1).astype(np.float32)
        self.assertEqual(crop_metrics(flat)['noise'], 0)
        self.assertGreater(crop_metrics(noisy)['noise'], 0.01)


if __name__ == '__main__':
    unittest.main()
