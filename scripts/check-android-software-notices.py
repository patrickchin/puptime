#!/usr/bin/env python3
"""Bind reviewed software notice bytes to an exact APK/AAB and resolved inputs.

Native library origin and runtime UI acceptance are separate qualification reports.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NOTICE = 'assets/puptime/android-software-notices.json'
MAX_JSON = 8 * 1024 * 1024


def sha(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def read_json(path):
    if path.stat().st_size > MAX_JSON:
        raise ValueError('oversized-input')
    return json.loads(path.read_bytes())


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def ordered(rows):
    return sorted({canonical(row): row for row in rows}.values(), key=canonical)


def component_inputs(inventory):
    def select(row, keys):
        return {key: row[key] for key in keys if key in row}
    return {
        'components': ordered([{**select(row, ['component', 'name', 'version', 'ecosystem']), 'notices': ordered(row['notices'])} for row in inventory['components']]),
        'mavenArtifacts': ordered([select(row, ['component', 'file', 'sha256', 'npmSource']) for row in inventory['mavenArtifacts']]),
        'nativeProjects': ordered([select(row, ['component', 'packagePath', 'packageJSONSHA256', 'integrity', 'sourcePath', 'sourceSHA256']) for row in inventory['nativeProjects']]),
        'metroPackages': ordered([select(row, ['component', 'packagePath', 'packageJSONSHA256', 'integrity']) for row in inventory['metroPackages']]),
    }


def source_payload(root):
    manifest = read_json(root / 'scripts/android-software-notice-provenance.json')
    payload = (root / 'src/android-software-notices.json').read_bytes()
    if len(payload) > MAX_JSON or sha(payload) != manifest['payloadSHA256']:
        raise ValueError('source-payload-mismatch')
    sections = json.loads(payload)
    by_id = {section['id']: section for section in sections}
    if len(by_id) != len(sections) or len({sha(section['body']) for section in sections}) != len(sections):
        raise ValueError('duplicate-source-document')
    if {value['sectionId'] for value in manifest['texts']} != set(by_id):
        raise ValueError('unreviewed-source-document')
    for value in manifest['texts']:
        section = by_id[value['sectionId']]
        if sha(section['body']) != value['sha256'] or not section.get('attributions'):
            raise ValueError('source-document-mismatch')
        if value.get('presentationSHA256') and sha(section['displayBody']) != value['presentationSHA256']:
            raise ValueError('source-document-mismatch')
    documents = {value['id']: value for value in manifest['publisherDocuments']}
    for document in documents.values():
        original = ''.join(piece['literal'] if 'literal' in piece else by_id[piece['sectionId']]['body'] for piece in document['pieces'])
        if sha(original) != document['sourceSHA256']:
            raise ValueError('publisher-document-mismatch')
        index = next((section for section in sections if sha(section['body']) == document['indexSHA256']), None)
        names = set(json.loads(index['body'])) if index and index.get('kind') == 'index' else set()
        if not names or any(any(name not in names for name in piece.get('literal', '').strip().rstrip(':').split(', '))
                            for piece in document['pieces'] if piece.get('literal', '').strip()):
            raise ValueError('unpresented-publisher-text')
    ids = [value['component'] for value in manifest['components']]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError('invalid-reviewed-inventory')
    for component in manifest['components']:
        label = component['name'] + ' ' + component['version']
        if not component['notices']:
            raise ValueError('uncovered-component')
        for notice in component['notices']:
            if notice.get('documentId'):
                document = documents[notice['documentId']]
                if (document['sourceSHA256'] != notice['sha256']
                        or set(notice['sectionIds']) != {piece['sectionId'] for piece in document['pieces'] if 'sectionId' in piece}):
                    raise ValueError('source-document-mismatch')
            elif notice.get('sha256') and sha(by_id[notice['sectionId']]['body']) != notice['sha256']:
                raise ValueError('source-document-mismatch')
            for id in notice.get('sectionIds', [notice.get('sectionId')]):
                section = by_id[id]
                if not any(value == label or value.startswith(label + ' — ') for value in section['attributions']):
                    raise ValueError('missing-component-attribution')
        for observed in component['observedNotices']:
            if not any(value.get('source') == observed['source'] and value.get('sha256') == observed['sha256'] for value in component['notices']):
                raise ValueError('uncovered-observed-notice')
    for vendor in manifest['nativeVendors']:
        if not set(vendor['ownerComponents']).issubset(ids):
            raise ValueError('unknown-vendor-owner')
        for notice in vendor['notices']:
            if sha(by_id[notice['sectionId']]['body']) != notice['sha256']:
                raise ValueError('source-document-mismatch')
    for notice in manifest['runtimeCandidate']['notices']:
        if sha(by_id[notice['sectionId']]['body']) != notice['sha256']:
            raise ValueError('source-document-mismatch')
    return manifest, payload


def check(candidate, inventory_path, root=ROOT):
    manifest, payload = source_payload(root)
    if manifest['status'] != 'REVIEWED_SOURCE':
        raise ValueError('incomplete-source-review')
    inventory = read_json(inventory_path)
    if inventory.get('schema') != 1:
        raise ValueError('invalid-resolved-inventory')
    actual = component_inputs(inventory)
    if (sha(canonical(actual)) != manifest['sourceInputs']['componentInputsSHA256']
            or {row['component'] for row in inventory['components']} != {row['component'] for row in manifest['components']}):
        raise ValueError('resolved-input-mismatch')
    with zipfile.ZipFile(candidate) as archive:
        names = archive.namelist()
        if (len(names) > 100000 or len(names) != len(set(names))
                or any(PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts
                       or '\\' in name or re.match(r'^[A-Za-z]:', name) for name in names)):
            raise ValueError('invalid-archive')
        matches = [name for name in [NOTICE, 'base/' + NOTICE] if name in names]
        if len(matches) != 1:
            raise ValueError('missing-software-payload')
        entry = matches[0]
        if archive.getinfo(entry).file_size != len(payload) or archive.read(entry) != payload:
            raise ValueError('packaged-payload-mismatch')
    digest = hashlib.sha256()
    with candidate.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return {'schema': 1, 'scope': 'android-software-notice-payload', 'status': 'passed',
            'archiveSHA256': digest.hexdigest(), 'noticeEntry': entry,
            'payloadSHA256': sha(payload), 'componentInputsSHA256': sha(canonical(actual)),
            'reviewedComponents': len(manifest['components']), 'verbatimDocuments': len(manifest['texts']),
            'nativeOriginQualified': False, 'runtimeUIQualified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        result = check(args.candidate, args.inventory)
    except (ValueError, KeyError, TypeError, OSError, RuntimeError, NotImplementedError, zipfile.BadZipFile):
        print('Software notice verification failed closed; source review, inventory or archive did not match.', file=sys.stderr)
        return 1
    encoded = json.dumps(result, indent=2) + '\n'
    if args.output:
        args.output.write_text(encoded)
    else:
        print(encoded, end='')
    return 0


if __name__ == '__main__':
    sys.exit(main())
