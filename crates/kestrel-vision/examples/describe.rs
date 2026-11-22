// cargo run --release --example describe -- <model dir> <photo> ["question"]
use std::path::Path;
fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dir = args.first().expect("model dir");
    let photo = image::open(args.get(1).expect("photo"))?.to_rgb8();
    let question = args.get(2).map(String::as_str).unwrap_or("In two short plain sentences: what is the main subject, and is the light and colour natural?");
    let mut model = kestrel_vision::VisionModel::load(Path::new(dir), 4)?;
    let d = model.describe(&photo, question, 60)?;
    println!("{}", serde_json::json!({ "loadMs": model.load_ms, "visionMs": d.vision_ms, "generateMs": d.generate_ms, "promptTokens": d.prompt_tokens, "newTokens": d.new_tokens, "answer": d.text }));
    Ok(())
}
