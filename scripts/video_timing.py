"""Preserve simulator presentation times when a decoder falls back to bad DTS."""
import json
import math
import subprocess


def recording_clock(path):
    frames = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
        'frame=pts_time,best_effort_timestamp_time', '-of', 'json', str(path),
    ]))['frames']
    times = [float(frame['pts_time']) for frame in frames]
    assert times and all(math.isfinite(t) for t in times)
    assert all(a <= b for a, b in zip(times, times[1:])), 'Original recording PTS must be monotonic.'
    if all(abs(float(frame['best_effort_timestamp_time'])-t) < .00001 for frame, t in zip(frames, times)):
        return times, ''

    # Balanced branches avoid deep expression nesting in short simulator clips.
    def expression(first, last):
        if last-first == 1:
            return str(times[first])
        middle = (first+last)//2
        return f'if(lt(N,{middle}),{expression(first,middle)},{expression(middle,last)})'

    return times, f"setpts='({expression(0,len(times))})/TB',"


if __name__ == '__main__':
    import sys
    times, correction = recording_clock(sys.argv[1])
    print(f'{len(times)} frames; monotonic original PTS; decoder timestamp repair: {bool(correction)}')
