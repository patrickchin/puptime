#!/usr/bin/env python3
"""Run a credential-free CLI check and render its timestamped output as MP4.

Usage: python record-test-review.py OUTPUT.mp4 TITLE SCOPE -- COMMAND ARGS...
This is a rendered replay of actual output, not a screen recording of an app.
Requires Pillow and ffmpeg. Never pass a command that prints secrets.
"""
import bisect
import json
from pathlib import Path
import re
import subprocess
import sys
import textwrap
import time
from PIL import Image, ImageDraw, ImageFont

destination, title, scope, separator, *command = sys.argv[1:]
assert separator == '--' and command
destination = Path(destination).resolve()
destination.parent.mkdir(parents=True, exist_ok=True)
assert not destination.exists(), 'Choose a fresh evidence filename.'
started = time.monotonic()
events = [(0, '$ ' + ' '.join(command))]
with destination.with_suffix('.log').open('w') as log:
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in process.stdout:
        clean = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', line.rstrip())
        events.append((time.monotonic()-started, clean))
        log.write(clean+'\n')
        log.flush()
        print(clean, flush=True)
    result = process.wait()
elapsed = time.monotonic()-started
events.append((elapsed, 'Exit status: ' + str(result)))
font_path = '/System/Library/Fonts/Supplemental/Arial.ttf'
heading = ImageFont.truetype(font_path, 30)
font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 20)
small = ImageFont.truetype(font_path, 20)
encoder = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo',
                            '-pixel_format', 'rgb24', '-video_size', '1280x800', '-framerate', '2',
                            '-i', '-', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
                            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(destination)], stdin=subprocess.PIPE)
try:
    times = [event[0] for event in events]
    for frame in range(int((elapsed+5)*2)+1):
        current = min(frame/2, elapsed)
        shown = events[:bisect.bisect_right(times, current)]
        lines = [part for _, line in shown for part in (textwrap.wrap(line, 98) or [''])][-20:]
        image = Image.new('RGB', (1280, 800), '#102c27')
        draw = ImageDraw.Draw(image)
        draw.text((32, 25), title, font=heading, fill='white')
        draw.text((32, 72), scope, font=small, fill='#d7e9df')
        draw.rectangle((20, 112, 1260, 712), fill='#101917')
        for index, line in enumerate(lines):
            draw.text((36, 130+index*27), line, font=font, fill='#e4efe8')
        label = 'PASS' if result == 0 else 'FAILED'
        draw.text((32, 745), 'Actual test output · rendered replay · ' + (label if current >= elapsed else 'running'),
                  font=small, fill='#a9d8c5')
        encoder.stdin.write(image.tobytes())
finally:
    encoder.stdin.close()
    assert encoder.wait() == 0, 'Video export failed.'
destination.with_suffix('.json').write_text(json.dumps(dict(title=title, scope=scope,
    rendered_actual_output=True, exit_code=result, elapsed_seconds=round(elapsed, 2),
    video=destination.name, log=destination.with_suffix('.log').name,
    chapters=[dict(seconds=round(stamp, 1), title=line) for stamp, line in events
              if line.startswith(('PASS ', 'Waiting '))]), indent=2)+'\n')
print('Review video:', destination)
sys.exit(result)
