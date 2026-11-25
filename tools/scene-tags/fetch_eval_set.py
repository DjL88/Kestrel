#!/usr/bin/env python3
"""Fetch a small, openly licensed evaluation set from Wikimedia Commons to measure the scene tags' thresholds.

    python -I tools/scene-tags/fetch_eval_set.py <empty output folder> [per tag, default 40]

Only files whose licence is CC0, public domain, CC BY or CC BY-SA are kept; each one's title, author, licence and
source page go into <folder>/manifest.json, which is what the results cite. The pictures themselves are never committed:
they are small thumbnails (320 px) kept in the folder you name, outside the repository. Positives for a tag come from
human-curated Commons categories (and their sub-categories); 'background' is a random sample of Quality images, so
every tag is also measured against ordinary photos it should not fire on.
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://commons.wikimedia.org/w/api.php"
AGENT = "InFlight-scene-tag-eval/1.0 (offline threshold measurement; one request at a time)"
LICENCES = re.compile(r"^(CC0|Public domain|PD\b|CC BY(-SA)? \d|CC BY(-SA)?$)", re.I)

# Tag id -> Commons categories searched with deepcategory (sub-categories included). Chosen by hand.
CATEGORIES: dict[str, list[str]] = {
    "light.backlit": ["Backlighting"],
    "light.silhouette": ["Photographic silhouettes of people against sunsets", "Silhouettes of people"],
    "light.moon": ["Photographs of the Moon", "Full moons"],
    "light.milky-way": ["Milky Way Galaxy and a place on Earth", "Milky Way Galaxy"],
    "weather.fog": ["Fog", "Mist"],
    "weather.rain": ["Rain", "Rainy days"],
    "weather.snow": ["Snowy landscapes", "Snowfall"],
    "weather.overcast": ["Overcast", "Overcast skies"],
    "weather.clear": ["Blue sky"],
    "style.minimalist": ["Minimalism in photography", "Minimalist photography"],
    "style.panning-blur": ["Panning"],
    "style.motion-blur": ["Motion blur", "Long exposure photography"],
    "style.shallow-dof": ["Shallow depth of field", "Bokeh"],
    "genre.wildlife": ["Quality images of mammals", "Mammals in the wild"],
    "genre.birds": ["Quality images of birds", "Birds in flight"],
    "genre.aviation": ["Quality images of aircraft", "Aircraft in flight"],
    "genre.motorsport": ["Auto racing", "Motorcycle racing"],
    "genre.landscape": ["Quality images of landscapes", "Mountain landscapes"],
    "genre.portrait": ["Portrait photographs", "Quality images of portraits"],
    "genre.sport": ["Association football matches", "Athletics competitions", "Cycle races"],
    "genre.street": ["Street photography"],
    "genre.macro": ["Macro photographs of insects", "Macro photography"],
    "genre.astro": ["Astrophotography", "Star trails"],
    "genre.documentary": ["Photojournalism", "People at work"],
    "background": ["Quality images"],
}


def get(params: dict[str, str]) -> dict:
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    request = urllib.request.Request(url, headers={"User-Agent": AGENT})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as error:  # noqa: BLE001 - network: retry slowly, then give up on this query
            if attempt == 3:
                print(f"  failed: {error}")
                return {}
            time.sleep(5 * (attempt + 1))
    return {}


def search(category: str, limit: int) -> list[str]:
    data = get({"action": "query", "list": "search", "srnamespace": "6", "srlimit": str(min(limit, 500)), "srsort": "random",
                "srsearch": f'filetype:bitmap deepcategory:"{category}"'})
    hits = [hit["title"] for hit in data.get("query", {}).get("search", [])]
    if not hits:
        data = get({"action": "query", "list": "search", "srnamespace": "6", "srlimit": str(min(limit, 500)), "srsort": "random",
                    "srsearch": f'filetype:bitmap incategory:"{category}"'})
        hits = [hit["title"] for hit in data.get("query", {}).get("search", [])]
    return hits


def info(titles: list[str]) -> list[dict]:
    out = []
    for start in range(0, len(titles), 40):
        data = get({"action": "query", "prop": "imageinfo", "iiprop": "url|extmetadata|mime", "iiurlwidth": "320",
                    "titles": "|".join(titles[start:start + 40])})
        for page in data.get("query", {}).get("pages", []):
            image = (page.get("imageinfo") or [{}])[0]
            meta = image.get("extmetadata", {})
            licence = meta.get("LicenseShortName", {}).get("value", "")
            if image.get("mime") not in ("image/jpeg", "image/png") or not LICENCES.search(licence.strip()):
                continue
            artist = re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", "")).strip()[:200]
            out.append({"title": page["title"], "thumb": image.get("thumburl"), "page": image.get("descriptionurl"),
                        "licence": licence, "author": artist})
        time.sleep(1)
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    folder = Path(sys.argv[1])
    per_tag = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    folder.mkdir(parents=True, exist_ok=True)
    manifest_path = folder / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"files": []}
    have = {entry["title"] for entry in manifest["files"]}
    for tag, categories in CATEGORIES.items():
        want = per_tag * (4 if tag == "background" else 1)
        count = sum(1 for entry in manifest["files"] if entry["tag"] == tag)
        for category in categories:
            if count >= want:
                break
            titles = [title for title in search(category, want * 3) if title not in have]
            print(f"{tag}: {category}: {len(titles)} candidates")
            time.sleep(1)
            for entry in info(titles):
                if count >= want or not entry["thumb"]:
                    break
                name = f"{len(manifest['files']):05d}.jpg"
                request = urllib.request.Request(entry["thumb"], headers={"User-Agent": AGENT})
                try:
                    with urllib.request.urlopen(request, timeout=60) as response:
                        (folder / name).write_bytes(response.read())
                except Exception as error:  # noqa: BLE001
                    print(f"  skipped {entry['title']}: {error}")
                    continue
                manifest["files"].append({**entry, "tag": tag, "category": category, "file": name})
                have.add(entry["title"])
                count += 1
                time.sleep(0.3)
        print(f"{tag}: {count} kept")
        manifest_path.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
