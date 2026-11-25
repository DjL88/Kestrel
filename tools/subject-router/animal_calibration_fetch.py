"""Fetch a small, lawfully licensed calibration set of animals from Wikimedia Commons (thumbnails only, never committed).

    python tools/subject-router/animal_calibration_fetch.py <folder outside the repo>

Used to record the category gate before and after a new animal route (reptiles, amphibians, insects), with birds,
mammals and aircraft as controls that must not change. Only public domain, CC0 and CC BY files are kept (no ShareAlike,
no NonCommercial), with each file's title, licence and Commons page in manifest.json beside them.
"""
import json, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

UA = {"User-Agent": "KestrelCalibration/0.1 (offline model calibration)"}
PER_CATEGORY = 6


def allowed(licence: str) -> bool:
    text = licence.lower()
    if "-sa" in text or " sa" in text or "nc" in text.replace("cc0", ""):
        return False
    return text.startswith(("public domain", "pd", "cc0", "cc by", "cc-by"))


# (kind expected from the gate, Commons category)
SETS = [
    ("frog", "Rana temporaria"), ("frog", "Pelophylax ridibundus"),
    ("toad", "Bufo bufo"), ("toad", "Epidalea calamita"),
    ("newt", "Lissotriton vulgaris"), ("newt", "Triturus cristatus"),
    ("lizard", "Lacerta agilis"), ("lizard", "Podarcis muralis"),
    ("snake", "Natrix natrix"), ("snake", "Vipera berus"),
    ("tortoise", "Testudo hermanni"), ("tortoise", "Trachemys scripta elegans"),
    ("dragonfly", "Anax imperator"), ("dragonfly", "Sympetrum striolatum"), ("dragonfly", "Aeshna cyanea"), ("dragonfly", "Libellula depressa"),
    ("damselfly", "Calopteryx virgo"), ("damselfly", "Ischnura elegans"),
    ("butterfly", "Vanessa atalanta"), ("butterfly", "Aglais io"),
    ("moth", "Tyria jacobaeae"), ("moth", "Autographa gamma"),
    ("beetle", "Coccinella septempunctata"), ("beetle", "Lucanus cervus"),
    ("control-bird", "Erithacus rubecula"), ("control-bird", "Cinclus cinclus"),
    ("control-mammal", "Vulpes vulpes"), ("control-mammal", "Sciurus vulgaris"), ("control-mammal", "Capreolus capreolus"),
    ("control-aircraft", "Eurofighter Typhoon of the Royal Air Force"), ("control-aircraft", "Eurofighter Typhoon in flight"), ("control-aircraft", "Airbus A320 of easyJet"),
]


def get(url):
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code != 429:
                raise
            time.sleep(20 * (attempt + 1))
    raise RuntimeError("rate limited")


def api(params):
    return json.loads(get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({**params, "format": "json"})))


if __name__ == '__main__':
    OUT = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    old = json.loads((OUT / "manifest.json").read_text()) if (OUT / "manifest.json").exists() else []
    manifest = [m for m in old if (OUT / m["file"]).exists()]
    done = {m["file"] for m in manifest}
    for kind, category in SETS:
        if sum(1 for m in manifest if m.get("category") == category) >= PER_CATEGORY:
            continue
        data = api({"action": "query", "generator": "categorymembers", "gcmtitle": "Category:" + category, "gcmtype": "file",
                    "gcmlimit": 60, "prop": "imageinfo", "iiprop": "url|extmetadata|mime", "iiurlwidth": 448})
        pages = list((data.get("query") or {}).get("pages", {}).values())
        kept = 0
        for page in pages:
            info = (page.get("imageinfo") or [{}])[0]
            if info.get("mime") not in ("image/jpeg", "image/png"):
                continue
            licence = ((info.get("extmetadata") or {}).get("LicenseShortName") or {}).get("value", "")
            if not allowed(licence):
                continue
            name = f"{kind}__{page['pageid']}.jpg"
            if name in done:
                continue
            try:
                (OUT / name).write_bytes(get(info["thumburl"]))
            except Exception as error:  # noqa: BLE001
                print("skip", name, error)
                continue
            manifest.append({"file": name, "kind": kind, "title": page["title"], "licence": licence, "source": info.get("descriptionurl"), "category": category})
            (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
            kept += 1
            if kept >= PER_CATEGORY:
                break
            time.sleep(1.5)
        print(f"{category}: {kept} of {len(pages)}")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(len(manifest), "images")
