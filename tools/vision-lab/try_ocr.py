"""Can Florence-2 read text in a photo, such as an aircraft registration or a bird's leg ring? And what does it take?"""
import glob
from PIL import Image, ImageDraw, ImageFont
import skimage.data as data
from florence_onnx import Florence

flo = Florence('/home/user/kestrel-models/florence-2-base/d59e079711c5', 'int8')
ocr = lambda im: flo.run(im, '<OCR>', max_new_tokens=40)['raw'].strip()

print('1. printed text (scikit-image sample images)')
for name, array in {'text': data.text(), 'page': data.page()}.items():
    print(f'   {name}: {ocr(Image.fromarray(array).convert("RGB"))!r}')

fonts = glob.glob('/usr/share/fonts/**/*Bold*.ttf', recursive=True) + glob.glob('/usr/**/DejaVuSans-Bold.ttf', recursive=True)
font_path = fonts[0] if fonts else None
print('\n2. a registration on a large frame (needs zooming in)')
if not font_path:
    print('   no TrueType font on this machine; skipped')
else:
    for label, text in (('UK registration', 'G-OKES'), ('US tail number', 'N738PA'), ('bird ring', 'EB 74918')):
        frame = Image.new('RGB', (4000, 2667), (120, 160, 210))
        d = ImageDraw.Draw(frame)
        d.polygon([(1500, 1300), (2500, 1280), (2600, 1330), (1500, 1360)], fill=(235, 235, 235))      # a plain fuselage shape
        size = 34 if label != 'bird ring' else 26
        d.text((1620, 1305), text, font=ImageFont.truetype(font_path, size), fill=(20, 20, 20))
        whole = ocr(frame)
        crop = frame.crop((1480, 1240, 2000, 1420)); crop = crop.resize((crop.width * 3, crop.height * 3), Image.LANCZOS)
        zoomed = ocr(crop)
        print(f'   {label:16} truth={text!r:12} whole frame -> {whole!r:22} zoomed crop -> {zoomed!r}')
