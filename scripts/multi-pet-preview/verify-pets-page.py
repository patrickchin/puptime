"""Exercise pet management on a dedicated Android preview, never a personal journal."""
import hashlib
import json
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

serial = sys.argv[1]
output = Path(sys.argv[2] if len(sys.argv) > 2 else 'output/pets-page')
output.mkdir(parents=True, exist_ok=True)
app = 'com.patrickchin.puptime'

def adb(*args):
    return subprocess.check_output(['adb', '-s', serial, *args], stderr=subprocess.PIPE, timeout=35)

assert re.match(r'^Puptime_(Multi_Pet_622c|Navigation_d859|History_Spacing_d859)\b', adb('emu', 'avd', 'name').decode())

def journal():
    hashes = {}
    for suffix in ['', '-wal']:
        try:
            hashes[suffix] = hashlib.sha256(adb('exec-out', 'run-as', app, 'cat', 'files/SQLite/puptime-v2.db' + suffix)).hexdigest()
        except subprocess.SubprocessError:
            pass
    return hashes

def hierarchy():
    adb('shell', 'uiautomator', 'dump', '/sdcard/puptime-pets.xml')
    return ET.fromstring(adb('shell', 'cat', '/sdcard/puptime-pets.xml'))

def node(identifier):
    for _ in range(8):
        match = next((n for n in hierarchy().iter('node') if n.get('resource-id') == identifier), None)
        if match is not None:
            return match
    raise AssertionError('Missing visible control: ' + identifier)

def tap(identifier):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node(identifier).get('bounds')))
    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))
    time.sleep(.3)

def title(value):
    assert node('nav.title').get('text') == value
    print('Screen:', value, flush=True)

def shot(name):
    (output / (name + '.png')).write_bytes(adb('exec-out', 'screencap', '-p'))

def name(value):
    tap('preview.name')
    adb('shell', 'input', 'keyevent', '123')
    adb('shell', 'input', 'keyevent', *(['67'] * 40))
    if value:
        adb('shell', 'input', 'text', value.replace(' ', '%s'))

def navigate(destination):
    tap('nav.open')
    tap('nav.' + destination)

before = journal()
adb('shell', 'am', 'force-stop', app)
adb('shell', 'am', 'start', '-W', '-n', app + '/.MainActivity')
node('preview.pets')
tap('nav.open'); node('nav.pets'); shot('01-navigation')
tap('nav.pets'); title('Pets'); node('preview.pets.page')
root = hierarchy()
assert not any(n.get('resource-id') in ['preview.modal.done', 'preview.scope', 'nav.switch'] for n in root.iter('node'))
assert len([n for n in root.iter('node') if n.get('resource-id', '').startswith('preview.rename.')]) == 2
shot('02-pets')
tap('preview.rename.pet_preview_1'); title('Edit pet')
assert node('preview.name').get('text') == 'Maple'
shot('03-edit-pet')
name(''); tap('preview.name.save')
assert any(n.get('text') == 'Enter a name.' for n in hierarchy().iter('node'))
name('MOCHI'); tap('preview.name.save')
assert any(n.get('text') == 'Another pet uses that name. Add a nickname.' for n in hierarchy().iter('node'))
tap('nav.back'); title('Pets')
assert node('preview.rename.pet_preview_1').get('content-desc') == 'Edit Maple'
tap('preview.rename.pet_preview_1'); name('Maple Rose'); tap('preview.name.save'); title('Pets')
assert node('preview.rename.pet_preview_1').get('content-desc') == 'Edit Maple Rose'
tap('preview.add'); title('Add a pet'); name('Sir Waffles Wellington'); tap('preview.name.save'); title('Pets')
root = hierarchy()
assert len([n for n in root.iter('node') if n.get('resource-id', '').startswith('preview.rename.')]) == 3
assert any(n.get('text') == '0 logs' for n in root.iter('node'))
shot('04-three-pets')
tap('preview.add'); name('Unsaved'); tap('nav.back'); title('Pets')
assert len([n for n in hierarchy().iter('node') if n.get('resource-id', '').startswith('preview.rename.')]) == 3
navigate('timeline'); title('Timeline')
assert 'Mochi' in node('preview.scope').get('content-desc')
tap('preview.scope'); tap('preview.select.pet_preview_1')
assert 'Maple Rose' in node('preview.scope').get('content-desc')
tap('preview.scope'); tap('preview.manage'); title('Pets'); tap('nav.back'); title('Timeline')
assert 'Maple Rose' in node('preview.scope').get('content-desc')
navigate('settings'); tap('preview.data.pet'); tap('preview.manage'); title('Pets')
adb('shell', 'input', 'keyevent', '4'); title('Settings')
tap('settings.back'); title('Timeline')
navigate('log'); tap('preview.pets'); title('Pets'); tap('nav.back'); title('Log')
navigate('settings'); tap('preview.dark'); tap('settings.back'); navigate('pets'); title('Pets'); shot('05-dark-pets')
navigate('settings'); tap('preview.dark'); tap('settings.back'); title('Pets')
font = adb('shell', 'settings', 'get', 'system', 'font_scale').decode().strip()
try:
    adb('shell', 'wm', 'size', '984x2100')
    adb('shell', 'settings', 'put', 'system', 'font_scale', '2.0')
    # Android configuration changes recreate this in-memory preview.
    adb('shell', 'am', 'force-stop', app)
    adb('shell', 'am', 'start', '-W', '-n', app + '/.MainActivity')
    tap('preview.pets'); title('Pets'); node('preview.add'); shot('06-large-text-pets')
    tap('preview.rename.pet_preview_1'); title('Edit pet')
    heading_bounds = list(map(int, re.findall(r'\d+', node('nav.title').get('bounds'))))
    save_bounds = list(map(int, re.findall(r'\d+', node('preview.name.save').get('bounds'))))
    assert heading_bounds[1] < save_bounds[3] and save_bounds[1] < heading_bounds[3], 'Save stays beside the title at 2x text.'
    shot('07-large-text-edit')
    tap('nav.back'); title('Pets')
    adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
    adb('shell', 'wm', 'size', '2100x984')
    adb('shell', 'am', 'force-stop', app)
    adb('shell', 'am', 'start', '-W', '-n', app + '/.MainActivity')
    tap('preview.pets'); title('Pets'); node('preview.add'); shot('08-landscape-pets')
finally:
    adb('shell', 'wm', 'size', 'reset')
    adb('shell', 'settings', 'put', 'system', 'font_scale', font)
assert journal() == before, 'Pet management must not touch the production journal.'
(output / 'pets-result.json').write_text(json.dumps({'passed': True, 'productionSqliteUnchanged': True, 'productionSqliteFiles': list(before), 'covered': ['menu destination', 'full-page forms', 'blank/duplicate names', 'rename/save/cancel', 'add with empty history', 'contextual and Android Back', 'preserved selected pet', 'dark', '375dp at 2x text', 'landscape']}, indent=2))
print('PASS: full-page pet management, validation, Back, selection, layouts, and unchanged production journal.')
