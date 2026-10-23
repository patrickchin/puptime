"""Build labeled contact sheets from native screenshots, keeping full originals."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from html import escape
import shutil

root = Path(__file__).resolve().parents[2]
output = root / 'output/multi-pet-audit'
destination = root / 'docs/multi-pet-ui'
destination.mkdir(exist_ok=True)

def screenshot(folder, name):
    matches = sorted((output / folder).rglob(name + '.png'))
    assert matches, (folder, name)
    return matches[-1]

ios = lambda name: screenshot('ios-final', name)
state = lambda name: screenshot('ios-states-pass', name)
android = lambda name: output / 'android-final' / (name + '.png')
groups = [
    ('01-log', 'Log: current app and multi-pet proposal', [
        ('Current app: one active pet', output / '00-current-single-pet.png'),
        ('Proposal: both pets + named history', output / '26-final-ios-log.png'),
    ]),
    ('02-individual-views', 'Each pet keeps its own patterns and routine', [
        ('Mochi: Timeline', ios('03-timeline-mochi')),
        ('Maple: Insights', ios('06-insights-maple')),
        ('Mochi: three-meal routine', ios('08-routine-mochi')),
        ('Maple: two-meal routine', ios('07-routine-maple')),
    ]),
    ('03-management', 'Pet management, reminders and widget target', [
        ('Manage three pets', state('20-renamed-pet')),
        ('Add a pet: native name entry', state('17-add-pet')),
        ('Mochi: reminder settings', ios('09-reminders-mochi')),
        ('Widget proposal: fixed target Maple', ios('11-widget-maple')),
    ]),
    ('04-more-states', 'Android, dark appearance, new pet and large text', [
        ('Android: combined Log', android('01-log-two-pets')),
        ('iPhone: dark appearance', ios('13-dark-log')),
        ('New pet: empty journal', state('18-new-pet-empty')),
        ('iPhone: revised largest-text Log', output / '24-ios-largest-text-fixed.png'),
    ]),
    ('05-accessibility-fix', 'Large text: first render and corrected layout', [
        ('First render: clipped branding / initials', output / '23-ios-largest-text.png'),
        ('Revised: bounded brand / readable controls', output / '24-ios-largest-text-fixed.png'),
    ]),
]
font_path = '/System/Library/Fonts/Supplemental/Arial.ttf'
title_font = ImageFont.truetype(font_path, 25)
label_font = ImageFont.truetype(font_path, 18)
small_font = ImageFont.truetype(font_path, 16)
width, gutter, phone_width = 920, 24, 424
cell_height = 990
for slug, title, panels in groups:
    canvas = Image.new('RGB', (width, 108 + ((len(panels) + 1) // 2) * cell_height), '#E8E9E4')
    draw = ImageDraw.Draw(canvas)
    draw.text((24, 20), title, fill='#17231E', font=title_font)
    draw.text((24, 58), 'Native screenshots · Synthetic data · UI proposal, not production multi-pet support', fill='#44564C', font=small_font)
    for index, (label, source) in enumerate(panels):
        image = Image.open(source).convert('RGB')
        image.thumbnail((phone_width, cell_height - 54), Image.Resampling.LANCZOS)
        x = gutter + (index % 2) * (width // 2)
        y = 108 + (index // 2) * cell_height
        draw.text((x, y), label, fill='#17231E', font=label_font)
        canvas.paste(image, (x, y + 34))
    canvas.save(destination / (slug + '.png'), optimize=True)

# Full-resolution originals are local review artifacts; the compact contact
# sheets above are kept in Git so the PR also has durable visual evidence.
gallery = output / 'gallery'
gallery.mkdir(exist_ok=True)
sources = [output / '00-current-single-pet.png']
for folder in ['ios-final', 'ios-states-pass', 'android-final']:
    latest = {source.name: source for source in sorted((output / folder).rglob('*.png')) if 'screenshots' not in source.parts}
    sources.extend(latest.values())
sources.extend([output / '21-ipad-portrait.png', output / '24-ios-largest-text-fixed.png', output / '25-android-large-text-fixed.png', output / 'row-check/populated-history-editor.png', output / '27-reduced-motion-android.png'])
items = []
for index, source in enumerate(sources):
    if not source.exists() or 'screenshots' in source.parts:
        continue
    name = f'{index:02d}-{source.stem}.png'
    shutil.copy2(source, gallery / name)
    label = source.stem.replace('-', ' ')
    platform = 'Android' if 'android-final' in source.parts or 'android' in source.stem or 'row-check' in source.parts else 'iPhone / iPad'
    items.append(f'<figure><a href="{escape(name)}"><img loading="lazy" src="{escape(name)}" alt="{escape(label)}"></a><figcaption>{platform} · {escape(label)}</figcaption></figure>')
(gallery / 'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Puptime multiple-pet UI audit</title><style>body{font:16px/1.5 system-ui;margin:32px;background:#f5f3ec;color:#17231e}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:28px}figure{margin:0}img{width:100%;height:650px;object-fit:contain;object-position:top;border-radius:12px}figcaption{padding:8px}h1{line-height:1.2}</style><h1>Puptime: multiple-pet UI proposal</h1><p>Native captures with sample data. The production app still supports one puppy. Click a screenshot for its full resolution.</p><main>''' + ''.join(items) + '</main></html>')
print(f'Wrote {len(groups)} contact sheets and a gallery of {len(items)} native screenshots.')
