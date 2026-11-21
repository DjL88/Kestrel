"""SmolVLM2-500M on ONNX Runtime (CPU): the reference implementation for Kestrel's offline visual check.

This is the measurement and evaluation harness. The editor will use the same ONNX files through its own runtime; this
file exists so the model's real behaviour, speed and memory are known before that port, and so the port can be compared
against it. Nothing here uploads anything: the model and the image stay on the machine.
"""
import resource, time
from pathlib import Path
import numpy as np
import onnxruntime as ort
from PIL import Image

IMAGE_TOKEN = 49190          # <image>, from config.json
LAYERS, KV_HEADS, HEAD_DIM = 32, 5, 64

class SmolVLM:
    def __init__(self, root: str | Path, quant: str = 'int8', threads: int | None = None):
        from transformers import AutoImageProcessor, AutoTokenizer
        from transformers.models.smolvlm.processing_smolvlm import _prompt_single_image
        self._single = _prompt_single_image
        root = Path(root)
        started = time.perf_counter()
        options = ort.SessionOptions()
        if threads:
            options.intra_op_num_threads = threads
        load = lambda name: ort.InferenceSession(str(root / 'onnx' / f'{name}_{quant}.onnx'), options, providers=['CPUExecutionProvider'])
        self.vision, self.embed, self.decoder = load('vision_encoder'), load('embed_tokens'), load('decoder_model_merged')
        # Image processor and tokenizer only: the full processor needs PyTorch for its video path, which Kestrel never uses.
        self.images = AutoImageProcessor.from_pretrained(str(root), use_fast=False)
        self.tokenizer = AutoTokenizer.from_pretrained(str(root))
        self.eos = {self.tokenizer.eos_token_id, self.tokenizer.convert_tokens_to_ids('<end_of_utterance>')}
        self.load_seconds = time.perf_counter() - started
        self.past_names = [i.name for i in self.decoder.get_inputs() if i.name.startswith('past_key_values')]

    def ask(self, image: Image.Image, question: str, max_new_tokens: int = 80) -> dict:
        """Greedy answer to one question about one image, with timings."""
        timings = {}
        messages = [{'role': 'user', 'content': [{'type': 'image'}, {'type': 'text', 'text': question}]}]
        prompt = self.tokenizer.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
        # One 512 px view of the whole picture. Splitting into tiles costs many times more and is not needed for a check.
        pixels = self.images(image.convert('RGB'), return_tensors='np', do_image_splitting=False)
        expanded = self._single(64, '<fake_token_around_image>', '<image>', '<global-img>')
        text = prompt.replace('<image>', expanded, 1)
        inputs = {'input_ids': np.array([self.tokenizer(text)['input_ids']]), 'pixel_values': pixels['pixel_values'],
                  'pixel_attention_mask': pixels['pixel_attention_mask']}
        ids = inputs['input_ids'].astype(np.int64)
        t = time.perf_counter()
        features = self.vision.run(None, {'pixel_values': inputs['pixel_values'].astype(np.float32),
                                          'pixel_attention_mask': inputs['pixel_attention_mask'].astype(bool)})[0]
        timings['vision_s'] = time.perf_counter() - t
        t = time.perf_counter()
        embeds = self.embed.run(None, {'input_ids': ids})[0]
        slots = np.where(ids[0] == IMAGE_TOKEN)[0]
        flat = features.reshape(-1, features.shape[-1])
        if len(slots) != len(flat):
            raise ValueError(f'{len(slots)} image slots but {len(flat)} image features')
        embeds[0, slots] = flat
        past = {n: np.zeros((1, KV_HEADS, 0, HEAD_DIM), np.float32) for n in self.past_names}
        mask = np.ones((1, ids.shape[1]), np.int64)
        position = np.arange(ids.shape[1], dtype=np.int64)[None]
        out_ids, first = [], None
        for _ in range(max_new_tokens):
            result = self.decoder.run(None, {'inputs_embeds': embeds, 'attention_mask': mask, 'position_ids': position, **past})
            logits, presents = result[0], result[1:]
            if first is None:
                first = time.perf_counter() - t
            token = int(np.argmax(logits[0, -1]))
            if token in self.eos:
                break
            out_ids.append(token)
            past = {n: p for n, p in zip(self.past_names, presents)}
            embeds = self.embed.run(None, {'input_ids': np.array([[token]], np.int64)})[0]
            mask = np.concatenate([mask, np.ones((1, 1), np.int64)], axis=1)
            position = position[:, -1:] + 1
        total = time.perf_counter() - t
        timings.update(first_token_s=first, decode_s=total, tokens=len(out_ids),
                       tokens_per_s=(len(out_ids) / max(total - (first or 0), 1e-9)) if len(out_ids) > 1 else None)
        return {'text': self.tokenizer.decode(out_ids, skip_special_tokens=True).strip(), **timings}

def peak_rss_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
