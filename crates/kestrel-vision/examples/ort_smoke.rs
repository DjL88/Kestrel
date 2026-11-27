//! Smoke check for the ONNX Runtime this build links: load one small model and run it once on the CPU.
//! Used by CI on both Mac architectures (Apple silicon, and Intel under Rosetta), so the universal app's native models
//! are proven to load and run, not only to link. No network, nothing written.
//!
//!   cargo run --release --example ort_smoke -- path/to/u2netp.onnx
use anyhow::{anyhow, Result};
use ort::session::Session;
use ort::value::Tensor;

fn main() -> Result<()> {
    let path = std::env::args().nth(1).ok_or_else(|| anyhow!("usage: ort_smoke <model.onnx>"))?;
    let environment = ort::init().with_telemetry(false)
        .with_execution_providers([ort::ep::CPU::default().build()])
        .build().map_err(|e| anyhow!("{e}"))?;
    let mut session = Session::builder(&environment).map_err(|e| anyhow!("{e}"))?
        .with_execution_providers([ort::ep::CPU::default().build()]).map_err(|e| anyhow!("{e}"))?
        .with_intra_threads(1).map_err(|e| anyhow!("{e}"))?
        .commit_from_file(&path).map_err(|e| anyhow!("could not load {path}: {e}"))?;
    // u2netp: one 1 x 3 x 320 x 320 picture in; the subject maps out. A mid-grey picture is enough to prove it runs.
    let input = Tensor::from_array((vec![1usize, 3, 320, 320], vec![0.5f32; 3 * 320 * 320])).map_err(|e| anyhow!("{e}"))?;
    let outputs = session.run(vec![("input.1".to_string(), input.into_dyn())]).map_err(|e| anyhow!("{e}"))?;
    let mut values = 0usize;
    for (name, value) in outputs.iter() {
        let (shape, data) = value.try_extract_tensor::<f32>().map_err(|e| anyhow!("{e}"))?;
        if !data.iter().all(|v| v.is_finite()) { return Err(anyhow!("output {name} is not finite")); }
        values += data.len();
        println!("output {name}: {shape:?}");
    }
    if values == 0 { return Err(anyhow!("the model returned nothing")); }
    println!("ORT SMOKE PASS on {} ({} values)", std::env::consts::ARCH, values);
    Ok(())
}
