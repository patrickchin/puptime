#!/usr/bin/env python3
"""Edit actual simulator footage using capture timestamps; requires ffmpeg/ffprobe.

Usage: python3 scripts/edit-store-preview.py RECORDING_TIMES.json
JSON: {raw: MOV_PATH, root: MAESTRO_OUTPUT_ROOT, end: UNIX_STOP_TIME}
The raw recorder must span fastlane/capture.yaml. Keep both inputs for provenance.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from statistics import median

from PIL import Image, ImageChops, ImageStat

def run(*args):
    subprocess.run(args, check=True)

root = Path(__file__).resolve().parents[1]
recording = json.loads(Path(sys.argv[1]).read_text())
raw, captures = Path(recording['raw']).resolve(), Path(recording['root']).resolve()
duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(raw)]))
# Initial estimate only; match the captured UI to the footage before cutting.
origin = recording['end'] - duration
commands = list(captures.rglob('commands.json'))
assert len(commands) == 1
commands = json.loads(commands[0].read_text())
assert all(c['metadata']['status'] == 'COMPLETED' for c in commands)
tap = next(c for c in commands if c['command'].get('tapOnElement', {}).get('selector', {}).get('idRegex') == 'quick.pee')
decoded = subprocess.check_output(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(raw), '-vf', 'fps=5,scale=120:262:flags=lanczos', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
frame_size = 120 * 262 * 3
frames = [Image.frombytes('RGB', (120, 262), decoded[i:i+frame_size]).crop((0, 30, 120, 240)) for i in range(0, len(decoded), frame_size)]
matched = {}
offsets = []
for stem in ['01-log', '02-timeline', '03-insights', '04-routine', '05-details']:
    matches = list(captures.rglob(f'takeScreenshot/{stem}.png'))
    assert len(matches) == 1
    reference = Image.open(matches[0]).convert('RGB').resize((120, 262), Image.Resampling.LANCZOS).crop((0, 30, 120, 240))
    estimated = matches[0].stat().st_mtime - origin
    scores = [sum(ImageStat.Stat(ImageChops.difference(reference, frame)).mean)/3 if abs(i/5-estimated)<2 else float('inf') for i, frame in enumerate(frames)]
    # Use the last close match; preserve the settled UI rather than cutting mid-transition.
    minimum = min(scores)
    assert minimum < 5, f'{stem} could not be verified in the actual recording: {minimum}'
    pts = max(i for i, score in enumerate(scores) if score <= minimum + .15) / 5
    matched[stem] = pts
    offsets.append(pts - (matches[0].stat().st_mtime - origin))
start = tap['metadata']['timestamp'] / 1000 - origin + median(offsets) - .3
print('Verified raw screenshot frames:', matched, 'logging starts:', round(start, 3), flush=True)
destination = root / 'fastlane/previews/en-US'
destination.mkdir(parents=True, exist_ok=True)
scenes = []
with tempfile.TemporaryDirectory(prefix='puptime-store-preview-') as temporary:
    clips = []
    for index, (stem, length) in enumerate([('01-log', 7), ('02-timeline', 5), ('03-insights', 5), ('04-routine', 5), ('05-details', 5)]):
        end = matched[stem] - .2
        assert 0 <= start < end <= duration
        # Hold the last real frame to give each screen time to read. Never speed up UI.
        clip = Path(temporary) / f'{index}.mp4'
        run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw),
            '-vf', f'trim=start={start}:end={end},setpts=PTS-STARTPTS,fps=30,scale=886:1920:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=5',
            '-t', str(length), '-an', '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level:v', '4.0',
            '-b:v', '10M', '-maxrate', '12M', '-bufsize', '20M', '-pix_fmt', 'yuv420p', str(clip))
        clips.append(clip)
        scenes.append(dict(screen=stem, raw_start=round(start, 3), raw_end=round(end, 3), edited_seconds=length))
        start = end
    playlist = Path(temporary) / 'clips.txt'
    playlist.write_text(''.join(f"file '{clip}'\n" for clip in clips))
    output = destination / 'iPhone-6.3-preview.mp4'
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(playlist),
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '256k', '-t', '27', '-movflags', '+faststart', str(output))
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', '5', '-i', str(output), '-frames:v', '1', str(destination / 'poster.jpg'))
metadata = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(output)]))
video = next(s for s in metadata['streams'] if s['codec_type'] == 'video')
audio = next(s for s in metadata['streams'] if s['codec_type'] == 'audio')
assert (video['width'], video['height'], video['r_frame_rate'], video['codec_name'], video['level']) == (886, 1920, '30/1', 'h264', 40)
assert audio['codec_name'] == 'aac' and audio['channels'] == 2 and audio['sample_rate'] == '48000'
assert 15 <= float(metadata['format']['duration']) <= 30
assert output.stat().st_size < 500_000_000
elapsed = 0
for scene in scenes:
    elapsed += scene['edited_seconds']
    frame = subprocess.check_output(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-ss', str(elapsed-.3), '-i', str(output), '-frames:v', '1', '-vf', 'scale=120:262', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    actual = Image.frombytes('RGB', (120, 262), frame).crop((0, 30, 120, 240))
    reference_path = next(captures.rglob(f'takeScreenshot/{scene["screen"]}.png'))
    reference = Image.open(reference_path).convert('RGB').resize((120, 262), Image.Resampling.LANCZOS).crop((0, 30, 120, 240))
    difference = sum(ImageStat.Stat(ImageChops.difference(actual, reference)).mean)/3
    assert difference < 5, f'Exported {scene["screen"]} does not hold on its verified UI: {difference}'
(destination / 'edit.json').write_text(json.dumps(dict(seconds=27, poster_seconds=5, source='Native simulator recording of the current app; synthetic history', audio='Silent stereo AAC', scenes=scenes), indent=2) + '\n')
print(f'PASS 27-second H.264 preview, 886×1920, 30 fps, High Level 4.0, stereo AAC: {output}')
