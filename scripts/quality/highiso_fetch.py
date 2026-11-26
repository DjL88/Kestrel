"""Download the open-licence Commons frames listed in highiso-commons.json (x-uat-highiso pre-check).

    python scripts/quality/highiso_fetch.py <out folder>

Honours Wikimedia's Retry-After, one file at a time. Files land in <out>/real and <out>/clean; nothing is committed.
"""
import json, re, sys, time, urllib.error, urllib.request
from pathlib import Path

UA = {'User-Agent': 'KestrelBenchmark/0.1 (https://github.com/DjL88/Kestrel; offline quality calibration) python-urllib'}
listing = json.loads((Path(__file__).parent / 'highiso-commons.json').read_text(encoding='utf-8'))
out = Path(sys.argv[1])
for group in ('real', 'clean'):
    (out / group).mkdir(parents=True, exist_ok=True)
    for item in listing[group]:
        target = out / group / re.sub(r'[^A-Za-z0-9._-]+', '_', item['title'][5:])[:90]
        if target.exists() and target.stat().st_size > 10000:
            continue
        for attempt in range(10):
            try:
                with urllib.request.urlopen(urllib.request.Request(item['url'], headers=UA), timeout=120) as response:
                    target.write_bytes(response.read())
                print('ok', group, target.name, flush=True)
                break
            except urllib.error.HTTPError as error:
                wait = int(error.headers.get('Retry-After') or 30)
                print('http', error.code, 'waiting', wait, flush=True)
                time.sleep(wait + 5)
        time.sleep(3)
