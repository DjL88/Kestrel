"""Can SmolVLM2 (already in the editor) read a registration or ring from a zoomed crop, so no second model is needed?

Same synthetic frames and the same nine crops (three paddings x three zoom sizes) used to test Florence-2. Clean, flat,
synthetic text only: it shows the idea works, not that real photos (blur, angle, glare) will.
"""
import glob
from collections import Counter
from PIL import Image, ImageDraw, ImageFont
from smolvlm_onnx import SmolVLM

smol = SmolVLM('/home/user/kestrel-models/smolvlm2-500m/4cde9d208e19', 'int8')
font = glob.glob('/usr/**/DejaVuSans-Bold.ttf', recursive=True)[0]
QUESTION = 'Read the text exactly as written. Answer with the text only.'

def frame(text, size):
    f = Image.new('RGB', (4000, 2667), (120, 160, 210))
    d = ImageDraw.Draw(f)
    d.polygon([(1500, 1300), (2500, 1280), (2600, 1330), (1500, 1360)], fill=(235, 235, 235))
    d.text((1620, 1305), text, font=ImageFont.truetype(font, size), fill=(20, 20, 20))
    return f

for text, size, width in (('N738PA', 34, 150), ('EB 74918', 26, 150), ('G-OKES', 34, 130)):
    f = frame(text, size)
    box = (1620, 1305, 1620 + width, 1305 + size + 12)
    reads = []
    for pad in (0.15, 0.25, 0.4):
        for target in (200, 300, 420):
            w, h = box[2] - box[0], box[3] - box[1]
            crop = f.crop((int(box[0] - w * pad), int(box[1] - h * pad), int(box[2] + w * pad), int(box[3] + h * pad)))
            scale = target / crop.width
            crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
            reads.append(smol.ask(crop, QUESTION, 16)['text'].strip().strip('"\'.'))
    print(f'{text!r:12}', Counter(reads).most_common())
