#!/usr/bin/env python3
"""Reject known noncommercial recordings in a candidate; never grants rights."""
import argparse
import hashlib
import json
import plistlib
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LEDGER = ROOT / 'assets/puppy-care/audio/commercial-rights.json'


def check(candidate, ios_version=None, ios_build=None):
    ledger = json.loads(LEDGER.read_text())
    blocked = {item['sha256']: item['filename'] for item in ledger['recordings']}
    sizes = {item['bytes'] for item in ledger['recordings']}
    found = set()
    if not candidate.is_file():
        raise ValueError('Pass the exact candidate IPA, AAB or APK archive.')
    with zipfile.ZipFile(candidate) as archive:
        # Bundlers may rename assets. Inspect matching-size bytes, not filenames.
        for entry in archive.infolist():
            if entry.file_size in sizes:
                digest = hashlib.sha256(archive.read(entry)).hexdigest()
                if digest in blocked:
                    found.add(blocked[digest])
        if ios_version is not None or ios_build is not None:
            if not ios_version or not ios_build:
                raise ValueError('Both --ios-version and --ios-build are required.')
            infos = [entry for entry in archive.namelist()
                     if entry.startswith('Payload/') and entry.count('/') == 2
                     and entry.endswith('.app/Info.plist')]
            if len(infos) != 1:
                raise ValueError('Expected exactly one top-level iOS app Info.plist.')
            info = plistlib.loads(archive.read(infos[0]))
            expected = {'CFBundleIdentifier': 'com.patrickchin.puptime',
                        'CFBundleShortVersionString': ios_version,
                        'CFBundleVersion': ios_build}
            if any(str(info.get(key)) != value for key, value in expected.items()):
                raise ValueError('Candidate bundle identifier/version/build does not match submission.')
    return sorted(found)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('--ios-version')
    parser.add_argument('--ios-build')
    args = parser.parse_args()
    try:
        found = check(args.candidate, args.ios_version, args.ios_build)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, plistlib.InvalidFileException) as error:
        print(f'Candidate check failed: {error}', file=sys.stderr)
        return 2
    if found:
        print('Blocked: known noncommercial recordings are still bundled: ' + ', '.join(found), file=sys.stderr)
        return 1
    print('No byte-identical restricted recordings found. This does not establish other asset rights or store readiness.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
