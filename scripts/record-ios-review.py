#!/usr/bin/env python3
"""Record a real test rerun on its dedicated iOS simulator, then caption it.

Requires ffmpeg/ffprobe and Pillow. No simulated footage or credential masking:
only use this wrapper for flows that never display passwords or login codes.
Usage: python record-ios-review.py UDID OUTPUT.mp4 TITLE SCOPE -- COMMAND ARGS...
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import textwrap
import time

from PIL import Image, ImageDraw, ImageFont

udid, destination, title, scope, separator, *command = sys.argv[1:]
assert separator == '--' and command
devices = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', 'available', '-j']))
assert any(d['udid'] == udid and d['name'].startswith('Puptime Native Storage ')
           for group in devices['devices'].values() for d in group), 'Use the dedicated test simulator.'
destination = Path(destination).resolve()
destination.parent.mkdir(parents=True, exist_ok=True)
assert not destination.exists(), 'Keep previous review evidence; choose a fresh filename.'
raw = destination.with_suffix('.raw.mov')
started = time.time()
chapters = []
recorder = subprocess.Popen(['xcrun', 'simctl', 'io', udid, 'recordVideo', '--codec=h264', str(raw)],
                            stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True)
try:
    while True:
        line = recorder.stderr.readline()
        if 'Recording started' in line:
            break
        if recorder.poll() is not None:
            raise RuntimeError('Simulator recording failed: ' + line)
    with destination.with_suffix('.log').open('w') as log:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in process.stdout:
            log.write(line)
            log.flush()
            print(line, end='', flush=True)
            if line.lstrip().startswith(('> Flow ', 'PASS ')):
                chapters.append(dict(seconds=round(time.time()-started, 1), title=line.strip()))
        result = process.wait()
finally:
    if recorder.poll() is None:
        recorder.send_signal(signal.SIGINT)
    recorder.wait(timeout=30)

status = 'PASS' if result == 0 else 'FAILED — retained for diagnosis'
banner = Image.new('RGB', (600, 190), '#102c27')
draw = ImageDraw.Draw(banner)
font_path = '/System/Library/Fonts/Supplemental/Arial.ttf'
y = 15
for text, size, color in [(title, 24, '#ffffff'), (scope, 18, '#d7e9df'),
                          ('Recorded rerun · ' + status, 18, '#a9d8c5')]:
    font = ImageFont.truetype(font_path, size)
    for line in textwrap.wrap(text, width=43 if size == 24 else 57):
        draw.text((18, y), line, font=font, fill=color)
        y += size + 5
    y += 5
assert y <= 190, 'Shorten the captions so they fit below the app.'
caption = destination.with_suffix('.caption.png')
banner.save(caption)
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw), '-i', str(caption),
                '-filter_complex', '[0:v]scale=600:-2,pad=600:ih+190:0:0:color=0x102c27[v];[v][1:v]overlay=0:H-h,fps=30',
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart', str(destination)], check=True)
metadata = dict(title=title, scope=scope, recorded_rerun=True, exit_code=result,
                started_at=started, elapsed_seconds=round(time.time()-started, 1),
                simulator=udid, video=destination.name, log=destination.with_suffix('.log').name,
                chapters=chapters)
destination.with_suffix('.json').write_text(json.dumps(metadata, indent=2) + '\n')
raw.unlink()
print('Review video:', destination)
sys.exit(result)
