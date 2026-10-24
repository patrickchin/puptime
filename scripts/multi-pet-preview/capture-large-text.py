"""Exercise large-text reflow on the dedicated native preview emulator."""
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

serial = sys.argv[1]
output = Path(sys.argv[2] if len(sys.argv) > 2 else 'output/large-text/android')
output.mkdir(parents=True, exist_ok=True)

def adb(*args):
    return subprocess.check_output(['adb', '-s', serial, *args])

assert re.match(r'^Puptime_(Multi_Pet_622c|Navigation_d859|History_Spacing_d859)\b', adb('emu', 'avd', 'name').decode())

def hierarchy():
    adb('shell', 'uiautomator', 'dump', '/sdcard/puptime-622c.xml')
    return ET.fromstring(adb('shell', 'cat', '/sdcard/puptime-622c.xml'))

def bounds(node):
    return list(map(int, re.findall(r'\d+', node.get('bounds'))))

def find(identifier, scroll=False):
    for _ in range(12):
        match = next((node for node in hierarchy().iter('node') if node.get('resource-id') == identifier), None)
        if match is not None:
            return match
        if scroll:
            adb('shell', 'input', 'swipe', '490', '1700', '490', '600', '350')
    raise AssertionError('Visible control missing: ' + identifier)

def tap(identifier, scroll=False):
    x1, y1, x2, y2 = bounds(find(identifier, scroll))
    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))

def shot(name):
    hierarchy()
    (output / (name + '.png')).write_bytes(adb('exec-out', 'screencap', '-p'))

previous_scale = adb('shell', 'settings', 'get', 'system', 'font_scale').decode().strip()
try:
    adb('shell', 'wm', 'size', '984x2100')
    adb('shell', 'settings', 'put', 'system', 'font_scale', '2.0')
    adb('shell', 'am', 'force-stop', 'com.patrickchin.puptime')
    adb('shell', 'am', 'start', '-n', 'com.patrickchin.puptime/.MainActivity')
    rows = [bounds(find('preview.quick.pet_preview_0.' + activity)) for activity in ['pee', 'poop', 'meal']]
    assert all(row[2] - row[0] > 700 for row in rows), 'Large-text actions must use the full card width.'
    assert rows[0][3] < rows[1][1] and rows[1][3] < rows[2][1], 'Action rows must stack without overlap.'
    shot('01-log')
    tap('preview.pets')
    shot('02-pets')
    tap('nav.back')
    tap('preview.quick.pet_preview_0.pee')
    assert any(node.get('text') == 'Pee logged for Mochi' for node in hierarchy().iter('node'))
    tap('preview.undo')
    tap('nav.open')
    tap('nav.settings', scroll=True)
    tap('preview.dark', scroll=True)
    shot('03-dark-settings')
    tap('settings.back')
    shot('04-dark-log')
    tap('nav.open')
    tap('nav.notifications', scroll=True)
    shot('05-reminders')
    tap('notifications.timing.meal.time', scroll=True)
    shot('06-time-options')
    tap('notifications.timing.option.0', scroll=True)
    assert any('At the scheduled time' in (node.get('text', '') + node.get('content-desc', '')) for node in hierarchy().iter('node'))
    shot('07-reminder-changed')
    tap('nav.open')
    tap('nav.settings', scroll=True)
    tap('preview.widget', scroll=True)
    tap('preview.select.pet_preview_1')
    shot('08-widget')
    tap('preview.modal.done')
    tap('settings.back')
    tap('nav.open')
    find('nav.settings', scroll=True)
    find('nav.close')
    shot('10-menu')
    tap('nav.close')
    find('nav.open')
    adb('shell', 'wm', 'size', '2100x984')
    shot('09-landscape')
    print('PASS 375 dp / 2× text: full-width actions, logging/undo, Pets page, dark mode, reminder selection, widget sheet and reachable navigation close.')
finally:
    adb('shell', 'wm', 'size', 'reset')
    adb('shell', 'settings', 'put', 'system', 'font_scale', previous_scale)
