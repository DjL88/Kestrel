"""Fetch the species-naming benchmark: about 10 Wikimedia Commons thumbnails each of 50 commonly photographed UK and
European species (public domain, CC0 and CC BY only; never committed). Owner approved, 25 Nov 2026.

    python tools/species/benchmark_fetch.py <folder outside the repo>

Each file's expected species, title, licence and Commons page go in manifest.json beside it. Files already in the gate
calibration set are fine to repeat: this set is scored by species, not by gate route.
"""
import json, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'subject-router'))
from animal_calibration_fetch import allowed, api, get  # noqa: E402  (same licence filter and polite Commons client)

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
PER_SPECIES = 10

# (group, scientific name = Commons category)
SPECIES = [(g, s) for g, names in {
    'bird': ['Erithacus rubecula', 'Turdus merula', 'Parus major', 'Cyanistes caeruleus', 'Fringilla coelebs', 'Passer domesticus',
             'Sturnus vulgaris', 'Pica pica', 'Corvus corone', 'Columba palumbus', 'Ardea cinerea', 'Anas platyrhynchos', 'Cygnus olor',
             'Buteo buteo', 'Falco tinnunculus', 'Milvus milvus', 'Alcedo atthis', 'Cinclus cinclus', 'Troglodytes troglodytes', 'Strix aluco'],
    'mammal': ['Vulpes vulpes', 'Sciurus vulgaris', 'Sciurus carolinensis', 'Capreolus capreolus', 'Cervus elaphus', 'Dama dama',
               'Meles meles', 'Lutra lutra', 'Erinaceus europaeus', 'Lepus europaeus'],
    'reptile': ['Lacerta agilis', 'Zootoca vivipara', 'Anguis fragilis', 'Natrix natrix', 'Vipera berus'],
    'amphibian': ['Bufo bufo', 'Rana temporaria', 'Lissotriton vulgaris'],
    'insect': ['Vanessa atalanta', 'Aglais io', 'Aglais urticae', 'Pieris brassicae', 'Gonepteryx rhamni', 'Polyommatus icarus',
               'Tyria jacobaeae', 'Macroglossum stellatarum', 'Anax imperator', 'Sympetrum striolatum', 'Calopteryx splendens', 'Ischnura elegans'],
}.items() for s in names]


def files_in(category, depth=0):
    """Direct image files of a Commons category, then those of its subcategories (one level), until there are enough."""
    pages = list((api({'action': 'query', 'generator': 'categorymembers', 'gcmtitle': 'Category:' + category, 'gcmtype': 'file',
                       'gcmlimit': 80, 'prop': 'imageinfo', 'iiprop': 'url|extmetadata|mime', 'iiurlwidth': 448}).get('query') or {}).get('pages', {}).values())
    if depth == 0 and len(pages) < 40:
        subs = (api({'action': 'query', 'list': 'categorymembers', 'cmtitle': 'Category:' + category, 'cmtype': 'subcat', 'cmlimit': 15}).get('query') or {}).get('categorymembers', [])
        for sub in subs:
            pages += files_in(sub['title'].removeprefix('Category:'), 1)
            if len(pages) >= 80:
                break
    return pages


old = json.loads((OUT / 'manifest.json').read_text()) if (OUT / 'manifest.json').exists() else []
manifest = [m for m in old if (OUT / m['file']).exists()]
done = {m['file'] for m in manifest}
for group, scientific in SPECIES:
    have = sum(1 for m in manifest if m['scientific'] == scientific)
    if have >= PER_SPECIES:
        continue
    kept = 0
    for page in files_in(scientific):
        info = (page.get('imageinfo') or [{}])[0]
        if info.get('mime') not in ('image/jpeg', 'image/png'):
            continue
        licence = ((info.get('extmetadata') or {}).get('LicenseShortName') or {}).get('value', '')
        if not allowed(licence):
            continue
        name = f"{scientific.replace(' ', '_')}__{page['pageid']}.jpg"
        if name in done:
            continue
        try:
            (OUT / name).write_bytes(get(info['thumburl']))
        except Exception as error:  # noqa: BLE001
            print('skip', name, error)
            continue
        done.add(name)
        manifest.append({'file': name, 'group': group, 'scientific': scientific, 'title': page['title'], 'licence': licence, 'source': info.get('descriptionurl')})
        (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=1), encoding='utf-8')
        kept += 1
        if have + kept >= PER_SPECIES:
            break
        time.sleep(1.2)
    print(f'{scientific}: {have + kept}')
print(len(manifest), 'images')
