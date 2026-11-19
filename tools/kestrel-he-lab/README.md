# Kestrel HE laboratory — owned, independent decoder

**Status: foundation / HEADER-ONLY, NOT a RAW decoder.** This isolated Rust crate is not compiled into, or shipped with, the Kestrel application. It has no external dependencies.

The product direction is to implement our **own** Nikon HE/HE* decoder and cross-platform RAW interface. LibRaw, ticoraw, public JPEG XS documentation and lawful reference renders are sources of knowledge, test vectors and comparison data, **not runtime dependencies or products Kestrel must use**. Independent authorship also means no wholesale copying of third-party source.

## Implemented in this first slice

- Bounded, endian-aware TIFF IFD traversal, including SubIFDs; choose the largest matching Nikon CFA RAW frame.
- Recognise Nikon compression 34713 and a structurally plausible JPEG XS/TicoRAW strip (SOC, CAP, PIH, EOC), with overflow and out-of-range protection.
- Read Nikon Type-3 MakerNote mode 13 (HE) or 14 (HE*) **only when explicitly present**. Otherwise mode is unknown. Files with other RAW modes are not mislabeled.
- Explicit `Evidence::HeaderOnly`: no data is decompressed, demosaiced, used for editing or deemed fit for full-quality export.
- Synthetic tests for both modes, unknown mode, bad strip offsets, false markers, unrecognised compression and truncated input.

## Run locally

```bash
cd tools/kestrel-he-lab
cargo test
```

**Not run in the connector environment:** Rust toolchain and camera fixtures are not available. Do not claim correctness on Z8/Z5II or parity with Adobe/Nikon until tests run locally.

## Concrete next decoding milestones

1. **D1 — strict framing and metadata:** Implement bounded PIH/CDT/WGT/CAP parsing with camera-neutral structured output, slice/precinct and packet index offsets; reject unsupported vendor parameters rather than guessing. Unit and fuzz targets with tiny synthetic streams; never load an entire 500-photo shoot at once.
2. **D2 — entropy stage:** Independently decode validated packet significance, GCLI, bitplane and sign data into *quantised* coefficients; test boundaries and malformed inputs with synthetic encoder fixtures.
3. **D3 — inverse transforms:** Reverse dequantisation and inverse 5/3 wavelets plus CFA/Bayer-specific transform and transfer curve; output 16-bit sensor mosaic with black/white levels, CFA pattern, orientation and crop. No JPEG intermediate.
4. **D4 — conformance:** Fetch **only lawfully available CC0 examples, locally**, from the documented `ticoraw/conformance/manifest.toml`. Verify each input SHA-256 and independently calculated expected output CFA hashes. Cover Z8 and Z5II HE and HE*, multiple crops/firmwares, corrupted/missing files; do not commit or upload photograph bytes, EXIF, serials or paths. Record any discrepancies.
5. **D5 — cross-platform integration:** Stable Kestrel `RawDecodeResult` and provenance enum, Rust native on desktop, WASM runtime on web/mobile if verified; bounded workers, cancellation, memory profiling, local fallbacks and real end-to-end 16-bit editing and export.
6. **D6 — professional visual validation:** Nikon NX Studio / Adobe DNG Converter reference outputs obtained legally; compare *raw mosaic* separately from downstream colour, tone, noise and edge/detail reconstruction. No claims of matching Nikon colours or DxO DeepPRIME without measurements.

## Legal, authenticity and performance gates

- JPEG XS / TicoRAW compression is associated with patent claims. **An independent implementation does not itself provide patent clearance.** Before distributing compiled HE decoding functionality commercially, obtain jurisdiction-specific qualified IP/licensing advice. No terms accepted, no codec distributed by this lab, no cloud spend.
- Keep original files byte-identical and local. No generative synthesis. An unsupported or failed stage must never masquerade as a complete RAW decode.
- Target the same deterministic raster values on supported platforms. Record failure and uncertainty plainly. Prefer memory-bounded tile/slice processing, controlled parallelism and background priority for the selected frame.
- Check the multi-agent board [#418](https://github.com/DjL88/Kestrel/issues/418) before modifying anything; this crate is currently an independent K-05 proof of ownership, **not** a release-ready decoder.