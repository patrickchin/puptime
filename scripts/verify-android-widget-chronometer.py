#!/usr/bin/env python3
"""Run with a populated Puptime widget on a dedicated, rootable emulator; requires Maestro."""
import argparse
import json
import re
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--device', required=True)
args = parser.parse_args()


def adb(*command):
    return subprocess.run(['adb', '-s', args.device, *command], check=True,
                          capture_output=True, text=True, timeout=30).stdout


def timers():
    # uiautomator dump waits for a full second of idle, which a live timer prevents.
    snapshot = subprocess.run(['maestro', '--device', args.device, 'hierarchy',
                               '--no-ansi', '--no-reinstall-driver'], check=True,
                              capture_output=True, text=True, timeout=60).stdout
    root = json.loads(snapshot)
    result = {}

    def collect(node):
        attributes = node.get('attributes', {})
        if attributes.get('class') == 'android.widget.Chronometer':
            text = attributes.get('text', '')
            assert re.fullmatch(r'\d+:\d{2}(?::\d{2})? ago', text), text
            seconds = 0
            for part in text.removesuffix(' ago').split(':'):
                seconds = seconds * 60 + int(part)
            result[attributes.get('bounds')] = seconds
        for child in node.get('children', []):
            collect(child)

    collect(root)
    assert result, 'No live chronometers found; add logs and show the home screen widget.'
    return result, time.monotonic()


def assert_advanced(before, after):
    first, first_at = before
    second, second_at = after
    assert first.keys() == second.keys(), (before, after)
    for bounds, seconds in first.items():
        delta = second[bounds] - seconds
        assert delta >= 2 and abs(delta - (second_at - first_at)) <= 2, (before, after)


adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
adb('root')
adb('wait-for-device')
# Simulate process reclamation. Android's Settings > Force stop disables widgets,
# so it cannot be used to test ordinary background process death.
process = subprocess.run(['adb', '-s', args.device, 'shell', 'pidof',
                          'com.patrickchin.puptime'], capture_output=True, text=True)
if process.stdout.strip():
    adb('shell', 'kill', '-9', *process.stdout.split())
before = timers()
time.sleep(3)
after = timers()
assert_advanced(before, after)
# A live timer must not depend on keeping the app's JavaScript process alive.
process = subprocess.run(['adb', '-s', args.device, 'shell', 'pidof',
                          'com.patrickchin.puptime'], capture_output=True, text=True)
assert not process.stdout.strip(), f'App is still running: {process.stdout}'

adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP')
time.sleep(3)
adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
adb('shell', 'wm', 'dismiss-keyguard')
assert_advanced(after, timers())
print(f'PASS: {len(before[0])} native timers advanced with the app stopped and after screen sleep.')
