// Developer harness (#703): runs the pinned SmolVLM2-500M int8 pack from disk with transformers.js, no network.
// Not part of the app. Usage (from a scratch folder where `npm i @huggingface/transformers` was run):
//   node transformersjs_smolvlm.mjs <photo.jpg> [~/kestrel-models/smolvlm2-500m/<revision>]
// Model files come from `python3 scripts/models/acquire.py --dest ~/kestrel-models --models smolvlm2-500m --quant int8`.
import { AutoProcessor, AutoModelForVision2Seq, RawImage, env } from '@huggingface/transformers';
import { dirname, basename } from 'node:path';
import { homedir } from 'node:os';

const [photo, dirArg] = process.argv.slice(2);
if (!photo) { console.error('usage: node transformersjs_smolvlm.mjs <photo.jpg> [model dir]'); process.exit(2); }
const dir = (dirArg ?? `${homedir()}/kestrel-models/smolvlm2-500m/4cde9d208e19`).replace(/^~/, homedir());
env.allowRemoteModels = false; // nothing is ever fetched
env.localModelPath = `${dirname(dir)}/`;
const id = basename(dir);
const started = Date.now();
const processor = await AutoProcessor.from_pretrained(id);
const model = await AutoModelForVision2Seq.from_pretrained(id, { dtype: { embed_tokens: 'int8', vision_encoder: 'int8', decoder_model_merged: 'int8' }, device: 'cpu' });
const loadMs = Date.now() - started;
const messages = [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: 'In two short plain sentences: what is the main subject, and is the light and colour natural?' }] }];
const inputs = await processor(processor.apply_chat_template(messages, { add_generation_prompt: true }), [await RawImage.read(photo)]);
const t = Date.now();
const out = await model.generate({ ...inputs, max_new_tokens: 60, do_sample: false });
const [answer] = processor.batch_decode(out.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true });
console.log(JSON.stringify({ model: id, loadMs, inferMs: Date.now() - t, rssMB: Math.round(process.memoryUsage().rss / 1048576), answer: answer.trim() }));
