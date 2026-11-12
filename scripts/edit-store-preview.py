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

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageStat

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
step_titles = ['Log a potty break', 'Correct the time', 'Compare days',
               'See the details', 'Spot patterns', 'Set your routine']
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
tap_indicators = []
step_labels = []
transition_seconds = .2
cue_lead = .6
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
        segments = reviewed_cuts[index].get('segments', []) if reviewed_cuts else []
        segments = segments or [dict(raw_start=start, raw_end=end, speed=1)]
        last_end = start
        expected_seconds = 0
        filters = [f'[0:v]fps=30,scale=886:1920:flags=lanczos,setsar=1,split={len(segments)}' + ''.join(f'[raw{i}]' for i in range(len(segments)))]
        for i, segment in enumerate(segments):
            a, b, speed = segment['raw_start'], segment['raw_end'], segment['speed']
            assert last_end <= a < b <= end and 0 < speed <= 1
            last_end = b
            expected_seconds += (b-a)/speed
            # Normalize VFR before cutting, then slow actual interactions rather
            # than adding frozen result frames or replaying long idle waits.
            filters.append(f'[raw{i}]trim=start={a}:end={b},setpts=(PTS-STARTPTS)/{speed},fps=30[part{i}]')
        filters.append(''.join(f'[part{i}]' for i in range(len(segments))) + f'concat=n={len(segments)}:v=1:a=0[scene]')
        clip = Path(temporary) / f'{index}.mp4'
        run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(scene_raw),
            '-filter_complex', ';'.join(filters), '-map', '[scene]',
            '-an', '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level:v', '4.0',
            '-b:v', '10M', '-maxrate', '12M', '-bufsize', '20M', '-pix_fmt', 'yuv420p', str(clip))
        clips.append(clip)
        length = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(clip)]))
        assert abs(length-expected_seconds) < .15*len(segments), 'Retimed footage must match the reviewed segment durations.'
        scene_start = sum(scene['edited_seconds'] for scene in scenes) - transition_seconds*index
        step_labels.append(dict(step=index+1, screen=stem, title=step_titles[index],
                                at=round(scene_start+.12, 3), duration=1.4))
        for touch in (reviewed_cuts[index].get('taps', []) if reviewed_cuts else []):
            assert 0 <= touch['x'] < 886 and 0 <= touch['y'] < 1920
            local = 0
            for segment in segments:
                if segment['raw_start'] <= touch['raw_at'] < segment['raw_end']:
                    local += (touch['raw_at']-segment['raw_start'])/segment['speed']
                    break
                local += (segment['raw_end']-segment['raw_start'])/segment['speed']
            else:
                raise AssertionError(f'Tap {touch["control"]} was cut out of the footage.')
            tap_at = scene_start + local
            assert cue_lead <= local and local+.6 <= length
            tap_indicators.append(dict(at=round(tap_at-cue_lead, 3), tap_at=round(tap_at, 3),
                x=touch['x'], y=touch['y'], duration=1.2, control=touch['control']))
        scenes.append(dict(screen=stem, source_recording=scene_raw.parent.name + '/' + scene_raw.name,
            raw_start=round(start, 3), raw_end=round(end, 3), segments=segments, edited_seconds=length))
        previous_end = end
    output = destination / 'iPhone-6.3-preview.mp4'
    # Decode each cut independently and produce one continuous H.264 stream;
    # stream-copy concatenation introduced ghosted text across these cuts.
    inputs = [argument for clip in clips for argument in ('-i', str(clip))]
    joined = ';'.join(f'[{i}:v]settb=AVTB,setpts=PTS-STARTPTS[view{i}]' for i in range(len(clips)))
    current, elapsed = 'view0', scenes[0]['edited_seconds']
    for i in range(1, len(clips)):
        name = 'video' if i == len(clips)-1 else f'join{i}'
        offset = elapsed-transition_seconds*i
        joined += f';[{current}][view{i}]xfade=transition=fade:duration={transition_seconds}:offset={offset:.6f}[{name}]'
        current, elapsed = name, elapsed+scenes[i]['edited_seconds']
    touch_input = []
    if tap_indicators:
        # A small transparent animation, shared by all recorded touch locations.
        sprite = Path(temporary) / 'tap.mov'
        encoder = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
            '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '96x96', '-r', '30', '-i', '-',
            '-an', '-c:v', 'qtrle', str(sprite)], stdin=subprocess.PIPE)
        for frame_index in range(36):
            approaching = frame_index < 18
            progress = frame_index/18 if approaching else (frame_index-18)/17
            alpha = round(255*(.55+.35*progress if approaching else (1-progress)**1.4))
            radius = ((32-16*progress) if approaching else (16+18*(1-(1-progress)**2))) * 4
            marker = Image.new('RGBA', (384, 384))
            draw = ImageDraw.Draw(marker)
            box = (192-radius, 192-radius, 192+radius, 192+radius)
            draw.ellipse(box, fill=(23,107,82,round(alpha*.12)), outline=(255,255,255,alpha), width=24)
            draw.ellipse(box, outline=(23,107,82,alpha), width=12)
            if not approaching:
                draw.ellipse((172,172,212,212), fill=(23,107,82,alpha))
            encoder.stdin.write(marker.resize((96,96), Image.Resampling.LANCZOS).tobytes())
        encoder.stdin.close()
        assert encoder.wait() == 0, 'Touch animation encoding failed.'
        touch_input = ['-i', str(sprite)]
        joined = joined.replace('[video]', '[base0]')
        joined += f';[{len(clips)+1}:v]split={len(tap_indicators)}' + ''.join(f'[touch{i}]' for i in range(len(tap_indicators)))
        for i, touch in enumerate(tap_indicators):
            joined += (f';[touch{i}]trim=duration={touch["duration"]},setpts=PTS-STARTPTS+{touch["at"]}/TB[pulse{i}]'
                       f';[base{i}][pulse{i}]overlay=x={touch["x"]-48}:y={touch["y"]-48}:eof_action=pass:repeatlast=0[base{i+1}]')
        joined += f';[base{len(tap_indicators)}]null[video]'
    # Animated editorial labels sit below the status bar, clear of tap targets.
    labels_movie = Path(temporary) / 'steps.mov'
    encoder = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '886x88', '-r', '30', '-i', '-',
        '-an', '-c:v', 'qtrle', str(labels_movie)], stdin=subprocess.PIPE)
    font_path = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
    title_font, number_font = ImageFont.truetype(font_path,64), ImageFont.truetype(font_path,48)
    plates = []
    for label in step_labels:
        plate = Image.new('RGBA',(1100,136))
        draw = ImageDraw.Draw(plate)
        draw.rounded_rectangle((1,1,1098,134),radius=32,fill=(23,61,48,248),outline=(244,241,231,190),width=2)
        draw.rounded_rectangle((24,24,152,112),radius=20,fill=(244,241,231,240))
        draw.text((88,68),f'{label["step"]}/{len(step_labels)}',font=number_font,fill='#173D30',anchor='mm')
        draw.text((184,68),label['title'],font=title_font,fill='#F4F1E7',anchor='lm')
        plates.append(plate.resize((550,68),Image.Resampling.LANCZOS))
    total_seconds = sum(scene['edited_seconds'] for scene in scenes)-transition_seconds*(len(scenes)-1)
    for frame_index in range(round(total_seconds*30)+1):
        t = frame_index/30
        band = Image.new('RGBA',(886,88))
        for label, plate in zip(step_labels,plates):
            local = t-label['at']
            if 0 <= local < label['duration']:
                entering, leaving = min(1,local/.3), max(0,(local-label['duration']+.25)/.25)
                opacity = min(1-(1-entering)**3,1-leaving**2)
                shift = round(28*(1-entering)**3-20*leaving**2)
                moving = plate.copy()
                moving.putalpha(moving.getchannel('A').point([round(a*opacity) for a in range(256)]))
                band.alpha_composite(moving,(168+shift,8))
                break
        encoder.stdin.write(band.tobytes())
    encoder.stdin.close()
    assert encoder.wait() == 0, 'Step-label animation encoding failed.'
    label_input_index = len(clips)+1+bool(touch_input)
    joined = joined.replace('[video]','[footage]')
    joined += f';[footage][{label_input_index}:v]overlay=x=0:y=100:eof_action=pass:repeatlast=0[video]'
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *inputs,
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        *touch_input,
        '-i', str(labels_movie),
        '-filter_complex', joined, '-map', '[video]', '-map', f'{len(clips)}:a:0',
        '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level:v', '4.0',
        '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-r', '30',
        '-b:v', '10M', '-maxrate', '12M', '-bufsize', '20M', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', str(output))
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(output), '-ss', '7', '-frames:v', '1', str(destination / 'poster.jpg'))
metadata = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(output)]))
video = next(s for s in metadata['streams'] if s['codec_type'] == 'video')
audio = next(s for s in metadata['streams'] if s['codec_type'] == 'audio')
assert (video['width'], video['height'], video['r_frame_rate'], video['codec_name'], video['level']) == (886, 1920, '30/1', 'h264', 40)
assert audio['codec_name'] == 'aac' and audio['channels'] == 2 and audio['sample_rate'] == '48000'
assert 15 <= float(metadata['format']['duration']) <= 30
assert output.stat().st_size < 500_000_000
elapsed = 0
for index, scene in enumerate(scenes):
    elapsed += scene['edited_seconds']
    check_at = elapsed-transition_seconds*index-(transition_seconds if index<len(scenes)-1 else 0)-.08
    # Decode from the start: input-side fast seeking produced false text artifacts
    # in extracted frames, while continuous playback remained clean.
    frame = subprocess.check_output(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(output), '-ss', str(check_at), '-frames:v', '1', '-vf', 'scale=120:262', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    actual = Image.frombytes('RGB', (120, 262), frame).crop((0, 30, 120, 240))
    reference_path = next(captures.rglob(f'takeScreenshot/{scene["screen"]}.png'))
    reference = Image.open(reference_path).convert('RGB').resize((120, 262), Image.Resampling.LANCZOS).crop((0, 30, 120, 240))
    difference = sum(ImageStat.Stat(ImageChops.difference(actual, reference)).mean)/3
    assert difference < 5, f'Exported {scene["screen"]} does not hold on its verified UI: {difference}'
seconds = round(float(metadata['format']['duration']), 2)
assert abs(seconds-(sum(scene['edited_seconds'] for scene in scenes)-transition_seconds*(len(scenes)-1))) < .1
(destination / 'edit.json').write_text(json.dumps(dict(seconds=seconds, poster_seconds=7, source='Native simulator recording; original CSV history with personal notes omitted; one scripted logging/edit action', audio='Silent stereo AAC', timing='Slower interaction footage with idle waits removed', transition_seconds=transition_seconds, frozen_padding_seconds=0, tap_indicators=tap_indicators, step_labels=step_labels, sha256=hashlib.sha256(output.read_bytes()).hexdigest(), scenes=scenes), indent=2) + '\n')
print(f'PASS {seconds}-second H.264 preview with slower interactions, gentle dissolves and no frozen padding: {output}')
