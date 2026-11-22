//! Local vision-language model for Kite44 (issue #703): SmolVLM2-500M, int8, run on this device with ONNX Runtime.
//! Nothing here touches the network; the model files come from a directory the app has already verified against
//! pinned SHA-256 digests (see scripts/models/manifest.json). One image in, plain text out. The text is only ever
//! read by the app as an observation to be validated; it is never run, fetched or trusted as an edit.
use anyhow::{anyhow, bail, Context, Result};
use image::{imageops::FilterType, RgbImage};
use ort::environment::Environment;
use ort::session::{builder::AutoDevicePolicy, Session};
use ort::value::{DynValue, Tensor};
use std::path::Path;
use std::time::Instant;
use tokenizers::Tokenizer;

const IMAGE_SIZE: u32 = 512;
const IMAGE_TOKENS: usize = 64;
const IMAGE_TOKEN: i64 = 49190;
const END_OF_UTTERANCE: i64 = 49279;
const LAYERS: usize = 32;
const KV_HEADS: usize = 5;
const HEAD_DIM: usize = 64;
const HIDDEN: usize = 960;

pub struct VisionModel {
    _environment: Environment,
    vision: Session,
    embed: Session,
    decoder: Session,
    tokenizer: Tokenizer,
    pub load_ms: u128,
}

#[derive(Debug, Clone)]
pub struct Description {
    pub text: String,
    pub prompt_tokens: usize,
    pub new_tokens: usize,
    pub vision_ms: u128,
    pub generate_ms: u128,
}

fn ort_err<E: std::fmt::Display>(e: E) -> anyhow::Error { anyhow!("{e}") }

fn tensor_f32(shape: Vec<usize>, data: Vec<f32>) -> Result<DynValue> {
    Ok(Tensor::from_array((shape, data)).map_err(ort_err)?.into_dyn())
}
fn tensor_i64(shape: Vec<usize>, data: Vec<i64>) -> Result<DynValue> {
    Ok(Tensor::from_array((shape, data)).map_err(ort_err)?.into_dyn())
}

/// Embeds token ids. A free function so the caller can keep other sessions borrowed.
fn embed_ids(session: &mut Session, ids: &[i64]) -> Result<Vec<f32>> {
    let out = session.run(vec![("input_ids".to_string(), tensor_i64(vec![1, ids.len()], ids.to_vec())?)]).map_err(ort_err)?;
    let (_, data) = out["inputs_embeds"].try_extract_tensor::<f32>().map_err(ort_err)?;
    Ok(data.to_vec())
}

/// The text the model sees: the photo first, then the question, in the model's own chat format.
pub fn build_prompt(question: &str) -> String {
    let image = format!("<fake_token_around_image><global-img>{}<fake_token_around_image>", "<image>".repeat(IMAGE_TOKENS));
    format!("<|im_start|>User:{image}{question}<end_of_utterance>\nAssistant:")
}

/// Longest edge to 512 px, kept in proportion, padded bottom/right with zeros after scaling to -1..1. Returns pixels and the mask of real ones.
pub fn prepare_pixels(photo: &RgbImage) -> (Vec<f32>, Vec<bool>) {
    let (w, h) = photo.dimensions();
    let scale = IMAGE_SIZE as f32 / w.max(h) as f32;
    let nw = ((w as f32 * scale).round() as u32).clamp(1, IMAGE_SIZE);
    let nh = ((h as f32 * scale).round() as u32).clamp(1, IMAGE_SIZE);
    let small = image::imageops::resize(photo, nw, nh, FilterType::Lanczos3);
    let side = IMAGE_SIZE as usize;
    let mut pixels = vec![0f32; 3 * side * side];
    let mut mask = vec![false; side * side];
    for y in 0..nh as usize {
        for x in 0..nw as usize {
            let p = small.get_pixel(x as u32, y as u32);
            mask[y * side + x] = true;
            for c in 0..3 {
                pixels[c * side * side + y * side + x] = (p[c] as f32 / 255.0 - 0.5) / 0.5;
            }
        }
    }
    (pixels, mask)
}

impl VisionModel {
    /// `dir` holds `tokenizer.json` and `onnx/{vision_encoder,embed_tokens,decoder_model_merged}_int8.onnx`.
    pub fn load(dir: &Path, threads: usize) -> Result<Self> {
        let started = Instant::now();
        // Telemetry is switched off explicitly: this model runs with the network off, and nothing is sent anywhere.
        let environment = ort::init().with_telemetry(false)
            // CPU only: the accelerator back ends cannot take the empty first-step cache, and results should not depend on the machine.
            .with_execution_providers([ort::ep::CPU::default().build()])
            .build().map_err(ort_err)?;
        let session = |name: &str| -> Result<Session> {
            Session::builder(&environment).map_err(ort_err)?
                .with_auto_device(AutoDevicePolicy::PreferCPU).map_err(ort_err)?
                .with_execution_providers([ort::ep::CPU::default().build()]).map_err(ort_err)?
                .with_intra_threads(threads).map_err(ort_err)?
                .commit_from_file(dir.join("onnx").join(name)).map_err(ort_err)
                .with_context(|| format!("could not load {name}"))
        };
        let tokenizer = Tokenizer::from_file(dir.join("tokenizer.json")).map_err(|e| anyhow!("tokenizer: {e}"))?;
        let (vision, embed, decoder) = (session("vision_encoder_int8.onnx")?, session("embed_tokens_int8.onnx")?, session("decoder_model_merged_int8.onnx")?);
        Ok(Self {
            _environment: environment,
            vision, embed, decoder,
            tokenizer,
            load_ms: started.elapsed().as_millis(),
        })
    }

    /// Look at one photo and answer in plain text. Greedy, so the same photo and question give the same answer.
    pub fn describe(&mut self, photo: &RgbImage, question: &str, max_new_tokens: usize) -> Result<Description> {
        let vision_started = Instant::now();
        let (pixels, mask) = prepare_pixels(photo);
        let side = IMAGE_SIZE as usize;
        let features = {
            let out = self.vision.run(vec![
                ("pixel_values".to_string(), tensor_f32(vec![1, 1, 3, side, side], pixels)?),
                ("pixel_attention_mask".to_string(), Tensor::from_array((vec![1usize, 1, side, side], mask)).map_err(ort_err)?.into_dyn()),
            ]).map_err(ort_err)?;
            let (shape, data) = out["image_features"].try_extract_tensor::<f32>().map_err(ort_err)?;
            if data.len() != IMAGE_TOKENS * HIDDEN { bail!("unexpected image features {:?}", shape); }
            data.to_vec()
        };
        let vision_ms = vision_started.elapsed().as_millis();

        let encoding = self.tokenizer.encode(build_prompt(question), false).map_err(|e| anyhow!("{e}"))?;
        let ids: Vec<i64> = encoding.get_ids().iter().map(|&i| i as i64).collect();
        let mut embeds = embed_ids(&mut self.embed, &ids)?;
        let mut next_feature = 0;
        for (row, &id) in ids.iter().enumerate() {
            if id == IMAGE_TOKEN {
                if next_feature >= IMAGE_TOKENS { bail!("more image tokens than image features"); }
                embeds[row * HIDDEN..(row + 1) * HIDDEN].copy_from_slice(&features[next_feature * HIDDEN..(next_feature + 1) * HIDDEN]);
                next_feature += 1;
            }
        }
        if next_feature != IMAGE_TOKENS { bail!("expected {IMAGE_TOKENS} image tokens, found {next_feature}"); }

        let generate_started = Instant::now();
        let mut past: Vec<Vec<f32>> = vec![Vec::new(); LAYERS * 2];
        let mut past_len = 0usize;
        let mut cur_embeds = embeds;
        let mut cur_len = ids.len();
        let mut reply: Vec<u32> = Vec::new();
        for _ in 0..max_new_tokens {
            let total = past_len + cur_len;
            let mut inputs: Vec<(String, DynValue)> = vec![
                ("inputs_embeds".into(), tensor_f32(vec![1, cur_len, HIDDEN], cur_embeds)?),
                ("attention_mask".into(), tensor_i64(vec![1, total], vec![1; total])?),
                ("position_ids".into(), tensor_i64(vec![1, cur_len], (past_len..total).map(|p| p as i64).collect())?),
            ];
            for layer in 0..LAYERS {
                for (slot, kind) in ["key", "value"].iter().enumerate() {
                    inputs.push((format!("past_key_values.{layer}.{kind}"),
                        tensor_f32(vec![1, KV_HEADS, past_len, HEAD_DIM], std::mem::take(&mut past[layer * 2 + slot]))?));
                }
            }
            let out = self.decoder.run(inputs).map_err(ort_err)?;
            let (shape, logits) = out["logits"].try_extract_tensor::<f32>().map_err(ort_err)?;
            let vocab = *shape.last().ok_or_else(|| anyhow!("empty logits"))? as usize;
            let last = &logits[logits.len() - vocab..];
            let token = last.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).map(|(i, _)| i as i64).unwrap();
            for layer in 0..LAYERS {
                for (slot, kind) in ["key", "value"].iter().enumerate() {
                    let (_, data) = out[format!("present.{layer}.{kind}").as_str()].try_extract_tensor::<f32>().map_err(ort_err)?;
                    past[layer * 2 + slot] = data.to_vec();
                }
            }
            past_len = total;
            if token == END_OF_UTTERANCE { break; }
            reply.push(token as u32);
            cur_embeds = embed_ids(&mut self.embed, &[token])?;
            cur_len = 1;
        }
        let text = self.tokenizer.decode(&reply, true).map_err(|e| anyhow!("{e}"))?.trim().to_string();
        Ok(Description { text, prompt_tokens: ids.len(), new_tokens: reply.len(), vision_ms, generate_ms: generate_started.elapsed().as_millis() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_has_the_photo_first_and_sixty_four_image_slots() {
        let prompt = build_prompt("What is this?");
        assert!(prompt.starts_with("<|im_start|>User:<fake_token_around_image><global-img>"));
        assert_eq!(prompt.matches("<image>").count(), IMAGE_TOKENS);
        assert!(prompt.ends_with("What is this?<end_of_utterance>\nAssistant:"));
    }

    #[test]
    fn a_wide_photo_is_scaled_to_512_wide_and_padded_below() {
        let photo = RgbImage::from_pixel(2000, 1000, image::Rgb([255, 255, 255]));
        let (pixels, mask) = prepare_pixels(&photo);
        let side = IMAGE_SIZE as usize;
        assert_eq!(pixels.len(), 3 * side * side);
        assert!(mask[0] && mask[255 * side + 511]);
        assert!(!mask[256 * side], "rows below the scaled photo are padding");
        assert!((pixels[0] - 1.0).abs() < 1e-3, "white maps to 1.0");
        assert_eq!(pixels[300 * side], 0.0, "padding is zero");
    }
}
