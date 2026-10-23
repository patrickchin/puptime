"""Capture a sample-only preview on this worktree's dedicated Android emulator."""
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

serial = sys.argv[1]
output = Path(sys.argv[2] if len(sys.argv) > 2 else 'output/multi-pet-audit/android-final')
output.mkdir(parents=True, exist_ok=True)

def adb(*args):
    return subprocess.check_output(['adb', '-s', serial, *args])

assert re.match(r'^Puptime_(Multi_Pet_622c|Navigation_d859)\b', adb('emu', 'avd', 'name').decode())

def hierarchy():
    adb('shell', 'uiautomator', 'dump', '/sdcard/puptime-622c.xml')
    return ET.fromstring(adb('shell', 'cat', '/sdcard/puptime-622c.xml'))

def tap(identifier):
    for _ in range(10):
        match = next((node for node in hierarchy().iter('node') if node.get('resource-id') == identifier), None)
        if match is not None:
            x1, y1, x2, y2 = map(int, re.findall(r'\d+', match.get('bounds')))
            adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))
            return
    raise AssertionError('Visible control missing: ' + identifier)

def shot(name):
    hierarchy()  # Capture only after the native hierarchy has settled.
    (output / (name + '.png')).write_bytes(adb('exec-out', 'screencap', '-p'))

def navigate(tab):
    tap('nav.open')
    tap('nav.' + tab)

adb('shell', 'am', 'force-stop', 'com.patrickchin.puptime')
adb('shell', 'am', 'start', '-n', 'com.patrickchin.puptime/.MainActivity')
shot('01-log-two-pets')
tap('preview.pets')
shot('02-manage-pets')
tap('preview.modal.done')
navigate('timeline')
shot('03-timeline-mochi')
tap('preview.scope')
shot('04-pet-picker')
tap('preview.select.pet_preview_1')
shot('05-timeline-maple')
navigate('insights')
shot('06-insights-maple')
navigate('schedule')
shot('07-routine-maple')
navigate('notifications')
shot('08-reminders-maple')
navigate('settings')
shot('09-settings')
tap('preview.widget')
tap('preview.select.pet_preview_1')
shot('10-widget-maple')
tap('preview.modal.done')
tap('preview.dark')
tap('settings.back')
navigate('log')
shot('11-dark-log')
navigate('settings')
tap('preview.dark')
tap('settings.back')

try:
    adb('shell', 'wm', 'size', '984x2100')  # 375 dp wide at the emulator's 420 dpi.
    shot('12-small-phone')
    adb('shell', 'settings', 'put', 'system', 'font_scale', '2.0')
    shot('13-large-text')
    adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
    adb('shell', 'wm', 'size', '2100x984')
    shot('14-landscape')
finally:
    adb('shell', 'wm', 'size', 'reset')
    adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
print('Captured Android screens, 375 dp, large text and landscape.')
