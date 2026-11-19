"""Existing-tag publication custody only; no build, signing, or acceptance approval."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import stat
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET

REPOSITORY = 'patrickchin/puptime'
WORKFLOW = '.github/workflows/android-apk.yml'
PACKAGE = 'com.patrickchin.puptime'
QUALIFICATION_FILES = {'BUILD-INFO.json', 'SHA256SUMS.txt', 'APK-MANIFEST.xml', 'APK-SIGNING.txt',
                       'AAB-MANIFEST.pb', 'AAB-SIGNING.txt', 'AAB-CERTIFICATE.pem', 'AAB-SIGNATURE-VERIFICATION.txt'}
ANDROID = '{http://schemas.android.com/apk/res/android}'


def require(value):
    if not value:
        raise ValueError('Android publication custody rejected.')


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def unique_pairs(items):
    result = {}
    for key, value in items:
        require(key not in result)
        result[key] = value
    return result


def json_value(data):
    return json.loads(data, object_pairs_hook=unique_pairs, parse_constant=lambda _: require(False))


def pins_from_environment(env):
    names = ('run_id', 'run_attempt', 'source_commit', 'tag', 'apk_artifact_id', 'apk_artifact_sha256',
             'qualification_artifact_id', 'qualification_artifact_sha256', 'apk_sha256')
    pins = {name: env.get('PUPTIME_' + name.upper(), '') for name in names}
    require(env.get('GITHUB_REPOSITORY') == REPOSITORY)
    for name in ('run_id', 'run_attempt', 'apk_artifact_id', 'qualification_artifact_id'):
        require(re.fullmatch(r'[1-9][0-9]{0,15}', pins[name]) is not None)
        pins[name] = int(pins[name])
    require(re.fullmatch(r'[a-f0-9]{40}', pins['source_commit']) is not None)
    for name in ('apk_artifact_sha256', 'qualification_artifact_sha256', 'apk_sha256'):
        require(re.fullmatch(r'[a-f0-9]{64}', pins[name]) is not None)
    match = re.fullmatch(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', pins['tag'])
    require(match is not None)
    major, minor, patch = map(int, match.groups())
    pins['version'] = pins['tag'][1:]
    pins['version_code'] = major * 1000000 + minor * 1000 + patch
    require(minor < 1000 and patch < 1000 and 0 < pins['version_code'] <= 2100000000)
    return pins


def api(route):
    result = subprocess.run(['gh', 'api', 'repos/' + REPOSITORY + '/' + route], check=True,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30)
    require(0 < len(result.stdout) <= 2 * 1024 * 1024)
    return json_value(result.stdout)


def tag_commit(tag):
    target = api('git/ref/tags/' + tag)['object']
    for _ in range(5):
        require(re.fullmatch(r'[a-f0-9]{40}', target['sha']) is not None)
        if target['type'] == 'commit':
            return target['sha']
        require(target['type'] == 'tag')
        target = api('git/tags/' + target['sha'])['object']
    require(False)


def timestamp(value):
    require(isinstance(value, str) and value.endswith('Z'))
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))


def metadata(pins):
    run_id, attempt, source = pins['run_id'], pins['run_attempt'], pins['source_commit']
    run = api(f'actions/runs/{run_id}')
    workflow = api('actions/workflows/android-apk.yml')
    # Same artifact-only producer contract as verify-android-signing-upgrade.mjs.
    require(run['id'] == run_id and run['run_attempt'] == attempt and run['head_sha'] == source
            and run['repository']['full_name'] == run['head_repository']['full_name'] == REPOSITORY
            and run['repository']['id'] == run['head_repository']['id']
            and run['path'] == workflow['path'] == WORKFLOW and run['workflow_id'] == workflow['id']
            and run['event'] == 'workflow_dispatch' and run['status'] == 'completed'
            and run['conclusion'] == 'success')
    jobs = api(f'actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100')
    require(jobs['total_count'] == len(jobs['jobs']) == 2)
    by_name = {job['name']: job for job in jobs['jobs']}
    require(set(by_name) == {'build', 'publish'})
    for name, conclusion in (('build', 'success'), ('publish', 'skipped')):
        job = by_name[name]
        require(job['run_id'] == run_id and job['run_attempt'] == attempt and job['head_sha'] == source
                and job['status'] == 'completed' and job['conclusion'] == conclusion)
    build = by_name['build']
    result = api(f'actions/runs/{run_id}/artifacts?per_page=100')
    require(result['total_count'] == len(result['artifacts']) <= 100)
    selected = {}
    for kind, name, maximum in (('apk', 'puptime-android-apk', 512 * 1024 * 1024),
                                ('qualification', 'puptime-android-qualification', 8 * 1024 * 1024)):
        matches = [item for item in result['artifacts'] if item['name'] == name]
        require(len(matches) == 1)
        item = matches[0]
        require(item['id'] == pins[kind + '_artifact_id'] and item['expired'] is False
                and item['digest'] == 'sha256:' + pins[kind + '_artifact_sha256']
                and type(item['size_in_bytes']) is int and 0 < item['size_in_bytes'] <= maximum
                and item['workflow_run']['id'] == run_id and item['workflow_run']['head_sha'] == source
                and item['workflow_run']['head_branch'] == run['head_branch']
                and item['workflow_run']['repository_id'] == item['workflow_run']['head_repository_id'] == run['repository']['id']
                and timestamp(build['started_at']) <= timestamp(item['created_at']) <= timestamp(build['completed_at'])
                and timestamp(item['expires_at']) > datetime.datetime.now(datetime.timezone.utc))
        selected[kind] = {key: item[key] for key in ('id', 'name', 'size_in_bytes', 'digest', 'created_at', 'expires_at')}
    require(tag_commit(pins['tag']) == source)
    return {'artifacts': selected, 'build_job_id': build['id'], 'source': source, 'attempt': attempt}


def download_artifact(item, path):
    # gh owns authentication/redirects. Never read or print its token or signed URL.
    def limit_file():
        resource.setrlimit(resource.RLIMIT_FSIZE, (item['size_in_bytes'] + 1, item['size_in_bytes'] + 1))
    with path.open('xb') as output:
        subprocess.run(['gh', 'api', f"repos/{REPOSITORY}/actions/artifacts/{item['id']}/zip"],
                       stdout=output, stderr=subprocess.DEVNULL, check=True, timeout=300, preexec_fn=limit_file)


def archive(path, item, expected, maximum):
    require(path.stat().st_size == item['size_in_bytes'] and 'sha256:' + digest(path) == item['digest'])
    result = zipfile.ZipFile(path)
    entries = result.infolist()
    require(len(entries) == len(expected) and {entry.filename for entry in entries} == expected)
    for entry in entries:
        require(entry.orig_filename == entry.filename and not entry.is_dir() and not entry.flag_bits & 1
                and stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG)
                and entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                and 0 < entry.file_size <= maximum)
    return result


def manifest_identity(data):
    root = ET.fromstring(data)
    require(root.tag == 'manifest')
    return root.attrib['package'], root.attrib[ANDROID + 'versionName'], int(root.attrib[ANDROID + 'versionCode'])


def signing_identity(text):
    rows = re.findall(r'^Signer #(\d+) certificate SHA-256 digest: ([a-f0-9]{64})$', text, re.MULTILINE)
    require(rows and [int(row[0]) for row in rows] == list(range(1, len(rows) + 1)))
    return [row[1] for row in rows]


def qualification(data, pins):
    info = json_value(data['BUILD-INFO.json'])
    require(set(info) == {'sourceCommit', 'runId', 'configuredPackage', 'configuredVersion', 'configuredVersionCode'})
    expected = PACKAGE, pins['version'], pins['version_code']
    require(info['sourceCommit'] == pins['source_commit'] and info['runId'] == str(pins['run_id'])
            and type(info['configuredVersionCode']) is int
            and (info['configuredPackage'], info['configuredVersion'], info['configuredVersionCode']) == expected)
    rows = data['SHA256SUMS.txt'].decode('ascii').splitlines()
    matches = [re.fullmatch(r'([a-f0-9]{64})  (app-release\.(?:apk|aab))', row) for row in rows]
    require(len(matches) == 2 and all(matches))
    sums = {match[2]: match[1] for match in matches}
    require(set(sums) == {'app-release.apk', 'app-release.aab'} and sums['app-release.apk'] == pins['apk_sha256'])
    require(manifest_identity(data['APK-MANIFEST.xml']) == expected)
    return signing_identity(data['APK-SIGNING.txt'].decode('utf-8'))


def sdk_tool(name):
    root = Path(os.environ['ANDROID_HOME']) / 'build-tools'
    choices = [path / name for path in root.iterdir() if re.fullmatch(r'\d+\.\d+\.\d+', path.name)]
    choices = sorted((path for path in choices if path.is_file() and os.access(path, os.X_OK)),
                     key=lambda path: tuple(map(int, path.parent.name.split('.'))))
    require(choices)
    return str(choices[-1])


def measure_apk(path):
    def command(args):
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, timeout=60)
        require(0 < len(result.stdout) <= 2 * 1024 * 1024)
        return result.stdout.decode('utf-8')
    badging = command([sdk_tool('aapt2'), 'dump', 'badging', str(path)])
    match = re.fullmatch(r"package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'(?: .*)?", badging.splitlines()[0])
    require(match is not None)
    signature = command([sdk_tool('apksigner'), 'verify', '--verbose', '--print-certs', str(path)])
    return (match[1], match[3], int(match[2])), signing_identity(signature)


def create_release(pins, apk, sums, notes):
    subprocess.run(['gh', 'release', 'create', pins['tag'], str(apk) + '#' + apk.name,
                    str(sums) + '#SHA256SUMS.txt', '--repo', REPOSITORY, '--verify-tag',
                    '--title', 'Puptime ' + pins['tag'], '--notes-file', str(notes)], check=True, timeout=180)


def publish_release(pins, notes):
    before = metadata(pins)
    with tempfile.TemporaryDirectory(prefix='puptime-release-custody-') as directory:
        root = Path(directory)
        for kind, item in before['artifacts'].items():
            download_artifact(item, root / (kind + '.zip'))
        with archive(root / 'qualification.zip', before['artifacts']['qualification'], QUALIFICATION_FILES, 2 * 1024 * 1024) as receipt:
            data = {name: receipt.read(name) for name in ('BUILD-INFO.json', 'SHA256SUMS.txt', 'APK-MANIFEST.xml', 'APK-SIGNING.txt')}
        certificates = qualification(data, pins)
        apk = root / ('Puptime-' + pins['version'] + '.apk')
        with archive(root / 'apk.zip', before['artifacts']['apk'], {'app-release.apk'}, 512 * 1024 * 1024) as package:
            with package.open('app-release.apk') as source, apk.open('xb') as target:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    target.write(chunk)
        require(digest(apk) == pins['apk_sha256'])
        measured, actual_certificates = measure_apk(apk)
        require(measured == (PACKAGE, pins['version'], pins['version_code']) and actual_certificates == certificates)
        sums = root / 'SHA256SUMS.txt'
        sums.write_text(pins['apk_sha256'] + '  ' + apk.name + '\n')
        notes_file = root / 'notes.md'
        notes_file.write_text(notes)
        # Revalidate current attempt, producer, tag and artifact clocks immediately before publication.
        require(metadata(pins) == before and digest(apk) == pins['apk_sha256'])
        create_release(pins, apk, sums, notes_file)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        publish_release(pins_from_environment(os.environ), os.environ['PUPTIME_RELEASE_NOTES'])
    except Exception:
        raise SystemExit('Android publication custody failed; no automatic retry. Inspect the pinned inputs and release state.')
