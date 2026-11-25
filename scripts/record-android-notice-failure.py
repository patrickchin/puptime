"""Closed discovery-stage evidence only. Never reads Gradle logs or app data."""
import json
import os
from pathlib import Path
import re

STAGES = ['source-admission', 'locked-install', 'prebuild', 'tool-staging', 'gradle-resolution', 'metro-collection', 'public-projection']
CLASSES = ['ResolveException', 'GradleException', 'IOException', 'IllegalArgumentException', 'IllegalStateException', 'SecurityException', 'Error', 'Throwable']


def exact(value, keys):
    assert isinstance(value, dict) and set(value) == set(keys)


def digest(value):
    assert isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value)
    return value


def finite_collector(value, source):
    """Revalidate only the unchanged pinned init's finite class/category/hash schema."""
    try:
        exact(value, ['schema', 'status', 'complete', 'sourceCommit', 'platform', 'stage', 'setup'])
        assert value['schema'] == 1 and value['status'] == 'INCOMPLETE' and value['complete'] is False
        assert value['sourceCommit'] == source and value['platform'] == 'android' and value['stage'] == 'setup'
        setup = value['setup']
        exact(setup, ['phase', 'errorCategory'] + (['collector'] if 'collector' in setup else []))
        assert setup['phase'] == 'gradle-resolution' and setup['errorCategory'] == 'command-failed'
        if 'collector' not in setup:
            return None
        item = setup['collector']
        exact(item, ['phase', 'errorClass', 'causeChain', 'causeChainEnd'] + (['selection'] if 'selection' in item else []))
        assert item['phase'] in ['root-binding', 'task-registration', 'runtime-resolution', 'artifact-collection']
        assert item['errorClass'] in CLASSES and item['causeChainEnd'] in ['end', 'limit', 'cycle', 'unreadable']
        assert isinstance(item['causeChain'], list) and 1 <= len(item['causeChain']) <= 8
        assert item['causeChainEnd'] != 'limit' or len(item['causeChain']) == 8
        chain = []
        for row in item['causeChain']:
            exact(row, ['errorClass', 'classSHA256'])
            assert row['errorClass'] in CLASSES
            chain.append({'errorClass': row['errorClass'], 'classSHA256': digest(row['classSHA256'])})
        assert item['errorClass'] == chain[0]['errorClass']
        result = {'phase': item['phase'], 'errorClass': item['errorClass'], 'causeChain': chain, 'causeChainEnd': item['causeChainEnd']}
        if 'selection' in item:
            selection = item['selection']
            exact(selection, ['failureClassSHA256', 'componentKind', 'componentSHA256'])
            assert sum(row['classSHA256'] == '2a5335183636baba800ed56814f24536518c33cbd68932ba9a3fd10004d2b5fd' for row in chain) == 1
            assert selection['componentKind'] in ['module', 'main-project']
            result['selection'] = {'failureClassSHA256': digest(selection['failureClassSHA256']), 'componentKind': selection['componentKind'], 'componentSHA256': digest(selection['componentSHA256'])}
        return result
    except (AssertionError, KeyError, TypeError, ValueError):
        return None


def receipt(source, run, attempt, outcomes, collector=None):
    assert re.fullmatch(r'[a-f0-9]{40}', source) and re.fullmatch(r'[1-9][0-9]{0,19}', run)
    assert re.fullmatch(r'[1-9][0-9]{0,5}', attempt) and len(outcomes) == len(STAGES)
    failed = next((i for i, value in enumerate(outcomes) if value in ['failure', 'cancelled']), None)
    index = failed if failed is not None else next((i for i, value in enumerate(outcomes) if value != 'success'), None)
    stage = STAGES[index] if index is not None else 'complete'
    category = {'failure': 'step-failed', 'cancelled': 'cancelled', 'success': 'success', 'skipped': 'not-run', '': 'not-run'}.get(outcomes[index], 'unknown') if index is not None else 'success'
    return {'schema': 1, 'status': 'INCOMPLETE', 'complete': False, 'diagnosticOnly': True, 'sourceCommit': source,
            'runId': run, 'runAttempt': int(attempt), 'stage': stage, 'exitCategory': category,
            'collector': finite_collector(collector, source) if stage == 'gradle-resolution' else None,
            'scope': 'Discovery command-stage evidence only; a class/hash is not an underlying cause or release qualification.'}


if __name__ == '__main__':
    try:
        raw = Path('build/notices/android/failure.json')
        value = None
        if raw.is_file() and not raw.is_symlink() and 0 < raw.stat().st_size <= 4096:
            try:
                descriptor = os.open(raw, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(descriptor, 'rb') as stream:
                    data = stream.read(4097)
                if 0 < len(data) <= 4096:
                    value = json.loads(data.decode('utf-8'))
            except (OSError, UnicodeError, ValueError):
                pass
        result = receipt(os.environ['GITHUB_SHA'], os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT'],
                         [os.environ.get('PUPTIME_NOTICE_' + stage.upper().replace('-', '_'), '') for stage in STAGES], value)
        output = Path('build/notices/android/review/failure.json')
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        encoded = json.dumps(result, indent=2) + '\n'
        assert len(encoded.encode()) <= 8192
        with output.open('x') as target:
            os.fchmod(target.fileno(), 0o600)
            target.write(encoded)
        print('PASS finite Android discovery diagnostic receipt; no raw errors, paths or logs.')
    except (AssertionError, KeyError, OSError, TypeError, ValueError):
        print('Finite Android discovery diagnostic capture failed closed.')
        raise SystemExit(1)
