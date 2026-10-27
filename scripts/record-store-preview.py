#!/usr/bin/env python3
"""Record fastlane/capture.yaml on a dedicated store simulator. Requires Maestro.

Usage: python3 scripts/record-store-preview.py UDID NEW_CAPTURE_DIRECTORY
Then: python3 scripts/edit-store-preview.py NEW_CAPTURE_DIRECTORY/recording.json
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

udid, directory = sys.argv[1:]
devices = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', 'available', '-j']))
assert any(d['udid'] == udid and d['name'] == 'Puptime 459e App Store iPhone' for group in devices['devices'].values() for d in group)
destination = Path(directory).expanduser().resolve()
destination.mkdir(parents=True, exist_ok=False)
raw = destination / 'preview.raw.mov'
recorder = subprocess.Popen(['xcrun', 'simctl', 'io', udid, 'recordVideo', '--codec=h264', str(raw)], stderr=subprocess.PIPE, text=True)
while 'Recording started' not in recorder.stderr.readline():
    if recorder.poll() is not None: raise RuntimeError('Native recording failed')
try:
    subprocess.run(['maestro', '--device', udid, 'test', 'fastlane/capture.yaml', '--test-output-dir', str(destination)],
                   check=True, env={**os.environ, 'MAESTRO_CLI_NO_ANALYTICS': '1'})
finally:
    stopped = time.time()
    recorder.send_signal(signal.SIGINT)
    recorder.wait(timeout=30)
(destination / 'recording.json').write_text(json.dumps(dict(raw=str(raw), root=str(destination), end=stopped), indent=2) + '\n')
print('Recorded native footage:', raw)
