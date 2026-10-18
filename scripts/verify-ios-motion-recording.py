#!/usr/bin/env python3
"""Measure real puppy movement in the OFF/ON recording; never generate app UI.

Simulator footage can begin after the recorder's wall-clock start. Maestro times
bound a phase loosely; a matching static footer keeps only stable app frames.
Usage: python verify-ios-motion-recording.py RECORDING.mp4 NATIVE_EVIDENCE_DIR
"""
import json
from pathlib import Path
import statistics
import subprocess
import sys

from PIL import Image, ImageChops, ImageStat

video, evidence = Path(sys.argv[1]), Path(sys.argv[2])
metadata = json.loads(video.with_suffix('.json').read_text())
assert metadata['exit_code'] == 0
assert metadata['simulator'] == '99EB738C-D283-4A4E-8EF7-6DED36E3A10F'
info = json.loads(subprocess.check_output([
    'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height:format=duration', '-of', 'json', str(video)], text=True))
width, height = info['streams'][0]['width'], info['streams'][0]['height'] - 190
crop = (int(width * .15), int(height * .2), int(width * .7), int(height * .35))
footer_height = 150
frame_size = width * (crop[3] + footer_height) * 3
report = {}
for phase in ['off', 'on']:
    directory = evidence / phase / 'ios-onboarding-motion-practice.yaml'
    paths = list(directory.rglob('commands.json'))
    assert len(paths) == 1
    commands = json.loads(paths[0].read_text())
    taps = [item['metadata'] for item in commands
            if item.get('command', {}).get('tapOnElement', {}).get('selector', {}).get('idRegex')
            in ['onboarding.demo.meal', 'onboarding.demo.pee', 'onboarding.demo.poop']]
    assert len(taps) == 3 and all(tap['status'] == 'COMPLETED' for tap in taps)
    start = max(0, taps[0]['timestamp'] / 1000 - metadata['started_at'] - 5)
    end = min(float(info['format']['duration']),
              (taps[-1]['timestamp'] + taps[-1]['duration']) / 1000 - metadata['started_at'] + 1)
    before = Image.open(next(directory.rglob('motion-practice-before.png'))).convert('RGB')
    footer = before.resize((width, height)).crop((0, height - footer_height, width, height))
    filters = (f'[0:v]split[d][f];[d]crop={crop[2]}:{crop[3]}:{crop[0]}:{crop[1]},'
               f'pad={width}:{crop[3]}:0:0[d];[f]crop={width}:{footer_height}:0:{height-footer_height}[f];'
               '[d][f]vstack,fps=30[out]')
    process = subprocess.Popen([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-ss', str(start),
        '-i', str(video), '-t', str(end - start), '-filter_complex', filters,
        '-map', '[out]', '-an', '-sn', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    centers = []
    try:
        while raw := process.stdout.read(frame_size):
            assert len(raw) == frame_size
            frame = Image.frombytes('RGB', (width, crop[3] + footer_height), raw)
            actual_footer = frame.crop((0, crop[3], width, crop[3] + footer_height))
            error = statistics.mean(ImageStat.Stat(ImageChops.difference(actual_footer, footer)).mean)
            if error > 4:
                continue  # Exclude app-switch transitions and other screens.
            red, green, blue = frame.crop((0, 0, crop[2], crop[3])).split()
            mask = ImageChops.multiply(
                ImageChops.subtract(red, green).point(lambda value: 255 if value > 25 else 0),
                ImageChops.subtract(green, blue).point(lambda value: 255 if value > 20 else 0))
            mask = ImageChops.multiply(mask, green.point(lambda value: 255 if value > 65 else 0))
            bounds = mask.getbbox()
            if bounds and bounds[2] - bounds[0] > 50 and bounds[3] - bounds[1] > 40:
                centers.append((bounds[1] + bounds[3]) / 2)
    finally:
        process.stdout.close()
        assert process.wait() == 0
    assert len(centers) >= 30
    baseline = statistics.median(centers)
    responses, run = 0, 0
    for center in centers + [baseline]:
        if center < baseline - 4:
            run += 1
        else:
            if run >= 2:
                responses += 1
            run = 0
    report[phase] = dict(stable_app_frames=len(centers),
                         vertical_range_px=max(centers)-min(centers), upward_responses=responses)
assert report['off']['upward_responses'] == 3, 'Each of the three normal practice taps should visibly animate.'
assert report['on']['upward_responses'] == 0 and report['on']['vertical_range_px'] <= 2, 'Reduce Motion should keep the puppy still.'
print('PASS actual footage: three normal puppy responses; no puppy motion with the real iOS setting enabled.')
print(json.dumps(report, indent=2))
