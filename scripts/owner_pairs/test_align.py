import os, sys, unittest
sys.path.insert(0, os.path.dirname(__file__))
try:
    import numpy as np
    import scipy  # noqa: F401  (align.py needs scipy; CI installs only numpy and pillow)
    from PIL import Image, ImageFilter
    import align
    HAVE = True
except ImportError:
    HAVE = False

def scene():
    import numpy as np
    from PIL import Image, ImageFilter
    rng = np.random.default_rng(3)
    a = rng.random((60, 90)) * 255
    im = Image.fromarray(a.astype('uint8')).resize((900, 600), Image.BICUBIC).filter(ImageFilter.GaussianBlur(3))
    return im.convert('RGB')

@unittest.skipUnless(HAVE, 'numpy, scipy and pillow are needed for crop alignment')
class T(unittest.TestCase):
    def test_finds_crop_and_ignores_tone(self):
        raw = scene()
        box = (300, 120, 700, 387)  # 400x267 crop
        fin = raw.crop(box).resize((300, 200))
        fin = Image.eval(fin, lambda v: min(255, int(v * 0.6 + 40)))  # different tone
        r = align.best_crop(raw, fin)
        self.assertGreater(r['ncc'], 0.9)
        self.assertAlmostEqual(r['box'][0], 300 / 900, delta=0.03)
        self.assertAlmostEqual(r['box'][1], 120 / 600, delta=0.04)
        self.assertAlmostEqual(r['box'][2] - r['box'][0], 400 / 900, delta=0.03)

    def test_full_frame(self):
        raw = scene()
        r = align.best_crop(raw, raw.resize((450, 300)))
        self.assertGreater(r['ncc'], 0.95)
        self.assertGreater(r['box'][2] - r['box'][0], 0.95)

if __name__ == '__main__':
    unittest.main()
