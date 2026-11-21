"""Two-pass text reading, with the real Florence-2: read once, then zoom on just that text and read again.

Pass 1 reads a crop of the subject (in the editor, the detector's box) and returns each text with its region.
Pass 2 crops that region with padding, enlarges it and reads it again, so a small registration or ring is seen at a size
the model can actually read. This script only gathers the two readings; deciding what to trust is src/core/textReading.ts.
"""
import json, sys
from PIL import Image
from florence_onnx import Florence

TILE = 768
PAD = 0.25            # keep a margin around the text so letters at the edge are not cut
MIN_TARGET = 256      # enlarge so the text region is at least this wide, but never past the model's input size

def zoom_crop(image: Image.Image, box: list[float]) -> tuple[Image.Image, list[int]]:
    x1, y1, x2, y2 = box
    w, h = max(1.0, x2 - x1), max(1.0, y2 - y1)
    left, top = max(0, int(x1 - w * PAD)), max(0, int(y1 - h * PAD))
    right, bottom = min(image.width, int(x2 + w * PAD)), min(image.height, int(y2 + h * PAD))
    crop = image.crop((left, top, right, bottom))
    scale = max(1.0, MIN_TARGET / crop.width)
    scale = min(scale, TILE / max(crop.width, crop.height))
    if scale > 1.0:
        crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
    return crop, [left, top, right, bottom]

def read_two_pass(model: Florence, image: Image.Image, subject_box: list[int]) -> list[dict]:
    """Returns one record per text found in the subject: pass1 text, region, and the zoomed pass2 text."""
    subject = image.crop(tuple(subject_box))
    # Pass 1 sees a downscaled view of the subject crop (the model input is 768 px), so very small text may be missed
    # here. The zoom crops below are what make small text readable.
    first = model.run(subject, '<OCR_WITH_REGION>', max_new_tokens=60)
    out = []
    for region in Florence.parse_text_regions(first['raw'], subject.size):
        box = [region['box'][0] + subject_box[0], region['box'][1] + subject_box[1],
               region['box'][2] + subject_box[0], region['box'][3] + subject_box[1]]
        crop, crop_box = zoom_crop(image, box)
        second = model.run(crop, '<OCR>', max_new_tokens=24)['raw'].strip()
        out.append({'pass1': region['text'], 'region': [round(v) for v in box], 'zoomCrop': crop_box, 'pass2': second})
    return out

if __name__ == '__main__':
    import glob
    from PIL import ImageDraw, ImageFont
    model = Florence('/home/user/kestrel-models/florence-2-base/d59e079711c5', 'int8')
    font = glob.glob('/usr/**/DejaVuSans-Bold.ttf', recursive=True)[0]
    cases = []
    for label, text, size in (('UK registration', 'G-OKES', 34), ('US tail number', 'N738PA', 34), ('bird ring', 'EB 74918', 26), ('blank sky', '', 30)):
        frame = Image.new('RGB', (4000, 2667), (120, 160, 210))
        d = ImageDraw.Draw(frame)
        d.polygon([(1500, 1300), (2500, 1280), (2600, 1330), (1500, 1360)], fill=(235, 235, 235))
        if text:
            d.text((1620, 1305), text, font=ImageFont.truetype(font, size), fill=(20, 20, 20))
        readings = read_two_pass(model, frame, [1400, 1180, 2700, 1480])
        cases.append({'label': label, 'truth': text, 'readings': readings})
        print(f'{label:16} truth={text!r:12}', [(r['pass1'], r['pass2']) for r in readings])
    json.dump({'source': 'ocr_two_pass.py, Florence-2-base int8, synthetic 4000x2667 frames', 'cases': cases},
              open('fixtures/two-pass-real.json', 'w'), indent=2)
