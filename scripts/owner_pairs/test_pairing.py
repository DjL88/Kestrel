import os, sys, unittest
sys.path.insert(0, os.path.dirname(__file__))
import pairing as P

def raw(t, sub='10', model='Z8', iso=800, et=0.001, f=5.6, h='a', **kw):
    return dict(kind='raw', ext='nef', DateTimeOriginal=t, SubSecTimeOriginal=sub, Model=model, ISO=iso,
                ExposureTime=et, FNumber=f, hash=h, path=h, ImageWidth=8256, ImageHeight=5504, **kw)

def img(t, sub='10', model='Z8', iso=800, et=0.001, f=5.6, sw='Adobe Photoshop 27', **kw):
    return dict(kind='img', ext='jpg', DateTimeOriginal=t, SubSecTimeOriginal=sub, Model=model, ISO=iso,
                ExposureTime=et, FNumber=f, Software=sw, path='x' + t, hash='j' + t, **kw)

class T(unittest.TestCase):
    def test_confident(self):
        p, _ = P.pair([raw('2026:07:01 08:08:39'), img('2026:07:01 08:08:39')])
        self.assertEqual([x['status'] for x in p], ['confident'])

    def test_name_independent_and_other_body_rejected(self):
        p, _ = P.pair([raw('2026:07:01 08:08:39'), img('2026:07:01 08:08:39', model='Z5')])
        self.assertEqual(p, [])

    def test_settings_mismatch(self):
        p, _ = P.pair([raw('2026:07:01 08:08:39'), img('2026:07:01 08:08:39', iso=1600)])
        self.assertEqual(p, [])

    def test_burst_is_uncertain(self):
        p, _ = P.pair([raw('2026:07:01 08:08:39', h='a'), raw('2026:07:01 08:08:39', h='b'), img('2026:07:01 08:08:39')])
        self.assertEqual(p[0]['status'], 'uncertain')

    def test_subsecond_separates_burst(self):
        p, _ = P.pair([raw('2026:07:01 08:08:39', '10', h='a'), raw('2026:07:01 08:08:39', '30', h='b'), img('2026:07:01 08:08:39', '30')])
        self.assertEqual(p[0]['raw']['hash'], 'b')
        self.assertEqual(p[0]['status'], 'confident')

    def test_duplicate_copies_of_one_raw(self):
        p, s = P.pair([raw('2026:07:01 08:08:39', h='a'), raw('2026:07:01 08:08:39', h='a'), img('2026:07:01 08:08:39')])
        self.assertEqual(s['raws'], 1); self.assertEqual(p[0]['status'], 'confident')

    def test_classify(self):
        self.assertEqual(P.classify_image({'Software': 'Z 8 Ver.03.00'}), 'camera')
        self.assertEqual(P.classify_image({'CreatorTool': 'Adobe Photoshop Lightroom Classic 15'}), 'edited')
        self.assertEqual(P.classify_image({'Software': 'Kestrel 1.0'}), 'app-export')
        self.assertEqual(P.classify_image({}), 'camera')

    def test_crop_hint(self):
        r = {'ImageWidth': 6000, 'ImageHeight': 4000}
        self.assertEqual(P.crop_hint(r, {'ImageWidth': 1920, 'ImageHeight': 1280}), 'resized')
        self.assertEqual(P.crop_hint(r, {'ImageWidth': 4000, 'ImageHeight': 4000}), 'cropped')
        self.assertEqual(P.crop_hint(r, {'ImageWidth': 4000, 'ImageHeight': 6000}), 'rotated')

if __name__ == '__main__':
    unittest.main()
