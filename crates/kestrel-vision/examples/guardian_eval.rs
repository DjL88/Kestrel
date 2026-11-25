// Measures the Vision guardian with the app's own model engine (docs/QUALITY-BENCHMARKS.md).
// cargo run --release --example guardian_eval -- <model dir> <cases.json> > answers.jsonl
// <cases.json> comes from `npx tsx scripts/guardian-benchmark.mts prepare labels.json`; image and mask paths in it are
// relative to that file. One JSON line per question: {"id","text","ms"}; the first line is {"model","loadMs"}.
// Read-only: photos and masks are only read, nothing is written next to them, and nothing touches the network.
use image::{imageops::FilterType, GrayImage, RgbImage};
use std::io::Write;
use std::path::Path;
use std::time::Instant;

/// Same value as MASK_OUTSIDE_BRIGHTNESS in src/core/visionGuardian.ts.
const OUTSIDE: f32 = 0.25;

/// The "cut" variant: the top 40% of the subject's bounding box is removed from the mask (head, wings, ears).
fn cut_mask(mask: &mut GrayImage) {
    let (w, h) = mask.dimensions();
    let (mut top, mut bottom) = (h, 0);
    for y in 0..h {
        if (0..w).any(|x| mask.get_pixel(x, y)[0] > 127) { top = top.min(y); bottom = bottom.max(y); }
    }
    if top > bottom { return; }
    let stop = top + ((bottom - top + 1) as f32 * 0.4).round() as u32;
    for y in top..stop.min(h) { for x in 0..w { mask.put_pixel(x, y, image::Luma([0])); } }
}

/// Mirrors darkenOutsideMask in src/core/visionGuardian.ts.
fn darken_outside(photo: &mut RgbImage, mask: &GrayImage) {
    let small = image::imageops::resize(mask, photo.width(), photo.height(), FilterType::Triangle);
    for (x, y, pixel) in photo.enumerate_pixels_mut() {
        let alpha = small.get_pixel(x, y)[0] as f32 / 255.0;
        let keep = OUTSIDE + (1.0 - OUTSIDE) * alpha;
        for c in 0..3 { pixel[c] = (pixel[c] as f32 * keep).round().clamp(0.0, 255.0) as u8; }
    }
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (dir, cases_path) = match (args.first(), args.get(1)) {
        (Some(d), Some(c)) => (d.clone(), Path::new(c).to_path_buf()),
        _ => anyhow::bail!("usage: guardian_eval <model dir> <cases.json>"),
    };
    let folder = cases_path.parent().unwrap_or(Path::new(".")).to_path_buf();
    let cases: serde_json::Value = serde_json::from_slice(&std::fs::read(&cases_path)?)?;
    let cases = cases.as_array().ok_or_else(|| anyhow::anyhow!("cases.json must be a list"))?;
    let mut model = kestrel_vision::VisionModel::load(Path::new(&dir), 4)?;
    let mut out = std::io::stdout().lock();
    writeln!(out, "{}", serde_json::json!({ "model": kestrel_vision::pack::REVISION_FULL, "loadMs": model.load_ms }))?;
    for case in cases {
        let id = case["id"].as_str().unwrap_or_default();
        let question = case["question"].as_str().unwrap_or_default();
        if id.is_empty() || question.is_empty() || question.len() > kestrel_vision::pack::MAX_QUESTION { continue; }
        let started = Instant::now();
        let result = (|| -> anyhow::Result<String> {
            let mut photo = image::open(folder.join(case["image"].as_str().unwrap_or_default()))?.to_rgb8();
            if let Some(mask_path) = case["mask"].as_str() {
                let mut mask = image::open(folder.join(mask_path))?.to_luma8();
                if case["maskVariant"].as_str() == Some("cut") { cut_mask(&mut mask); }
                darken_outside(&mut photo, &mask);
            }
            // The same 60-token limit as the app's own check (pack.rs run_image).
            Ok(model.describe(&photo, question, 60)?.text)
        })();
        let ms = started.elapsed().as_millis();
        match result {
            Ok(text) => writeln!(out, "{}", serde_json::json!({ "id": id, "text": text, "ms": ms }))?,
            Err(error) => eprintln!("{id}: not answered ({error})"),
        }
        out.flush()?;
    }
    Ok(())
}
