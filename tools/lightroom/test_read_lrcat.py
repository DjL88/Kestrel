"""Run with:  python3 -m unittest discover -s tools/lightroom -p 'test_*.py'

The catalog here is BUILT BY THE TEST to the layout read_lrcat.py assumes. It proves the parsing and the read-only
behaviour; it does not prove a real Lightroom catalog has this layout.
"""
import hashlib
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from read_lrcat import open_read_only, parse_settings, read_photos, summarise  # noqa: E402

SETTINGS = '''s = {
	ProcessVersion = "15.4",
	Exposure2012 = 0.55,
	Contrast2012 = 12,
	Highlights2012 = -40,
	LuminanceSmoothing = 28,
	ColorNoiseReduction = 25,
	Sharpness = 40,
	CropTop = 0.1,
	HasCrop = true,
	ToneCurvePV2012 = {
		0,
		0,
	},
	MaskGroupBasedCorrections = {
		{
			LocalExposure2012 = 0.3,
		},
	},
}'''


def build(path: Path, with_exif=True):
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE Adobe_images (id_local INTEGER PRIMARY KEY, rootFile INTEGER, rating REAL, captureTime TEXT);
        CREATE TABLE AgLibraryFile (id_local INTEGER PRIMARY KEY, folder INTEGER, baseName TEXT, extension TEXT);
        CREATE TABLE AgLibraryFolder (id_local INTEGER PRIMARY KEY, rootFolder INTEGER, pathFromRoot TEXT);
        CREATE TABLE AgLibraryRootFolder (id_local INTEGER PRIMARY KEY, absolutePath TEXT);
        CREATE TABLE Adobe_imageDevelopSettings (id_local INTEGER PRIMARY KEY, image INTEGER, text TEXT);
        CREATE TABLE AgHarvestedExifMetadata (id_local INTEGER PRIMARY KEY, image INTEGER, isoSpeedRating REAL, cameraModelRef INTEGER);
        CREATE TABLE AgInternedExifCameraModel (id_local INTEGER PRIMARY KEY, value TEXT);
        INSERT INTO AgLibraryRootFolder VALUES (1, 'D:/Photos/');
        INSERT INTO AgLibraryFolder VALUES (1, 1, '2025/birds/');
        INSERT INTO AgLibraryFile VALUES (1, 1, '_DJL0361', 'NEF'), (2, 1, '_DJL0362', 'NEF');
        INSERT INTO Adobe_images VALUES (1, 1, 4, '2025-07-16T03:26:00'), (2, 2, 0, '2025-07-16T03:27:00');
        INSERT INTO AgInternedExifCameraModel VALUES (1, 'NIKON Z 8');
    """)
    db.execute("INSERT INTO Adobe_imageDevelopSettings (image, text) VALUES (1, ?)", (SETTINGS,))
    db.execute("INSERT INTO Adobe_imageDevelopSettings (image, text) VALUES (2, 's = {\n}')")
    if with_exif:
        db.execute("INSERT INTO AgHarvestedExifMetadata (image, isoSpeedRating, cameraModelRef) VALUES (1, 6400, 1), (2, 100, 1)")
    db.commit()
    db.close()


class ReadCatalog(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "test.lrcat"
        build(self.path)

    def tearDown(self):
        self.dir.cleanup()

    def test_develop_settings_are_picked_out_and_nested_blocks_do_not_leak(self):
        got = parse_settings(SETTINGS)
        self.assertEqual(got["Exposure2012"], 0.55)
        self.assertEqual(got["LuminanceSmoothing"], 28.0)
        self.assertEqual(got["ProcessVersion"], "15.4")
        self.assertIs(got["HasCrop"], True)
        self.assertTrue(got["has_masks"])
        self.assertNotIn("LocalExposure2012", got)  # inside a mask: not a whole-photo setting
        self.assertFalse(parse_settings("s = {\n}")["has_masks"])

    def test_real_catalog_layout_with_no_indentation_is_read(self):
        # As Lightroom Classic 14 writes it: no indentation, first key on the opening line, inline nested tables.
        real = ('s = { AutoLateralCA = 1,\nBlacks2012 = -36,\nCameraProfile = "Adobe Standard",\nColorNoiseReduction = 25,\n'
                'ConvertToGrayscale = true,\nExposure2012 = 3.33,\nLensBlur = {  },\nLuminanceSmoothing = 0,\n'
                'MaskGroupBasedCorrections = {\n{\nLocalExposure2012 = 0.3,\nSharpness = 99,\n},\n},\n'
                'Sharpness = 40,\nToneCurveName2012 = "Linear" }')
        got = parse_settings(real)
        self.assertEqual(got["Exposure2012"], 3.33)
        self.assertEqual(got["Blacks2012"], -36.0)
        self.assertEqual(got["ColorNoiseReduction"], 25.0)
        self.assertEqual(got["Sharpness"], 40.0)  # not the 99 inside the mask
        self.assertIs(got["ConvertToGrayscale"], True)
        self.assertTrue(got["has_masks"])

    def test_photos_come_back_with_camera_iso_rating_and_path(self):
        connection = open_read_only(self.path)
        photos = list(read_photos(connection, hide_paths=False))
        connection.close()
        self.assertEqual(len(photos), 2)
        first = next(p for p in photos if p["id"] == 1)
        self.assertEqual(first["file"], "D:/Photos/2025/birds/_DJL0361.NEF")
        self.assertEqual((first["camera"], first["iso"], first["rating"]), ("NIKON Z 8", 6400, 4))
        self.assertTrue(first["edited"])
        self.assertFalse(next(p for p in photos if p["id"] == 2)["edited"])

    def test_paths_can_be_hidden(self):
        connection = open_read_only(self.path)
        photos = list(read_photos(connection, hide_paths=True))
        connection.close()
        self.assertTrue(all("Photos" not in p["file"] and len(p["file"]) == 12 for p in photos))

    def test_the_catalog_cannot_be_written_and_is_left_byte_for_byte_unchanged(self):
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        connection = open_read_only(self.path)
        list(read_photos(connection, hide_paths=False))
        with self.assertRaises(sqlite3.OperationalError):
            connection.execute("DELETE FROM Adobe_images")
        connection.close()
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before)
        self.assertEqual([p.name for p in self.path.parent.iterdir()], ["test.lrcat"], "no journal or temp files left behind")

    def test_a_different_layout_gives_a_clear_message_not_a_crash(self):
        other = Path(self.dir.name) / "other.lrcat"
        db = sqlite3.connect(other)
        db.execute("CREATE TABLE Adobe_images (id_local INTEGER)")
        db.commit()
        db.close()
        connection = open_read_only(other)
        with self.assertRaises(LookupError) as raised:
            list(read_photos(connection, hide_paths=False))
        connection.close()
        self.assertIn("AgLibraryFile", str(raised.exception))

    def test_missing_exif_tables_still_give_the_edits(self):
        bare = Path(self.dir.name) / "bare.lrcat"
        build(bare, with_exif=False)
        db = sqlite3.connect(bare)
        db.executescript("DROP TABLE AgHarvestedExifMetadata;")
        db.commit()
        db.close()
        connection = open_read_only(bare)
        photos = list(read_photos(connection, hide_paths=False))
        connection.close()
        self.assertEqual(len(photos), 2)
        self.assertIsNone(photos[0]["iso"])

    def test_summary_groups_noise_reduction_by_iso_band(self):
        connection = open_read_only(self.path)
        summary = summarise(list(read_photos(connection, hide_paths=True)))
        connection.close()
        self.assertEqual(summary["photos"], 2)
        self.assertEqual(summary["with_edits"], 1)
        self.assertEqual(summary["with_local_masks"], 1)
        self.assertEqual(summary["by_iso_band"]["1601-6400"]["median_luminance_noise_reduction"], 28.0)


if __name__ == "__main__":
    unittest.main()
