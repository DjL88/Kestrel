"""Convert installer artwork PNGs to the 24-bit BMPs NSIS needs (no alpha), beside the originals."""
import sys
from PIL import Image

for path in sys.argv[1:]:
    image = Image.open(path).convert('RGB')
    target = path[:-4] + '.bmp'
    image.save(target, 'BMP')
    print(f'{target}: {image.size[0]} x {image.size[1]}, 24-bit')
