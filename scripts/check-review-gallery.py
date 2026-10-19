#!/usr/bin/env python3
"""Small regression check for byte ranges and text-only review evidence."""
from functools import partial
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import Thread


def load(name):
    spec = spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


serve = load('serve-review-gallery')
builder = load('build-review-gallery')
with TemporaryDirectory(prefix='puptime-gallery-check-') as folder:
    root = Path(folder)
    payload = bytes(range(256)) * 40
    (root / 'clip.mp4').write_bytes(payload)
    handler = partial(serve.ReviewHandler, directory=folder)
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        for value, expected_status, expected_body, expected_range in [
            (None, 200, payload, None),
            ('bytes=1000-1031', 206, payload[1000:1032], 'bytes 1000-1031/10240'),
            ('bytes=10230-', 206, payload[10230:], 'bytes 10230-10239/10240'),
            ('bytes=-20', 206, payload[-20:], 'bytes 10220-10239/10240'),
            ('bytes=10230-99999', 206, payload[10230:], 'bytes 10230-10239/10240'),
            ('bytes=10240-', 416, b'', 'bytes */10240'),
            ('bytes=20-10', 416, b'', 'bytes */10240'),
            ('bytes=-0', 416, b'', 'bytes */10240'),
            ('bytes=0-1,5-6', 200, payload, None),
            ('garbage', 200, payload, None),
        ]:
            connection = HTTPConnection('127.0.0.1', server.server_port)
            connection.request('GET', '/clip.mp4', headers={'Range': value} if value else {})
            response = connection.getresponse()
            assert response.status == expected_status, (value, response.status)
            assert response.getheader('Accept-Ranges') == 'bytes'
            assert response.getheader('Content-Range') == expected_range
            assert response.read() == expected_body, value
            connection.close()
        connection = HTTPConnection('127.0.0.1', server.server_port)
        connection.request('HEAD', '/clip.mp4', headers={'Range': 'bytes=10-19'})
        response = connection.getresponse()
        assert response.status == 206 and response.getheader('Content-Length') == '10'
        assert response.read() == b''
        connection.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    recording = Path(__file__).with_name('record-test-review.py')
    result = subprocess.run([sys.executable, str(recording), str(root / '999-result.mp4'),
        'Actual failed check', 'Fixture only', '--', sys.executable, '-c',
        'print("unique searchable output <script>"); raise SystemExit(7)'], capture_output=True, text=True)
    assert result.returncode == 7 and not (root / '999-result.mp4').exists()
    metadata = json.loads((root / '999-result.json').read_text())
    assert metadata['exit_code'] == 7 and metadata['log'] == '999-result.log' and 'video' not in metadata
    legacy = {**metadata, 'title': 'Old terminal replay', 'rendered_actual_output': True, 'video': 'old-terminal.mp4'}
    (root / '998-legacy.json').write_text(json.dumps(legacy))
    (root / 'review.png').write_bytes(b'fixture image')
    native = {**metadata, 'title': 'Actual app', 'video': 'clip.mp4',
        'capture_kind': 'Actual local browser recording',
        'screenshots': [{'file': 'review.png', 'title': 'Synthetic account <fixture>'}]}
    (root / '997-app.json').write_text(json.dumps(native))
    builder.build(root)
    page = (root / 'index.html').read_text()
    assert 'unique searchable output &lt;script&gt;' in page
    assert 'src="old-terminal.mp4"' not in page
    assert page.count('<video ') == 1
    assert 'id="search-results"' in page
    assert 'Actual local browser recording' in page and 'Actual iOS recording' not in page
    assert 'alt="Synthetic account &lt;fixture&gt;"' in page and 'href="review.png"' in page
    (root / 'clip.mp4').unlink()
    builder.build(root)
    page = (root / 'index.html').read_text()
    assert '<video ' not in page and page.count('class="result"') == 3
print('PASS: full/single/suffix/unsatisfiable/HEAD ranges; text recorder exit status; no terminal video; searchable escaped logs.')
