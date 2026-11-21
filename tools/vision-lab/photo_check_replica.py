"""A faithful Python replica of the app's Photo Check (src/providers/photoCheck.ts), for measuring it on many photos.

Same model files (SmolVLM2-256M int8, pinned), same preview (aspect-preserving letterbox on neutral grey at 512 px),
same question and token limit. The scene-fact rules are the app's own TypeScript (see eval_photo_check.mjs), so this
measures what the app would say. It is a measurement tool: the editor never calls Python.
"""
import json, time
from pathlib import Path
import numpy as np
import onnxruntime as ort
from PIL import Image
from tokenizers import Tokenizer

EDGE, IMAGE_TOKENS = 512, 64
QUESTION = 'Describe this photo in one short sentence.'

def letterbox_rgba(image: Image.Image) -> np.ndarray:
    image = image.convert('RGB')
    scale = min(EDGE / image.width, EDGE / image.height)
    w, h = image.width * scale, image.height * scale
    canvas = Image.new('RGB', (EDGE, EDGE), (128, 128, 128))
    canvas.paste(image.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS), (round((EDGE - w) / 2), round((EDGE - h) / 2)))
    rgba = np.concatenate([np.asarray(canvas), np.full((EDGE, EDGE, 1), 255, np.uint8)], axis=2)
    return rgba

class PhotoCheck:
    def __init__(self, root: str | Path):
        root = Path(root)
        t = time.perf_counter()
        load = lambda name: ort.InferenceSession(str(root / 'onnx' / f'{name}_int8.onnx'), providers=['CPUExecutionProvider'])
        self.vision, self.embed, self.decoder = load('vision_encoder'), load('embed_tokens'), load('decoder_model_merged')
        self.tok = Tokenizer.from_file(str(root / 'tokenizer.json'))
        self.load_seconds = time.perf_counter() - t
        self.past = [i for i in self.decoder.get_inputs() if i.name.startswith('past_key_values')]
        self.kv_shape = self.past[0].shape        # [batch, heads, past, head_dim]
        special = lambda s: self.tok.token_to_id(s)
        self.ids = {k: special(k) for k in ('<|im_start|>', '<fake_token_around_image>', '<global-img>', '<image>', '<end_of_utterance>')}
        self.eos = {self.ids['<end_of_utterance>'], self.tok.token_to_id('<|endoftext|>')}

    def _prompt(self, question: str) -> list[int]:
        enc = lambda s: self.tok.encode(s, add_special_tokens=False).ids
        i = self.ids
        return [i['<|im_start|>'], *enc('User:'), i['<fake_token_around_image>'], i['<global-img>'],
                *([i['<image>']] * IMAGE_TOKENS), i['<fake_token_around_image>'], *enc(question), i['<end_of_utterance>'], *enc('\nAssistant:')]

    def describe(self, rgba: np.ndarray, max_tokens: int = 28) -> dict:
        t = time.perf_counter()
        pixels = (rgba[:, :, :3].astype(np.float32) / 255 * 2 - 1).transpose(2, 0, 1)[None, None]
        features = self.vision.run(None, {'pixel_values': pixels, 'pixel_attention_mask': np.ones((1, 1, EDGE, EDGE), bool)})[0]
        ids = np.array([self._prompt(QUESTION)], np.int64)
        embeds = self.embed.run(None, {'input_ids': ids})[0]
        slots = np.where(ids[0] == self.ids['<image>'])[0]
        embeds[0, slots] = features.reshape(-1, features.shape[-1])
        heads, dim = self.kv_shape[1], self.kv_shape[3]
        past = {p.name: np.zeros((1, heads, 0, dim), np.float32) for p in self.past}
        mask = np.ones((1, ids.shape[1]), np.int64); pos = np.arange(ids.shape[1], dtype=np.int64)[None]
        out = []
        for _ in range(max_tokens):
            r = self.decoder.run(None, {'inputs_embeds': embeds, 'attention_mask': mask, 'position_ids': pos, **past})
            token = int(np.argmax(r[0][0, -1]))
            if token in self.eos: break
            out.append(token)
            past = {p.name: v for p, v in zip(self.past, r[1:])}
            embeds = self.embed.run(None, {'input_ids': np.array([[token]], np.int64)})[0]
            mask = np.concatenate([mask, np.ones((1, 1), np.int64)], axis=1); pos = pos[:, -1:] + 1
        return {'text': self.tok.decode(out).strip(), 'seconds': time.perf_counter() - t}
