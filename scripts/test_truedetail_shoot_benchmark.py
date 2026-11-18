"""Synthetic fixtures: tests safety/bookkeeping, not true Nikon image quality."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from truedetail_shoot_benchmark import load_manifest


class ShootManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        for name in ('photo.NEF', 'reference.tif', 'kestrel.tif', 'dxo.tif'):
            (self.folder / name).write_bytes(name.encode())
        self.record = dict(id='bird-001', body='Z8', firmware='2.00', compression='HE*',
                           subject='birds', iso=6400, original='photo.NEF', reference='reference.tif',
                           variants={'kestrel':'kestrel.tif','dxo':'dxo.tif'},
                           regions={'eye':'1,1,8,8','feathers':'0,0,10,10','sky':'3,3,5,5'})

    def manifest(self, cases):
        path = self.folder / 'shoot.json'
        path.write_text(json.dumps({'format':'kestrel-truedetail-shoot-v1','cases':cases}),encoding='utf-8')
        return path

    def test_valid_multi_editor_case_and_all_five_subject_labels(self):
        cases = []
        for i, subject in enumerate(('birds','aircraft','people','mammals','landscapes')):
            cases.append(dict(self.record,id=f'subject-{i}',subject=subject))
        result = load_manifest(self.manifest(cases))
        self.assertEqual(len(result),5)
        self.assertEqual(list(result[0]['variants']),['kestrel','dxo'])
        self.assertEqual(result[0]['regions'][0],('eye','1,1,8,8'))

    def test_rejects_duplicate_case_ids_and_missing_files(self):
        with self.assertRaisesRegex(ValueError,'Duplicate case'):
            load_manifest(self.manifest([self.record,self.record]))
        with self.assertRaisesRegex(ValueError,'does not exist'):
            load_manifest(self.manifest([dict(self.record,original='missing.NEF')]))

    def test_rejects_alias_and_hardlink_of_original(self):
        alias = self.folder / 'same.tif'
        os.link(self.folder / 'photo.NEF', alias)  # works on every Python; Path.hardlink_to needs 3.10
        with self.assertRaisesRegex(ValueError,'separate files'):
            load_manifest(self.manifest([dict(self.record, variants={'bad':'same.tif'})]))

    def test_rejects_untrustworthy_provenance(self):
        for change in ({'iso':None},{'iso':True},{'compression':'unverified'},
                       {'subject':'dragon'},{'regions':{}},{'variants':{}},{'firmware':''}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                load_manifest(self.manifest([dict(self.record,**change)]))

    def test_never_modifies_inputs(self):
        before = {p.name:p.read_bytes() for p in self.folder.iterdir() if p.is_file()}
        load_manifest(self.manifest([self.record]))
        for name, value in before.items():
            self.assertEqual((self.folder/name).read_bytes(),value)


class SyntheticTiffIntegrationTests(unittest.TestCase):
    def test_complete_shoot_benchmark_uses_real_tiff_metrics_without_writes(self):
        try:
            import benchmark_nikon_detail  # noqa: F401
            import compare_nikon_tiffs  # noqa: F401
            import numpy as np
            import tifffile
        except ImportError:
            self.skipTest('Existing repository TIFF modules are not in this local test environment')
        from truedetail_shoot_benchmark import run_shoot
        import hashlib
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            source = folder / 'synthetic-only.NEF'
            source.write_bytes(b'not a real Nikon RAW')
            ref = folder / 'reference.tif'
            candidate = folder / 'candidate.tif'
            pixels = np.full((12, 14, 3), 20000, dtype=np.uint16)
            profile = b'synthetic-icc'
            tags = [(34675, 'B', len(profile), profile, False)]
            tifffile.imwrite(ref, pixels, photometric='rgb', extratags=tags)
            changed = pixels.copy()
            changed[5, 6, 1] += 200
            tifffile.imwrite(candidate, changed, photometric='rgb', extratags=tags)
            manifest = folder / 'shoot.json'
            manifest.write_text(json.dumps({'format':'kestrel-truedetail-shoot-v1','cases':[
                dict(id='sample', body='Z8', firmware='test-only', compression='lossless',
                     subject='birds', iso=6400, original='synthetic-only.NEF',
                     reference='reference.tif', variants={'kestrel':'candidate.tif'},
                     regions={'eye':'4,4,5,5','background':'0,0,3,3'})
            ]}), encoding='utf-8')
            before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (source,ref,candidate)}
            report = run_shoot(manifest)
            self.assertEqual(report['case_count'], 1)
            item = report['cases'][0]['variants']['kestrel']
            self.assertEqual(item['full_image']['changed_pixels'], 1)
            self.assertEqual(len(item['regions']), 2)
            self.assertNotIn(str(folder), json.dumps(report), 'local paths must not leak into report')
            self.assertEqual(before, {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (source,ref,candidate)})


if __name__ == '__main__':
    unittest.main()
