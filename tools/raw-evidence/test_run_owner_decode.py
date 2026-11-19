import hashlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from importlib.util import spec_from_file_location, module_from_spec

spec = spec_from_file_location('run_owner_decode', Path(__file__).with_name('run_owner_decode.py'))
mod = module_from_spec(spec)
spec.loader.exec_module(mod)

class OwnerDecodeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.tauri = self.root / 'src-tauri'
        self.tauri.mkdir()
        (self.tauri / 'Cargo.toml').write_text('[package]\nname="fixture"\n')
        self.samples = self.root / 'samples'
        self.samples.mkdir()
        (self.samples / 'a.nef').write_bytes(b'synthetic only')
    def runner(self, stdout, returncode=0):
        return lambda *a, **kw: SimpleNamespace(stdout=stdout, stderr='', returncode=returncode)
    def test_malformed_decoder_row_fails_closed(self):
        output = ('a.nef | nikon-he | invalidx8 | 1ms\n'
                  'a.nef | nikon-he | 8x8 | 1ms\n'
                  'High Efficiency files decoded from sensor data: 1')
        with self.assertRaisesRegex(ValueError, 'malformed'):
            mod.parse_output(output)
    def test_malformed_count_line_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'malformed'):
            mod.parse_output('High Efficiency files decoded from sensor data: unknown')
    def test_missing_cfa_hash_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'CFA hash'):
            mod.collect(self.samples, self.tauri, self.runner('a.nef | nikon-he | 8x8 | 1ms\nHigh Efficiency files decoded from sensor data: 1'))
    def test_duplicate_cfa_hash_fails_closed(self):
        digest = 'a' * 64
        output = f'a.nef | nikon-he | 8x8 | 1ms\ncfa-sha256 | a.nef | {digest}\ncfa-sha256 | a.nef | {digest}\nHigh Efficiency files decoded from sensor data: 1'
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            mod.collect(self.samples, self.tauri, self.runner(output))
    def test_mismatched_cfa_name_fails_closed(self):
        output = f'a.nef | nikon-he | 8x8 | 1ms\ncfa-sha256 | b.nef | {"a" * 64}\nHigh Efficiency files decoded from sensor data: 1'
        with self.assertRaisesRegex(ValueError, 'CFA hash'):
            mod.collect(self.samples, self.tauri, self.runner(output))
    def test_native_success_is_only_limited_evidence(self):
        evidence = mod.collect(self.samples, self.tauri, self.runner('a.nef | nikon-he | 8x8 | 1ms\ncfa-sha256 | a.nef | ' + 'a'*64 + '\nHigh Efficiency files decoded from sensor data: 1'))
        row = evidence['samples'][0]
        self.assertEqual(row['sha256'], hashlib.sha256(b'synthetic only').hexdigest())
        self.assertEqual(row['cfa_hash'], 'a'*64)
        self.assertEqual(row['nx_studio_parity'], 'NOT RUN')
    def test_unreported_nef_is_visible_not_verified(self):
        (self.samples / 'b.NEF').write_bytes(b'synthetic not independently classified')
        output = 'a.nef | nikon-he | 8x8 | 1ms\ncfa-sha256 | a.nef | ' + 'a'*64 + '\nHigh Efficiency files decoded from sensor data: 1'
        evidence = mod.collect(self.samples, self.tauri, self.runner(output))
        self.assertEqual(evidence['inventory']['top_level_nef_count'], 2)
        self.assertEqual(evidence['inventory']['unreported_files'], ['b.NEF'])
        self.assertEqual(evidence['inventory']['coverage'], 'NOT VERIFIED')
    def test_case_insensitive_inventory_collision_fails_closed(self):
        (self.samples / 'A.NEF').write_bytes(b'synthetic ambiguous alias')
        output = 'a.nef | nikon-he | 8x8 | 1ms\\ncfa-sha256 | a.nef | ' + 'a'*64 + '\\nHigh Efficiency files decoded from sensor data: 1'
        with self.assertRaisesRegex(ValueError, 'ambiguous case-insensitive'):
            mod.collect(self.samples, self.tauri, self.runner(output))
    def test_unreported_symlink_fails_closed(self):
        (self.samples / 'b.nef').symlink_to(self.samples / 'a.nef')
        output = 'a.nef | nikon-he | 8x8 | 1ms\ncfa-sha256 | a.nef | ' + 'a'*64 + '\nHigh Efficiency files decoded from sensor data: 1'
        with self.assertRaisesRegex(ValueError, 'inventory'):
            mod.collect(self.samples, self.tauri, self.runner(output))
    def test_zero_files_not_pass(self):
        with self.assertRaises(ValueError): mod.parse_output('High Efficiency files decoded from sensor data: 0')
    def test_missing_count_not_pass(self):
        with self.assertRaises(ValueError): mod.parse_output('a.nef | nikon-he | 8x8 | 1ms')
    def test_count_mismatch_not_pass(self):
        with self.assertRaises(ValueError): mod.parse_output('a.nef | nikon-he | 8x8 | 1ms\nHigh Efficiency files decoded from sensor data: 2')
    def test_nonzero_cargo_not_pass(self):
        with self.assertRaises(ValueError): mod.collect(self.samples, self.tauri, self.runner('High Efficiency files decoded from sensor data: 1', 101))
    def test_duplicate_name_not_pass(self):
        with self.assertRaises(ValueError): mod.parse_output('a.nef | nikon-he | 8x8 | 1ms\na.nef | nikon-he-star | 8x8 | 1ms\nHigh Efficiency files decoded from sensor data: 2')
    def test_symlink_not_pass(self):
        (self.samples / 'a.nef').unlink()
        (self.samples / 'actual').write_bytes(b'synthetic')
        (self.samples / 'a.nef').symlink_to(self.samples / 'actual')
        with self.assertRaises(ValueError): mod.collect(self.samples, self.tauri, self.runner('a.nef | nikon-he | 8x8 | 1ms\nHigh Efficiency files decoded from sensor data: 1'))

    def test_path_spoofing_not_counted(self):
        for name in ('../a.nef', '/private/a.nef', r'C:\\private\\a.nef'):
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    mod.parse_output(f'{name} | nikon-he | 8x8 | 1ms\nHigh Efficiency files decoded from sensor data: 1')
    def test_arbitrary_duration_not_counted(self):
        with self.assertRaises(ValueError):
            mod.parse_output('a.nef | nikon-he | 8x8 | unmeasured\nHigh Efficiency files decoded from sensor data: 1')
    def test_numeric_duration_is_recorded(self):
        rows = mod.parse_output('a.nef | nikon-he-star | 8x8 | 2.5ms\nHigh Efficiency files decoded from sensor data: 1')
        self.assertEqual(rows[0][-1], '2.5ms')

if __name__ == '__main__': unittest.main()
