import hashlib
import tempfile
import unittest
from pathlib import Path
from importlib.util import spec_from_file_location, module_from_spec

spec = spec_from_file_location("validator", Path(__file__).with_name("validate_manifest.py"))
module = module_from_spec(spec)
spec.loader.exec_module(module)

class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "synthetic.nef").write_bytes(b"synthetic fixture, NOT Nikon sensor data")
        self.sample = dict(camera="Nikon Z8", mode="he", source="embedded-preview",
            width=8, height=8, bit_depth=8, file="synthetic.nef",
            sha256=hashlib.sha256((self.root / "synthetic.nef").read_bytes()).hexdigest())
    def check(self, **changes):
        return module.validate({"samples": [dict(self.sample, **changes)]}, self.root)
    def test_structural_fixture(self):
        self.assertEqual(self.check(), [])
    def test_corruption(self):
        self.assertTrue(any("mismatch" in e for e in self.check(sha256="0"*64)))
    def test_path_traversal(self):
        self.assertTrue(any("unsafe" in e for e in self.check(file="../secret.nef")))
    def test_false_sensor_claim(self):
        self.assertTrue(any("preview/render" in e for e in self.check(sensor_decode_verified=True, decoder="x", reference_evidence="y")))
    def test_unqualified_parity(self):
        self.assertTrue(any("parity" in e for e in self.check(nx_studio_parity=True)))
    def test_invalid_dimensions(self):
        self.assertTrue(any("width" in e for e in self.check(width=0)))
    def test_unknown_mode(self):
        self.assertTrue(any("mode" in e for e in self.check(mode="he-plus")))
    def test_verified_requires_reference(self):
        self.assertTrue(any("reference evidence" in e for e in self.check(source="sensor-cfa", sensor_decode_verified=True, decoder="experimental")))
if __name__ == "__main__":
    unittest.main()
