"""Tests acquire.py against a local server: verification, resume, tamper refusal, and idempotent reruns."""
import hashlib, http.server, json, tempfile, threading, unittest
from pathlib import Path
import acquire

PAYLOAD = bytes(range(256)) * 4000          # ~1 MB
SMALL = b'{"ok": true}\n'

def blob_id(data: bytes) -> str:
    return hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()

class Handler(http.server.BaseHTTPRequestHandler):
    tamper = False
    hits = 0
    def log_message(self, *args): pass
    def do_GET(self):
        Handler.hits += 1
        data = SMALL if self.path.endswith('config.json') else PAYLOAD
        if Handler.tamper and not self.path.endswith('config.json'):
            data = b'X' + data[1:]
        start = 0
        if 'Range' in self.headers:
            start = int(self.headers['Range'].split('=')[1].rstrip('-'))
        body = data[start:]
        self.send_response(206 if start else 200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

class AcquireTest(unittest.TestCase):
    def setUp(self):
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        Handler.tamper = False; Handler.hits = 0
        self.tmp = Path(tempfile.mkdtemp())
        self.model = {'repo': 'x/y', 'revision': 'a' * 40, 'license': 'apache-2.0', 'licenseSource': 'test', 'url': 'u', 'role': 'r', 'files': [
            {'path': 'config.json', 'bytes': len(SMALL), 'gitBlob': blob_id(SMALL)},
            {'path': 'onnx/m_int8.onnx', 'bytes': len(PAYLOAD), 'sha256': hashlib.sha256(PAYLOAD).hexdigest()},
            {'path': 'onnx/m_q4.onnx', 'bytes': len(PAYLOAD), 'sha256': hashlib.sha256(PAYLOAD).hexdigest()}]}
        self.base = f'http://127.0.0.1:{self.server.server_address[1]}'
    def tearDown(self): self.server.shutdown()

    def test_installs_only_the_requested_quantisation_and_writes_the_notice(self):
        done = acquire.fetch_model('m', self.model, self.tmp, ['int8'], self.base)
        self.assertEqual(sorted(done), ['config.json', 'onnx/m_int8.onnx'])
        root = self.tmp / 'm' / ('a' * 12)
        self.assertFalse((root / 'onnx/m_q4.onnx').exists())
        self.assertIn('apache-2.0', (root / 'NOTICE.txt').read_text())

    def test_a_tampered_download_is_refused_and_leaves_nothing_behind(self):
        Handler.tamper = True
        with self.assertRaises(SystemExit):
            acquire.fetch_model('m', self.model, self.tmp, ['int8'], self.base)
        root = self.tmp / 'm' / ('a' * 12)
        self.assertFalse((root / 'onnx/m_int8.onnx').exists())
        self.assertFalse((root / 'onnx/m_int8.onnx.part').exists())

    def test_an_interrupted_download_resumes_and_still_verifies(self):
        root = self.tmp / 'm' / ('a' * 12) / 'onnx'; root.mkdir(parents=True)
        (root / 'm_int8.onnx.part').write_bytes(PAYLOAD[:300_000])
        acquire.fetch_model('m', self.model, self.tmp, ['int8'], self.base)
        self.assertEqual((root / 'm_int8.onnx').read_bytes(), PAYLOAD)

    def test_a_rerun_downloads_nothing_when_everything_already_verifies(self):
        acquire.fetch_model('m', self.model, self.tmp, ['int8'], self.base)
        before = Handler.hits
        acquire.fetch_model('m', self.model, self.tmp, ['int8'], self.base)
        self.assertEqual(Handler.hits, before)

    def test_a_corrupt_existing_file_is_replaced_not_trusted(self):
        acquire.fetch_model('m', self.model, self.tmp, ['int8'], self.base)
        target = self.tmp / 'm' / ('a' * 12) / 'onnx/m_int8.onnx'
        target.write_bytes(PAYLOAD[:-1] + b'Z')
        acquire.fetch_model('m', self.model, self.tmp, ['int8'], self.base)
        self.assertEqual(target.read_bytes(), PAYLOAD)

    def test_the_real_manifest_is_well_formed(self):
        manifest = json.loads((Path(__file__).parent / 'manifest.json').read_text())
        for key, model in manifest['models'].items():
            self.assertRegex(model['revision'], r'^[0-9a-f]{40}$', key)
            self.assertIn(model['license'], {'apache-2.0', 'mit'}, key)
            for entry in model['files']:
                self.assertTrue(('sha256' in entry) != ('gitBlob' in entry), entry['path'])
                if 'sha256' in entry:
                    self.assertRegex(entry['sha256'], r'^[0-9a-f]{64}$')

if __name__ == '__main__':
    unittest.main()
