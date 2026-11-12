#!/usr/bin/env python3
"""Edit actual simulator footage using capture timestamps; requires ffmpeg/ffprobe.

Usage: python3 scripts/edit-store-preview.py RECORDING_TIMES.json
JSON: {raw: MOV_PATH, root: MAESTRO_OUTPUT_ROOT, end: UNIX_STOP_TIME}
The raw recorder must span fastlane/preview.yaml. Keep both inputs for provenance.
"""
import json
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile

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
sequence = [('01-logged', 'quick.pee'), ('02-edited', 'event.pee.edit'),
            ('03-timeline', 'nav.switch'), ('04-detail', 'timeline.filter.poop-meal'),
            ('05-insights', 'nav.insights'),
            ('06-routine', 'nav.schedule')]
# A visual review can supply tighter native footage ranges to omit loading and
# drawer waits. Keep these in the local recording JSON, not in app code.
reviewed_cuts = recording.get('reviewed_cuts')
if reviewed_cuts is not None:
    assert [cut['screen'] for cut in reviewed_cuts] == [stem for stem, _ in sequence]
timing = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(raw)]))
timestamps = [float(frame['best_effort_timestamp_time']) for frame in timing['frames']]
decoded = subprocess.check_output(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(raw), '-vf', 'scale=120:262:flags=lanczos', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stderr=subprocess.PIPE)
frame_size = 120 * 262 * 3
frames = [Image.frombytes('RGB', (120, 262), decoded[i:i+frame_size]).crop((0, 30, 120, 240)) for i in range(0, len(decoded), frame_size)]
assert len(frames) == len(timestamps)
matched = {}
offsets = []
layout_starts = {}
for stem, _ in sequence:
    matches = list(captures.rglob(f'takeScreenshot/{stem}.png'))
    assert len(matches) == 1
    reference = Image.open(matches[0]).convert('RGB').resize((120, 262), Image.Resampling.LANCZOS).crop((0, 30, 120, 240))
    estimated = matches[0].stat().st_mtime - origin
    # Each action preview state is unique; match pixels rather than assuming
    # simulator recording timestamps stay aligned with host wall-clock time.
    scores = [sum(ImageStat.Stat(ImageChops.difference(reference, frame)).mean)/3 for frame in frames]
    # The first settled match avoids replaying long idle tails after an action.
    minimum = min(scores)
    assert minimum < 5, f'{stem} could not be verified in the actual recording: {minimum}'
    pts = min(timestamps[i] for i, score in enumerate(scores) if score <= minimum + .05)
    if stem in ['02-edited', '06-routine']:
        previous = max(matched.values(), default=0)
        layout_starts[stem] = min(timestamps[i] for i, score in enumerate(scores) if timestamps[i] > previous and score < 5)
    matched[stem] = pts
    offsets.append(pts - estimated)
print('Verified raw screenshot frames:', matched, 'wall-clock offsets:', offsets, flush=True)
destination = root / 'fastlane/previews/en-US'
destination.mkdir(parents=True, exist_ok=True)
scenes = []
previous_end = 0
with tempfile.TemporaryDirectory(prefix='puptime-store-preview-') as temporary:
    clips = []
    for index, (stem, selector) in enumerate(sequence):
        tap = next(c for c in commands if c['command'].get('tapOnElement', {}).get('selector', {}).get('idRegex') == selector)
        start = tap['metadata']['timestamp'] / 1000 - origin + offsets[index] - .2
        if stem in layout_starts:
            start = layout_starts[stem] - .2
        start = max(start, previous_end)
        end = matched[stem] + (.65 if stem == '06-routine' else .4)
        scene_raw, scene_duration = raw, duration
        if reviewed_cuts is not None:
            start, end = reviewed_cuts[index]['raw_start'], reviewed_cuts[index]['raw_end']
            scene_raw = Path(reviewed_cuts[index].get('raw', raw)).resolve()
            if scene_raw == raw:
                assert start >= previous_end, 'Reviewed cuts must preserve source order.'
            else:
                scene_duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(scene_raw)]))
        assert 0 <= start < end <= scene_duration
        # Keep real actions at normal speed. Remove setup/waiting and add no frozen frames.
        clip = Path(temporary) / f'{index}.mp4'
        run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(scene_raw),
            # Normalize the recorder's irregular frame durations before cutting;
            # fps after trim can carry an old frame's long duration across the cut.
            '-vf', f'fps=30,trim=start={start}:end={end},setpts=PTS-STARTPTS,scale=886:1920:flags=lanczos,setsar=1',
            '-an', '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level:v', '4.0',
            '-b:v', '10M', '-maxrate', '12M', '-bufsize', '20M', '-pix_fmt', 'yuv420p', str(clip))
        clips.append(clip)
        length = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(clip)]))
        assert abs(length-(end-start)) < .1, 'A cut must not inherit idle duration from the raw recorder.'
        scenes.append(dict(screen=stem, source_recording=scene_raw.parent.name + '/' + scene_raw.name, raw_start=round(start, 3), raw_end=round(end, 3), edited_seconds=length))
        previous_end = end
    output = destination / 'iPhone-6.3-preview.mp4'
    # Decode each cut independently and produce one continuous H.264 stream;
    # stream-copy concatenation introduced ghosted text across these cuts.
    inputs = [argument for clip in clips for argument in ('-i', str(clip))]
    joined = ''.join(f'[{index}:v]' for index in range(len(clips))) + f'concat=n={len(clips)}:v=1:a=0[video]'
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *inputs,
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-filter_complex', joined, '-map', '[video]', '-map', f'{len(clips)}:a:0',
        '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level:v', '4.0',
        '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
        '-b:v', '10M', '-maxrate', '12M', '-bufsize', '20M', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', str(output))
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(output), '-ss', '6', '-frames:v', '1', str(destination / 'poster.jpg'))
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
    # Decode from the start: input-side fast seeking produced false text artifacts
    # in extracted frames, while continuous playback remained clean.
    frame = subprocess.check_output(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(output), '-ss', str(elapsed-.05), '-frames:v', '1', '-vf', 'scale=120:262', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    actual = Image.frombytes('RGB', (120, 262), frame).crop((0, 30, 120, 240))
    reference_path = next(captures.rglob(f'takeScreenshot/{scene["screen"]}.png'))
    reference = Image.open(reference_path).convert('RGB').resize((120, 262), Image.Resampling.LANCZOS).crop((0, 30, 120, 240))
    difference = sum(ImageStat.Stat(ImageChops.difference(actual, reference)).mean)/3
    assert difference < 5, f'Exported {scene["screen"]} does not hold on its verified UI: {difference}'
seconds = round(float(metadata['format']['duration']), 2)
(destination / 'edit.json').write_text(json.dumps(dict(seconds=seconds, poster_seconds=6, source='Native simulator recording; original CSV history with personal notes omitted; one scripted logging/edit action', audio='Silent stereo AAC', playback_speed=1, frozen_padding_seconds=0, sha256=hashlib.sha256(output.read_bytes()).hexdigest(), scenes=scenes), indent=2) + '\n')
print(f'PASS {seconds}-second H.264 preview with real actions and no frozen padding: {output}')
