"""Label native large-text captures for the audit and local screenshot gallery."""
from pathlib import Path
from html import escape
import shutil
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[2]
source = root / 'output/large-text'
destination = root / 'docs/multi-pet-ui'

def ios(name):
    matches = sorted((source / 'ios-final').rglob(name + '.png'))
    assert matches, name
    return matches[-1]

groups = [
    ('06-large-text-log', 'Large text: give each action room', [
        ('Previous: narrow tiles', source / 'before-ios-log.png'),
        ('Revised: full-width action rows', ios('01-ios-log')),
    ]),
    ('07-large-text-details', 'Large text: names, sheets and controls', [
        ('iPhone: full pet names', ios('03-ios-long-name')),
        ('iPhone: readable timing options', ios('08-ios-timing-picker')),
        ('Android: dark Log', source / 'android/04-dark-log.png'),
        ('Android: reminder controls', source / 'android/05-reminders.png'),
    ]),
]
font = '/System/Library/Fonts/Supplemental/Arial.ttf'
heading = ImageFont.truetype(font, 25)
label = ImageFont.truetype(font, 18)
caption = ImageFont.truetype(font, 16)
for name, title, panels in groups:
    canvas = Image.new('RGB', (920, 108 + ((len(panels) + 1) // 2) * 990), '#E8E9E4')
    draw = ImageDraw.Draw(canvas)
    draw.text((24, 20), title, fill='#17231E', font=heading)
    draw.text((24, 58), 'Native screenshots · Largest iPhone text / 2× Android text · Sample data', fill='#44564C', font=caption)
    for i, (text, path) in enumerate(panels):
        image = Image.open(path).convert('RGB')
        image.thumbnail((424, 936), Image.Resampling.LANCZOS)
        x, y = 24 + (i % 2) * 460, 108 + (i // 2) * 990
        draw.text((x, y), text, fill='#17231E', font=label)
        canvas.paste(image, (x, y + 34))
    canvas.save(destination / (name + '.png'), optimize=True)

gallery = root / 'output/multi-pet-audit/gallery/large-text'
gallery.mkdir(exist_ok=True)
latest_ios = {path.name: path for path in sorted((source / 'ios-final').rglob('*.png')) if 'takeScreenshot' in path.parts}
paths = [source / 'before-ios-log.png', *latest_ios.values(), *sorted((source / 'android').glob('*.png')), source / '10-ipad.png', *sorted((source / 'row-check').glob('*.png'))]
figures = []
for i, path in enumerate(paths):
    if not path.exists():
        continue
    name = f'{i:02d}-{path.name}'
    shutil.copy2(path, gallery / name)
    text = path.stem.replace('-', ' ')
    figures.append(f'<figure><a href="{escape(name)}"><img loading="lazy" src="{escape(name)}" alt="{escape(text)}"></a><figcaption>{escape(text)}</figcaption></figure>')
(gallery / 'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Puptime large text</title><style>body{font:16px/1.5 system-ui;margin:32px;background:#f5f3ec;color:#17231e}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:28px}figure{margin:0}img{width:100%;height:650px;object-fit:contain;object-position:top;border-radius:12px}figcaption{padding:8px}</style><h1>Puptime: revised large-text UI</h1><p>Native phone/tablet captures with sample data. Click a screenshot for full resolution.</p><main>''' + ''.join(figures) + '</main></html>')
print(f'Built two contact sheets and a gallery of {len(figures)} screenshots.')
