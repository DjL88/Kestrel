"""Synthetic metadata fixtures only: no photographs, SDK, or network."""
import struct
import unittest
from check_rgb16_tiff_metadata import inspect, InvalidTiff


def fixture(icc=False, bits=(16, 16, 16)):
    entries = [(256, 4, 1, 3), (257, 4, 1, 2), (258, 3, 3, 86),
               (262, 3, 1, 2), (277, 3, 1, 3)]
    if icc:
        entries.append((34675, 7, 8, 92))
    data = bytearray(b"II" + struct.pack("<HIH", 42, 8, len(entries)))
    for tag, typ, count, value in entries:
        data += struct.pack("<HHII", tag, typ, count, value)
    data += b"\x00" * max(0, 86 - len(data))
    data += struct.pack("<HHH", *bits)
    data += b"\x00" * max(0, 92 - len(data))
    if icc:
        data += b"fakeICC!"
    return bytes(data)


class MetadataTests(unittest.TestCase):
    def test_rgb16_without_icc_is_unprofiled(self):
        result = inspect(fixture())
        self.assertTrue(result["rgb16_metadata"])
        self.assertFalse(result["profile_embedded"])

    def test_profile_tag_is_reported(self):
        self.assertEqual(inspect(fixture(icc=True))["icc_profile_bytes"], 8)

    def test_eight_bit_is_not_rgb16(self):
        self.assertFalse(inspect(fixture(bits=(8, 8, 8)))["rgb16_metadata"])

    def test_truncated_profile_is_rejected(self):
        with self.assertRaises(InvalidTiff):
            inspect(fixture(icc=True)[:-2])

    def test_invalid_ifd_is_rejected(self):
        with self.assertRaises(InvalidTiff):
            inspect(b"II*\x00\xff\xff\xff\xff")


if __name__ == "__main__":
    unittest.main()
