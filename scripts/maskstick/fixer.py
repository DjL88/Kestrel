#!/usr/bin/env python3
"""A small local paint-and-save helper for fixing subject masks by hand. Not part of the app, no dependencies beyond Pillow.

    cd scripts && python3 -m maskstick.fixer \
        --manifest ~/code/kestrel-test-photos/maskstick/heldout.json \
        --proposals shipped=~/code/kestrel-test-photos/maskstick/proposals/shipped \
        --proposals matte=~/code/kestrel-test-photos/maskstick/proposals/matte \
        --gt ~/code/kestrel-test-photos/maskstick/gt

then open http://127.0.0.1:8765 in a browser. It serves the photos from your own disk to your own browser on the loopback
address only (nothing is sent anywhere), starts each photo from one source's mask (chosen by a fixed hash of the key and
not shown, so no source gets an unfair head start; the choice is saved in the .json beside each mask), lets you paint
subject / background / "can't tell" (the uncertain edge band, ignored when scoring) and saves <key>.png (255 subject, 128
uncertain, 0 background) plus <key>.json (status, start source, active seconds, strokes) into --gt.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
from PIL import Image

MAX_BODY = 25 * 1024 * 1024
KEY = re.compile(r"^[0-9a-f]{20}_[0-9a-f]{20}$|^[A-Za-z0-9_.()-]{1,120}$")


def read_json(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def read_bytes(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()


def pick_start(key: str, available: list[str]) -> str | None:
    """Which source a photo's starting mask comes from: a fixed hash of the key over the sources that have a mask for it."""
    if not available:
        return None
    available = sorted(available)
    return available[int(hashlib.sha256(("start:" + key).encode()).hexdigest(), 16) % len(available)]


class State:
    def __init__(self, manifest: str, proposals: dict[str, str], gt_dir: str, previews: str | None = None):
        with open(manifest) as f:
            data = json.load(f)
        self.keys = [p["key"] for p in data["photos"]]
        self.previews = previews or data["previews"]
        self.suffix = data.get("suffix", "_raw")
        self.proposals = proposals
        self.gt_dir = gt_dir
        os.makedirs(gt_dir, exist_ok=True)

    def preview_path(self, key: str) -> str:
        return os.path.join(self.previews, key + self.suffix + ".jpg")

    def start_source(self, key: str) -> str | None:
        have = [n for n, d in self.proposals.items() if os.path.exists(os.path.join(d, key + ".png"))]
        return pick_start(key, have)

    def queue(self) -> list[dict]:
        out = []
        for key in self.keys:
            meta_path = os.path.join(self.gt_dir, key + ".json")
            meta = read_json(meta_path) if os.path.exists(meta_path) else {}
            out.append({"key": key, "done": bool(meta), "status": meta.get("status")})
        return out

    def save(self, key: str, png: bytes, seconds: float, strokes: int, status: str) -> None:
        with Image.open(io.BytesIO(png)) as im:
            with Image.open(self.preview_path(key)) as photo:
                expected = photo.size
            if im.size != expected:
                raise ValueError(f"mask is {im.size}, photo is {expected}")
            grey = np.asarray(im.convert("RGBA"))[..., 0]
        # Three labels only: anything near 255 is subject, near 128 is "can't tell", the rest background.
        label = np.where(grey >= 192, 255, np.where(grey >= 65, 128, 0)).astype(np.uint8)
        Image.fromarray(label).save(os.path.join(self.gt_dir, key + ".png"))
        meta = {"status": status, "start_source": self.start_source(key), "seconds": round(seconds, 1), "strokes": strokes,
                "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "tool": "maskstick-fixer-1"}
        with open(os.path.join(self.gt_dir, key + ".json"), "w") as f:
            json.dump(meta, f, indent=1)


def handler(state: State, page: bytes):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):  # keep the terminal quiet
            pass

        def send(self, code: int, body: bytes, kind: str, extra: dict | None = None):
            self.send_response(code)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def key_of(self, name: str) -> str | None:
            return name if name in state.keys else None

        def do_GET(self):
            path = urlparse(self.path).path
            if path == "/":
                return self.send(200, page, "text/html; charset=utf-8")
            if path == "/api/queue":
                return self.send(200, json.dumps(state.queue()).encode(), "application/json")
            kind, _, name = path.strip("/").partition("/")
            key = self.key_of(name)
            if key is None:
                return self.send(404, b"not found", "text/plain")
            if kind == "photo":
                return self.send(200, read_bytes(state.preview_path(key)), "image/jpeg")
            if kind == "gt":
                p = os.path.join(state.gt_dir, key + ".png")
                if os.path.exists(p):
                    return self.send(200, read_bytes(p), "image/png")
                return self.send(404, b"none", "text/plain")
            if kind == "proposal":
                source = state.start_source(key)
                if source is None:
                    return self.send(404, b"none", "text/plain")
                return self.send(200, read_bytes(os.path.join(state.proposals[source], key + ".png")), "image/png")
            return self.send(404, b"not found", "text/plain")

        def do_POST(self):
            url = urlparse(self.path)
            kind, _, name = url.path.strip("/").partition("/")
            key = self.key_of(name)
            length = int(self.headers.get("Content-Length", "0"))
            if kind != "save" or key is None or length <= 0 or length > MAX_BODY:
                return self.send(400, b"bad request", "text/plain")
            q = parse_qs(url.query)
            try:
                status = q.get("status", ["ok"])[0]
                if status not in ("ok", "skip"):
                    raise ValueError("status")
                state.save(key, self.rfile.read(length), float(q.get("seconds", ["0"])[0]), int(q.get("strokes", ["0"])[0]), status)
            except Exception as e:  # report to the page, never crash the server
                return self.send(400, str(e).encode(), "text/plain")
            return self.send(200, b"saved", "text/plain")

    return H


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--proposals", action="append", default=[], metavar="NAME=DIR")
    ap.add_argument("--gt", required=True)
    ap.add_argument("--previews", help="override the previews folder named in the manifest")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args(argv)
    proposals = {}
    for spec in a.proposals:
        name, _, folder = spec.partition("=")
        proposals[name] = os.path.expanduser(folder)
    state = State(os.path.expanduser(a.manifest), proposals, os.path.expanduser(a.gt), a.previews and os.path.expanduser(a.previews))
    page = read_bytes(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixer.html"))
    server = ThreadingHTTPServer(("127.0.0.1", a.port), handler(state, page))
    print(f"Mask fixer on http://127.0.0.1:{a.port}  ({len(state.keys)} photos, saving to {a.gt}). Ctrl-C to stop.", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
