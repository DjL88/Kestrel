#!/usr/bin/env python3
"""Read-only offline evidence manifest validator; never decodes or uploads RAW."""
import argparse
import hashlib
import json
from pathlib import Path

MODES = {"lossless", "he", "he-star"}
SOURCES = {"sensor-cfa", "system-render", "embedded-preview"}
HEX = set("0123456789abcdef")

def validate(data, root):
    errors = []
    if not isinstance(data, dict) or not isinstance(data.get("samples"), list):
        return ["manifest must contain a samples array"]
    if not data["samples"]:
        return ["manifest must contain at least one sample"]
    seen_files = set()
    for i, sample in enumerate(data["samples"]):
        p = f"samples[{i}]"
        if not isinstance(sample, dict):
            errors.append(f"{p}: must be an object")
            continue
        if sample.get("camera") not in {"Nikon Z8", "Nikon Z5II"}:
            errors.append(f"{p}: unsupported camera label")
        if sample.get("mode") not in MODES:
            errors.append(f"{p}: unknown compression mode")
        if sample.get("source") not in SOURCES:
            errors.append(f"{p}: unknown provenance")
        for key in ("width", "height", "bit_depth"):
            value = sample.get(key)
            if type(value) is not int or value <= 0 or (key == "bit_depth" and value > 32):
                errors.append(f"{p}: invalid {key}")
        name, digest = sample.get("file"), sample.get("sha256")
        if not isinstance(name, str) or not name or Path(name).is_absolute() or ".." in Path(name).parts:
            errors.append(f"{p}: unsafe file path")
            continue
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in HEX for c in digest):
            errors.append(f"{p}: invalid sha256")
            continue
        if "\\" in name or Path(name).name != name:
            errors.append(f"{p}: unsafe or non-portable fixture filename")
            continue
        if name.casefold() in seen_files:
            errors.append(f"{p}: duplicate fixture filename")
            continue
        seen_files.add(name.casefold())
        path = (root / name).resolve()
        if not path.is_relative_to(root.resolve()) or not path.is_file():
            errors.append(f"{p}: missing or escaped fixture")
            continue
        h = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        if h.hexdigest() != digest:
            errors.append(f"{p}: sha256 mismatch")
        if sample.get("sensor_decode_verified") is True:
            if sample.get("source") != "sensor-cfa":
                errors.append(f"{p}: preview/render cannot be verified sensor decode")
            if not sample.get("decoder") or not sample.get("reference_evidence"):
                errors.append(f"{p}: verified sensor decode needs decoder and reference evidence")
        if sample.get("nx_studio_parity") is True:
            errors.append(f"{p}: unqualified NX Studio parity claim prohibited; record measurements separately")
    return errors

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    data = json.loads(args.manifest.read_text(encoding="utf-8"))
    errors = validate(data, args.manifest.parent)
    for error in errors:
        print("FAIL:", error)
    if not errors:
        print("PASS: manifest structure and file hashes only; RAW decoding/colour NOT VERIFIED")
    return bool(errors)

if __name__ == "__main__":
    raise SystemExit(main())
