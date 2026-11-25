"""Fetch a small, lawfully licensed calibration set from Wikimedia Commons (thumbnails only, never committed)."""
import json, sys, time, urllib.parse, urllib.request
from pathlib import Path

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "KestrelCalibration/0.1 (offline model calibration)"}
OK = ("public domain", "pd", "cc0", "cc by", "cc-by", "ogl")

# (kind, type or "", Commons category)
SETS = [
    ("military-jet", "typhoon", "Eurofighter Typhoon of the Royal Air Force"),
    ("military-jet", "f-35", "Lockheed Martin F-35B Lightning II"),
    ("military-jet", "f-15", "McDonnell Douglas F-15E Strike Eagle"),
    ("military-jet", "hawk", "BAE Systems Hawk T2"),
    ("military-jet", "hawk", "Red Arrows"),
    ("military-jet", "f-16", "General Dynamics F-16 Fighting Falcon in flight"),
    ("military-transport", "a400m", "Airbus A400M Atlas of the Royal Air Force"),
    ("military-transport", "c-130", "Lockheed C-130J Hercules of the Royal Air Force"),
    ("military-transport", "c-17", "Boeing C-17 Globemaster III in flight"),
    ("helicopter", "chinook", "Boeing CH-47 Chinook of the Royal Air Force"),
    ("helicopter", "apache", "AgustaWestland Apache"),
    ("helicopter", "h135-h145", "Eurocopter EC135 air ambulances"),
    ("airliner", "a320", "Airbus A320 of easyJet"),
    ("airliner", "b737", "Boeing 737-800 of Ryanair"),
    ("airliner", "b747", "Boeing 747-400 of British Airways"),
    ("airliner", "a380", "Airbus A380 of Emirates"),
    ("light-aircraft", "cessna-high-wing", "Cessna 172 in flight"),
    ("light-aircraft", "spitfire", "Supermarine Spitfire in flight"),
    ("glider", "", "Gliders in flight"),
    ("drone", "", "DJI Phantom 4"),
    ("balloon", "", "Hot air balloons in flight"),
    ("car", "vw-golf", "Volkswagen Golf VII"),
    ("car", "ford-fiesta", "Ford Fiesta Mk7"),
    ("car", "defender", "Land Rover Defender 90"),
    ("car", "mini", "Mini Hatch (F56)"),
    ("motorbike", "", "Motorcycle racing"),
    ("lorry", "", "Scania R-series trucks"),
    ("bus", "", "New Routemaster"),
    ("train", "", "British Rail Class 800"),
    ("tram", "", "Manchester Metrolink trams"),
    ("boat", "", "RNLI lifeboats"),
]


def get(url):
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code != 429: raise
            time.sleep(20 * (attempt + 1))
    raise RuntimeError("rate limited")


def api(params):
    return json.loads(get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({**params, "format": "json"})))


import urllib.error
old = json.loads((OUT / "manifest.json").read_text()) if (OUT / "manifest.json").exists() else []
manifest = [m for m in old if (OUT / m["file"]).exists()]
done = {m["file"] for m in manifest}
for kind, vtype, category in SETS:
    if sum(1 for m in manifest if m.get("category") == category) >= 8: continue
    data = api({"action": "query", "generator": "categorymembers", "gcmtitle": "Category:" + category, "gcmtype": "file",
                "gcmlimit": 30, "prop": "imageinfo", "iiprop": "url|extmetadata|mime", "iiurlwidth": 448})
    pages = list((data.get("query") or {}).get("pages", {}).values())
    if not pages:
        data = api({"action": "query", "generator": "search", "gsrsearch": category.replace(" of the Royal Air Force", " RAF") + " filetype:bitmap", "gsrnamespace": 6,
                    "gsrlimit": 30, "prop": "imageinfo", "iiprop": "url|extmetadata|mime", "iiurlwidth": 448})
        pages = list((data.get("query") or {}).get("pages", {}).values())
    kept = 0
    for page in pages:
        info = (page.get("imageinfo") or [{}])[0]
        if info.get("mime") not in ("image/jpeg", "image/png"):
            continue
        licence = ((info.get("extmetadata") or {}).get("LicenseShortName") or {}).get("value", "")
        if not licence.lower().startswith(OK):
            continue
        name = f"{kind}__{vtype or 'none'}__{page['pageid']}.jpg"
        if name in done: continue
        try:
            (OUT / name).write_bytes(get(info["thumburl"]))
        except Exception as error:  # noqa: BLE001
            print("skip", name, error)
            continue
        manifest.append({"file": name, "kind": kind, "type": vtype, "title": page["title"], "licence": licence, "source": info.get("descriptionurl"), "category": category})
        (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
        kept += 1
        if kept >= 8:
            break
        time.sleep(1.5)
    print(f"{category}: {kept} of {len(pages)}")
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
print(len(manifest), "images")
