"""Make tests/fixtures/synthetic-heic.heic: a small, wholly synthetic HEIC photo for the HEIC import tests.

Nothing in it comes from a camera or a real photograph. The picture is 96 x 64 pixels, red on the left half and blue on
the right, with a green square in the top-left corner so a test can tell whether it was turned or flipped. The EXIF says
it was taken on 1 June 2026 at 09:30:00 with a made-up "Kite44 Test" camera.

Needs Pillow and pillow-heif (pip install pillow==11.3.0 pillow-heif==1.1.1); they are only used to write this file
and are not part of the app. Run from the repository root:

    python tests/fixtures/make_heic_fixture.py
"""
from pathlib import Path

from PIL import Image
import pillow_heif

WIDTH, HEIGHT = 96, 64
OUT = Path(__file__).with_name("synthetic-heic.heic")


def picture() -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), (220, 30, 30))
    image.paste((30, 60, 220), (WIDTH // 2, 0, WIDTH, HEIGHT))
    image.paste((30, 200, 60), (0, 0, 16, 16))
    return image


def exif() -> bytes:
    data = Image.Exif()
    data[0x010F] = "Kite44"  # Make
    data[0x0110] = "Kite44 Test"  # Model
    ifd = data.get_ifd(0x8769)
    ifd[0x9003] = "2026:06:01 09:30:00"  # DateTimeOriginal
    ifd[0x829A] = (1, 250)  # ExposureTime
    ifd[0x8827] = 200  # ISO
    return data.tobytes()


def main() -> None:
    pillow_heif.register_heif_opener()
    picture().save(OUT, format="HEIF", quality=90, exif=exif())
    print(f"{OUT}: {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
