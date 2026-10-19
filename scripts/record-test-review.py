#!/usr/bin/env python3
"""Capture a credential-free CLI check as searchable text, never a video.

Usage: python record-test-review.py OUTPUT.log TITLE SCOPE -- COMMAND ARGS...
Legacy OUTPUT.mp4 arguments also produce OUTPUT.log and OUTPUT.json only.
Never pass a command that prints secrets.
"""
import json
from pathlib import Path
import re
import subprocess
import sys
import time

destination, title, scope, separator, *command = sys.argv[1:]
assert separator == '--' and command
destination = Path(destination).resolve().with_suffix('.log')
destination.parent.mkdir(parents=True, exist_ok=True)
assert not destination.exists() and not destination.with_suffix('.json').exists(), 'Choose a fresh evidence filename.'
started = time.monotonic()
with destination.open('x') as log:
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in process.stdout:
        clean = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', line.rstrip())
        log.write(clean + '\n')
        log.flush()
        print(clean, flush=True)
    result = process.wait()
elapsed = time.monotonic() - started
destination.with_suffix('.json').write_text(json.dumps(dict(title=title, scope=scope,
    capture_kind='Actual test output', exit_code=result, elapsed_seconds=round(elapsed, 2),
    log=destination.name), indent=2) + '\n')
print('Review log:', destination)
sys.exit(result)
