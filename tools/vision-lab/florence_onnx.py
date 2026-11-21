"""Florence-2-base on ONNX Runtime (CPU): finds and names what is in a photo, as boxes.

Used by Kestrel to check a subject mask against where the model sees the subject, and to notice a missing region. It is
a grounding model, not a chat model: it answers fixed task prompts. Greedy decoding, no beam search, because a box check
needs the most likely reading, not several.
"""
import re, time
from pathlib import Path
import numpy as np
import onnxruntime as ort
from PIL import Image

LAYERS, HEADS, HEAD_DIM, SIZE = 6, 12, 64, 768
MEAN, STD = np.array([0.485, 0.456, 0.406], np.float32), np.array([0.229, 0.224, 0.225], np.float32)
PROMPTS = {'<OCR>': 'What is the text in the image?', '<OCR_WITH_REGION>': 'What is the text in the image, with regions?', '<OD>': 'Locate the objects with category name in the image.', '<CAPTION>': 'What does the image describe?',
           '<CAPTION_TO_PHRASE_GROUNDING>': 'Locate the phrases in the caption: '}

class Florence:
    def __init__(self, root: str | Path, quant: str = 'int8', threads: int | None = None):
        from transformers import AutoTokenizer
        root = Path(root)
        started = time.perf_counter()
        options = ort.SessionOptions()
        if threads:
            options.intra_op_num_threads = threads
        load = lambda name: ort.InferenceSession(str(root / 'onnx' / f'{name}_{quant}.onnx'), options, providers=['CPUExecutionProvider'])
        self.vision, self.embed, self.encoder, self.decoder = load('vision_encoder'), load('embed_tokens'), load('encoder_model'), load('decoder_model_merged')
        self.tokenizer = AutoTokenizer.from_pretrained(str(root))
        self.load_seconds = time.perf_counter() - started

    @staticmethod
    def _pixels(image: Image.Image) -> np.ndarray:
        resized = image.convert('RGB').resize((SIZE, SIZE), Image.BICUBIC)
        array = (np.asarray(resized, np.float32) / 255.0 - MEAN) / STD
        return array.transpose(2, 0, 1)[None].astype(np.float32)

    def run(self, image: Image.Image, task: str = '<OD>', text: str = '', max_new_tokens: int = 200) -> dict:
        prompt = PROMPTS[task] + text
        ids = np.array([self.tokenizer(prompt)['input_ids']], np.int64)
        t = time.perf_counter()
        features = self.vision.run(None, {'pixel_values': self._pixels(image)})[0]
        embeds = np.concatenate([features, self.embed.run(None, {'input_ids': ids})[0]], axis=1)
        mask = np.ones(embeds.shape[:2], np.int64)
        hidden = self.encoder.run(None, {'attention_mask': mask, 'inputs_embeds': embeds})[0]
        names = [i.name for i in self.decoder.get_inputs() if i.name.startswith('past_key_values')]
        empty = np.zeros((1, HEADS, 0, HEAD_DIM), np.float32)
        past = {n: empty for n in names}
        token, out, cached = 2, [], False          # 2 is both the start and the end token
        for _ in range(max_new_tokens):
            result = self.decoder.run(None, {
                'encoder_attention_mask': mask, 'encoder_hidden_states': hidden,
                'inputs_embeds': self.embed.run(None, {'input_ids': np.array([[token]], np.int64)})[0],
                'use_cache_branch': np.array([cached]), **past})
            presents = dict(zip([o.name.replace('present.', 'past_key_values.') for o in self.decoder.get_outputs()[1:]], result[1:]))
            for name in names:
                # The cross-attention cache is computed once, on the first step; self-attention grows every step.
                if '.decoder.' in name or not cached:
                    past[name] = presents[name]
            cached = True
            token = int(np.argmax(result[0][0, -1]))
            if token == 2 and out:
                break
            if token != 2:
                out.append(token)
        raw = self.tokenizer.decode(out, skip_special_tokens=False)
        text_out = re.sub(r'</?s>|<pad>', '', raw)
        return {'raw': text_out, 'seconds': time.perf_counter() - t, 'boxes': self.parse_boxes(text_out, image.size)}

    @staticmethod
    def parse_text_regions(text: str, size: tuple[int, int]) -> list[dict]:
        """`text<loc>x8` (a quadrilateral on the 0 to 999 grid) becomes the text and its bounding box in image pixels."""
        width, height = size
        regions = []
        for match in re.finditer(r'([^<]*)((?:<loc_\d+>){8})', text):
            values = [int(v) for v in re.findall(r'<loc_(\d+)>', match.group(2))]
            xs, ys = values[0::2], values[1::2]
            regions.append({'text': match.group(1).strip(),
                            'box': [min(xs) / 1000 * width, min(ys) / 1000 * height, max(xs) / 1000 * width, max(ys) / 1000 * height]})
        return regions

    @staticmethod
    def parse_boxes(text: str, size: tuple[int, int]) -> list[dict]:
        """`label<loc_x1><loc_y1><loc_x2><loc_y2>` on a 0 to 999 grid, scaled back to the original image."""
        width, height = size
        boxes = []
        for label, a, b, c, d in re.findall(r'([^<]*)<loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)>', text):
            x1, y1, x2, y2 = (int(v) for v in (a, b, c, d))
            boxes.append({'label': label.strip(), 'box': [x1 / 1000 * width, y1 / 1000 * height, x2 / 1000 * width, y2 / 1000 * height]})
        return boxes
