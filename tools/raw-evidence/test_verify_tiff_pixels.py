"""Synthetic TIFF fixtures; no private RAW files."""
import struct
import tempfile
import unittest
from pathlib import Path
from verify_tiff_pixels import verify, TiffError

def fixture(bits=16, icc=True, flat=False, truncate=False, width=2):
    profile = bytearray(128)
    profile[:4] = (128).to_bytes(4, 'big')
    profile[36:40] = b'acsp'
    pixel = struct.pack('<' + 'H' * (width * 3),
                        *([100] * (width * 3) if flat else list(range(1, width * 3 + 1))))
    if truncate: pixel = pixel[:-2]
    tags = [(256,4,[width]), (257,4,[1]), (258,3,[bits]*3),
            (259,3,[1]), (262,3,[2]), (273,4,[0]),
            (277,3,[3]), (278,4,[1]), (279,4,[width*6]), (284,3,[1])]
    if icc: tags.append((34675,7,bytes(profile)))
    tags.sort()
    cursor = 8 + 2 + 12 * len(tags) + 4
    entries, extra = bytearray(), bytearray()
    for tag, typ, values in tags:
        if tag == 273: values = [cursor + (128 if icc else 0)]
        raw = (struct.pack('<' + ('H' if typ == 3 else 'I') * len(values), *values)
               if typ in (3,4) else values)
        val = raw.ljust(4,bytes(1)) if len(raw) <= 4 else struct.pack('<I',cursor)
        if len(raw) > 4:
            extra.extend(raw)
            cursor += len(raw)
        entries.extend(struct.pack('<HHI',tag,typ,len(values)) + val)
    return b'II' + struct.pack('<HIH',42,8,len(tags)) + entries + struct.pack('<I',0) + extra + pixel

class TestGate(unittest.TestCase):
    def check(self, payload):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'test.tif'
            p.write_bytes(payload)
            return verify(p)

    def test_valid_pixels_and_icc(self):
        self.assertEqual(self.check(fixture())['bits_per_sample'],16)

    def test_reject_8_bit_label(self):
        with self.assertRaisesRegex(TiffError,'16-bit'): self.check(fixture(bits=8))

    def test_reject_missing_icc(self):
        with self.assertRaisesRegex(TiffError,'ICC'): self.check(fixture(icc=False))

    def test_reject_truncated_pixels(self):
        with self.assertRaisesRegex(TiffError,'strip'): self.check(fixture(truncate=True))

    def test_reject_flat_pixels(self):
        with self.assertRaisesRegex(TiffError,'flat'): self.check(fixture(flat=True))

    def test_reject_bad_dimensions(self):
        with self.assertRaisesRegex(TiffError,'invalid dimensions'): self.check(fixture(width=0))

if __name__ == '__main__':
    unittest.main()
