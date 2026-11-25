#!/usr/bin/env python3
"""Verify the offline font/icon payload and observed font bytes in an exact APK/AAB.

This checks the scoped font/icon inventory, not every software library's notices.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FONT_HEADERS = {b'\x00\x01\x00\x00', b'OTTO', b'true', b'ttcf', b'wOFF', b'wOF2'}
NOTICE = 'assets/puptime/font-icon-notices.json'


def check(candidate, root=ROOT):
    provenance = json.loads((root / 'scripts/font-icon-provenance.json').read_text())
    payload = (root / 'src/font-icon-notices.json').read_bytes()
    notice_hash = hashlib.sha256(payload).hexdigest()
    sections = json.loads(payload)
    if {item['id']: hashlib.sha256(item['body'].encode()).hexdigest() for item in sections} != provenance['notices']:
        raise ValueError('unreviewed-notice-source')
    fonts = []
    with zipfile.ZipFile(candidate) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or any(PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts for name in names):
            raise ValueError('invalid-archive')
        entries = [name for name in [NOTICE, 'base/' + NOTICE] if name in names]
        if len(entries) != 1:
            raise ValueError('missing-notice')
        entry = entries[0]
        if archive.getinfo(entry).file_size != len(payload) or archive.read(entry) != payload:
            raise ValueError('notice-mismatch')
        for info in archive.infolist():
            if info.is_dir():
                continue
            with archive.open(info) as stream:
                header = stream.read(4)
            if header not in FONT_HEADERS and Path(info.filename).suffix.lower() not in {'.ttf', '.otf', '.woff', '.woff2', '.ttc'}:
                continue
            if info.file_size > 16 * 1024 * 1024:
                raise ValueError('font-too-large')
            digest = hashlib.sha256(archive.read(info)).hexdigest()
            component = provenance['archiveFonts'].get(digest)
            if component is None:
                raise ValueError('unreviewed-font')
            fonts.append({'entry':info.filename, 'sha256':digest, 'component':component})
    if not set(provenance['requiredAndroidFonts']).issubset({font['component'] for font in fonts}):
        raise ValueError('missing-used-icon-font')
    digest = hashlib.sha256()
    with candidate.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return {'schema':1, 'scope':'android-font-icon-notices', 'status':'passed',
            'archiveSHA256':digest.hexdigest(), 'noticeEntry':entry,
            'noticeSHA256':notice_hash, 'fonts':sorted(fonts, key=lambda font:font['entry']),
            'otherSoftwareNoticesQualified':False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        result = check(args.candidate)
    except ValueError as error:
        known = {'unreviewed-notice-source', 'invalid-archive', 'missing-notice', 'notice-mismatch', 'font-too-large', 'unreviewed-font', 'missing-used-icon-font'}
        print('Font notice check failed: ' + (str(error) if str(error) in known else 'invalid-input'), file=sys.stderr)
        return 1
    except (OSError, KeyError, zipfile.BadZipFile):
        print('Font notice check failed: invalid-input', file=sys.stderr)
        return 1
    encoded = json.dumps(result, indent=2) + '\n'
    if args.output:
        args.output.write_text(encoded)
    else:
        print(encoded, end='')
    return 0


if __name__ == '__main__':
    sys.exit(main())
