#!/usr/bin/env python3
"""Compose real native captures for the store. Requires Pillow; no generated UI.

Usage: python3 scripts/render-store-screenshots.py CAPTURE_ROOT
CAPTURE_ROOT contains iphone/ and ipad/, each with one Maestro takeScreenshot/.
"""
import hashlib
import json
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
captures = Path(sys.argv[1]).expanduser().resolve()
destination = root / 'fastlane/screenshots/en-US'
destination.mkdir(parents=True, exist_ok=True)
font_path = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
slides = [
    ('01-log', 'Log potty breaks\nin a tap'),
    ('02-timeline', 'Spot patterns\nacross the week'),
    ('03-insights', 'See how often\nyour puppy goes'),
    ('04-routine', 'Build a routine\naround your day'),
    ('05-details', 'Add the details\nyou’ll want later'),
    ('06-dark', 'Keep track,\neven after dark'),
]
manifest = []
thumbnails = []
for device, size, prefix in [('iphone', (1206, 2622), 'iPhone-6.3'), ('ipad', (2064, 2752), 'iPad-13')]:
    for stem, headline in slides:
        matches = list((captures / device).rglob(f'takeScreenshot/{stem}.png'))
        assert len(matches) == 1, f'Expected one fresh capture for {device}/{stem}; got {len(matches)}'
        source = matches[0]
        screen = Image.open(source).convert('RGB')
        assert screen.size == size, (source, screen.size, size)
        dark = stem == '06-dark'
        background, ink = ('#142B24', '#E7F2E8') if dark else ('#F4F1E7', '#173D30')
        canvas = Image.new('RGB', size, background)
        draw = ImageDraw.Draw(canvas)
        width, height = size
        font = ImageFont.truetype(font_path, 83 if device == 'iphone' else 112)
        for line_number, line in enumerate(headline.splitlines()):
            draw.text((width // 2, 75 + line_number * (font.size + 12)), line, fill=ink, font=font, anchor='mt')
        top = 345 if device == 'iphone' else 400
        available = height - top - 65
        screen.thumbnail((width - 130, available), Image.Resampling.LANCZOS)
        x = (width - screen.width) // 2
        # A simple rounded panel keeps the actual screen pixels intact inside it.
        draw.rounded_rectangle((x - 3, top - 3, x + screen.width + 3, top + screen.height + 3), radius=46, fill='#97A89D')
        mask = Image.new('L', screen.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, screen.width - 1, screen.height - 1), radius=43, fill=255)
        canvas.paste(screen, (x, top), mask)
        name = f'{prefix}-{stem}.png'
        canvas.save(destination / name, optimize=True)
        manifest.append(dict(file=name, dimensions=list(size), headline=headline,
                             source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                             sha256=hashlib.sha256((destination / name).read_bytes()).hexdigest()))
        if device == 'iphone':
            thumb = canvas.copy(); thumb.thumbnail((241, 525)); thumbnails.append(thumb)
contact = Image.new('RGB', (241 * 6, 525), '#F4F1E7')
for index, thumbnail in enumerate(thumbnails): contact.paste(thumbnail, (241 * index, 0))
contact.save(captures / 'store-contact.jpg', quality=92)
# Optional iOS 27 creative placements have different requirements from screenshots.
creative = root / 'fastlane/creative-assets/en-US'
creative.mkdir(parents=True, exist_ok=True)
logo = Image.open(root / 'assets/puptime-icon.png').convert('RGB')
source = next((captures / 'iphone').rglob('takeScreenshot/01-log.png'))
for name, size, scale in [('header', (3840, 1646), 1), ('search', (1920, 1280), .64)]:
    art = Image.new('RGB', size, '#F4F1E7')
    draw = ImageDraw.Draw(art)
    left = int(size[0] * .16)
    top = int(size[1] * .2)
    mark = logo.resize((int(170 * scale), int(170 * scale)), Image.Resampling.LANCZOS)
    art.paste(mark, (left, top))
    font = ImageFont.truetype(font_path, int(125 * scale))
    for line_number, line in enumerate(['Know when your', 'puppy last went.']):
        draw.text((left, top + int(250 * scale) + line_number * int(155 * scale)), line, font=font, fill='#173D30')
    draw.text((left, top + int(650 * scale)), 'Puptime', font=ImageFont.truetype(font_path, int(65 * scale)), fill='#176B52')
    screen = Image.open(source).convert('RGB')
    screen.thumbnail((int(size[0] * .24), int(size[1] * .8)), Image.Resampling.LANCZOS)
    art.paste(screen, (int(size[0] * .64), (size[1] - screen.height) // 2))
    art.save(creative / f'{name}.png', optimize=True)
(root / 'fastlane/screenshot-manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
print(f'Composed {len(manifest)} opaque store screenshots. Review {captures / "store-contact.jpg"}')
