# Test Kestrel's first photograph-quality MVP without Claude or an installer

**Status:** diagnostic test for draft PR #382, not a release or a picture-quality certification.
The native test command processes a real Nikon RAW to RGB16 TIFF without first installing a
Mac/Windows Kestrel application. The original stays unchanged. No photos are uploaded.

## What Google AI Studio can test immediately

1. Open your existing Kestrel project in Google AI Studio Build mode (or import its GitHub code).
2. Import 5–20 **JPEG** photographs. Test Import → Review → Keep/Reject → Edit → normal Export.
3. Compare exported files to the preview. Check clipping, bird feather colours, crop, orientation,
   file dimensions, and whether the result reopens with adjustments intact.
4. Record unexpected behaviour and browser/runtime errors.

This tests the **web UI and JPEG pipeline**, not native Nikon RAW demosaicing or the edited TIFF
command. The unmerged PR #382 is not automatically present in an existing AI Studio copy of main:
**do not merge just to test through AI Studio**.

Google's optional visual AI decision service is separate from AI Studio's Build preview and
cannot certify sensor detail, original RAW decoding or correct ICC colour.

## Native RAW test: Mac or Windows, no app installer

You need Git, Node 22, Rust/Cargo and the OS compiler prerequisites once. Claude is not required.

- **Mac:** Xcode Command Line Tools (use xcode-select --install if missing), Node.js 22,
  and Rust from https://rustup.rs/.
- **Windows:** Git, Node.js 22, Rust's default MSVC toolchain, and Visual Studio 2022 Build
  Tools with Desktop development with C++. Open a new PowerShell window after installing.
- Both: https://v2.tauri.app/start/prerequisites/.

Use an isolated checkout of the POC branch. This will not replace any installed version of
Kestrel or touch existing app projects.

### Mac Terminal

~~~bash
git clone --branch poc/raw16-edited-master-20261118 --single-branch https://github.com/DjL88/Kestrel.git
cd Kestrel
node scripts/test-raw-master.mjs "/Volumes/Photos/your-original.NEF"
~~~

### Windows PowerShell

~~~powershell
git clone --branch poc/raw16-edited-master-20261118 --single-branch https://github.com/DjL88/Kestrel.git
cd Kestrel
node .\scripts\test-raw-master.mjs "D:\Photos\your-original.NEF"
~~~

Start with a real Z8 or Z5II **lossless** NEF. Then try HE/HE*: these may fail to
decode, which is useful, honest evidence. The test will not substitute embedded JPEGs.

The test command automatically:
1. hashes the original RAW file (SHA-256);
2. runs the native RGB16 Rust unit tests;
3. compiles and runs the standalone RAW-to-TIFF renderer;
4. inspects output TIFF dimensions and RGB channel bit depth;
5. checks the original file hash did not change;
6. reports ICC profile presence or absence.

Output is stored under **~/Kestrel-MVP-Tests** (Windows: the Kestrel-MVP-Tests folder
under your user profile). For another local destination, set the
KESTREL_MASTER_OUTPUT_DIR environment variable. The command refuses to overwrite
an existing output file and does not need internet access after Rust dependencies are installed.

**Known blocker:** Currently the POC may output valid RGB16 samples but no embedded ICC
profile, and camera colour fidelity is not certified. This test explicitly labels that
as a release blocker rather than calling the TIFF photographically correct.

### Optional test: reproducible edit + crop

Create tone.json:

~~~json
{
  "exposure": 0.4,
  "warmth": -0.1,
  "colour": 0,
  "brightness": 0,
  "contrast": 0.1,
  "highlights": -0.3,
  "shadows": 0.1,
  "whites": 0,
  "blacks": 0,
  "vibrance": 0
}
~~~

Create crop.json:

~~~json
{
  "ratio": 1.5,
  "turns": 1,
  "straighten": 0,
  "x": 0.5,
  "y": 0.5,
  "size": 0.8
}
~~~

Run:

~~~bash
node scripts/test-raw-master.mjs "/path/to/original.NEF" tone.json crop.json
~~~

Compare the exported TIFF's crop and orientation against the expected edit.
It refuses unsupported straighten, mask and detail edits rather than discarding them.

## What evidence to share

- Final PASS/FAIL console output, or the exact error, with any keys or credentials removed.
- Camera, RAW compression mode, TIFF dimensions, and whether it opens properly.
- Optional comparison screenshots at 100% of an eye, feathers, shadow and highlights beside
  a Nikon NX Studio TIFF made from the same RAW.

Do not upload private originals to Google or other cloud services without explicitly deciding
to share them. The test is entirely local.

## Quality release gates not covered by this test

- Validated working colour space, ICC-tagged output and Nikon NX Studio colour parity.
- Full-resolution natural feather detail, background denoise, eye sharpness and white-plumage retention.
- HE/HE* decode support or clear review-only fallback.
- Match between screen preview and native TIFF for all supported editing controls.
- Clean native Mac/Windows end-to-end app test plus a complete 500-photo export scenario.

The GitHub Actions billing hold means GitHub-hosted CI cannot currently be relied on as
test evidence. This local command supplies a meaningful substitute for native code execution.
