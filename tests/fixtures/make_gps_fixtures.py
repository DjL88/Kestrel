"""Write the two synthetic GPS photos used by tests/v2-species-place.spec.ts (no real photo; drawn shapes only).

    python tests/fixtures/make_gps_fixtures.py
"""
from fractions import Fraction
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent


def dms(value):
    value = abs(value)
    degrees = int(value); minutes = int((value - degrees) * 60); seconds = round(((value - degrees) * 60 - minutes) * 60, 2)
    return (Fraction(degrees), Fraction(minutes), Fraction(seconds).limit_denominator(100))


for name, lat, lon in [('gps-london.jpg', 51.5007, -0.1246), ('gps-caracas.jpg', 10.4806, -66.9036)]:
    image = Image.new('RGB', (800, 500), (59, 85, 107))
    ImageDraw.Draw(image).ellipse((430, 90, 690, 410), fill=(192, 57, 43))
    exif = Image.Exif()
    exif[0x010F] = 'Synthetic'
    exif[0x0110] = 'Test camera'
    gps = exif.get_ifd(0x8825)
    gps.update({1: 'N' if lat >= 0 else 'S', 2: dms(lat), 3: 'E' if lon >= 0 else 'W', 4: dms(lon)})
    image.save(HERE / name, 'JPEG', quality=85, exif=exif)
    print(name)
