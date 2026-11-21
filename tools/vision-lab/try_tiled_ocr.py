"""Tiling versus zooming for small text: read a large frame in overlapping native-resolution tiles."""
import glob, re, time
from PIL import Image, ImageDraw, ImageFont
from florence_onnx import Florence

flo = Florence('/home/user/kestrel-models/florence-2-base/d59e079711c5', 'int8')
TILE, STEP = 768, 640          # 128 px overlap so text on a seam is whole in one tile

def tiles(image):
    for top in range(0, max(1, image.height - TILE + STEP), STEP):
        for left in range(0, max(1, image.width - TILE + STEP), STEP):
            box = (min(left, max(0, image.width - TILE)), min(top, max(0, image.height - TILE)))
            yield box, image.crop((box[0], box[1], box[0] + TILE, box[1] + TILE))

def read_tiled(image):
    found, started, n = [], time.perf_counter(), 0
    for box, tile in tiles(image):
        n += 1
        text = flo.run(tile, '<OCR>', max_new_tokens=24)['raw'].strip()
        if text:
            found.append((box, text))
    return found, n, time.perf_counter() - started

font = glob.glob('/usr/**/DejaVuSans-Bold.ttf', recursive=True)[0]
for label, text, size in (('UK registration', 'G-OKES', 34), ('US tail number', 'N738PA', 34), ('bird ring', 'EB 74918', 26), ('nothing at all', '', 30)):
    frame = Image.new('RGB', (4000, 2667), (120, 160, 210))
    d = ImageDraw.Draw(frame)
    d.polygon([(1500, 1300), (2500, 1280), (2600, 1330), (1500, 1360)], fill=(235, 235, 235))
    if text:
        d.text((1620, 1305), text, font=ImageFont.truetype(font, size), fill=(20, 20, 20))
    found, n, secs = read_tiled(frame)
    print(f'{label:16} truth={text!r:12} {n} tiles, {secs:.0f}s, {len(found)} tiles returned text:')
    for box, t in found:
        print('      ', box, repr(t))
