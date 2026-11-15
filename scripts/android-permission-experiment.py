"""Closed disposable QA evidence only. Import/self-check never reads real app inputs."""
import hashlib, json, os, re, stat, sys, zipfile
from pathlib import Path

SOURCE = 'fcf9d544d9324d447514a957daf87a0e59603fde'
APP = 'com.patrickchin.puptime'
ANDROID = 'http://schemas.android.com/apk/res/android'
TARGET = APP + '.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
MAX_BYTES = 65536
MAX_OWNER_BYTES = 2 * 1024 * 1024
MAX_APK_BYTES = 220 * 1024 * 1024
MAX_ENTRY_BYTES = 128 * 1024 * 1024
MAX_PAYLOAD_BYTES = 512 * 1024 * 1024
MAX_ENTRIES = 20000
from xml.parsers import expat

PINS = [
    ('original125', 'original125.apk', 'original125-manifest.xml', '82fa41075db35d747360183a2c3ff364e5c4fb4813519135d7a5eb076249a927', None, None),
    ('QA6', 'bridge/input.apk', 'bridge/APK-MANIFEST.xml', '0f9a2791bfa2a08d111bfb63c277ff5e50fe2408b449646abef2b129e8a6538d', '4c56d54260dff535c89416d6fe8483e2ad1dd0b4f349b3856ec7c5c0ab26fa67', '0948d51163a14ebb03a00bd665dfc9f0c602af8c361e044a1da1e3e3527a7b31'),
    ('QA7', 'later/input.apk', 'later/APK-MANIFEST.xml', '6c9167b04c344c7ecd3e75ed583f663a3b6998081d4fcd164a1b8c5764c21e58', 'cf217e5bf05e186ea8573c5ca727d20c7dbcccd62b99b3f7ff9bb3f51b97f60a', '269f093e480aedb14124070861e5a909a17324b243dedc64c8e66289af33727c'),
]

def require(value):
    if not value:
        raise ValueError('Rejected input.')

def sha(value):
    return hashlib.sha256(value).hexdigest()

def checked_file(path, pin, root, limit=MAX_BYTES):
    path, root = Path(path), Path(root)
    require(root.is_absolute() and root.resolve() == root and path.resolve() == path)
    require(path.is_relative_to(root) and 0 < pin['bytes'] <= limit and pin['mode'] == 0o600)
    for directory in [root, *path.relative_to(root).parents][:-1]:
        directory = directory if directory.is_absolute() else root / directory
        info = directory.lstat()
        require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.geteuid())
    entry = path.lstat()
    require(stat.S_ISREG(entry.st_mode) and stat.S_IMODE(entry.st_mode) == 0o600 and entry.st_uid == os.geteuid() and entry.st_size == pin['bytes'])
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and stat.S_IMODE(before.st_mode) == 0o600 and before.st_uid == os.geteuid() and before.st_size == pin['bytes'])
        require((entry.st_dev, entry.st_ino) == (before.st_dev, before.st_ino))
        chunks, size = [], 0
        while True:
            chunk = os.read(fd, 4096)
            if not chunk:
                break
            size += len(chunk)
            require(size <= pin['bytes'])
            chunks.append(chunk)
        after = os.fstat(fd)
        require(all(getattr(before, key) == getattr(after, key) for key in ['st_dev', 'st_ino', 'st_mode', 'st_size', 'st_mtime_ns', 'st_ctime_ns']))
        data = b''.join(chunks)
        require(size == pin['bytes'] and sha(data) == pin['sha256'])
        return data
    finally:
        os.close(fd)

def signature_only(value):
    if value == 'signature':
        return True
    if not isinstance(value, str) or not 0 < len(value) <= 10 or not re.fullmatch(r'0[xX][0-9a-fA-F]{1,8}|[0-9]{1,10}', value):
        return False
    return int(value, 16 if value.lower().startswith('0x') else 10) == 2

def project_manifest(data):
    require(0 < len(data) <= MAX_BYTES and b'&' not in data and b'\0' not in data)
    text = data.decode('utf-8', errors='strict')
    parser = expat.ParserCreate(encoding='UTF-8', namespace_separator='|')
    parser.ordered_attributes = True
    depth, nodes, android_declared = 0, 0, False
    declarations, requested = {}, set()
    def reject(*_args):
        raise ValueError('Rejected XML shape.')
    def namespace(prefix, uri):
        nonlocal android_declared
        require(depth == 0 and prefix == 'android' and uri == ANDROID and not android_declared)
        android_declared = True
    def start(name, values):
        nonlocal depth, nodes
        depth += 1; nodes += 1
        require(depth <= 64 and nodes <= 4096 and len(values) <= 128 and '|' not in name)
        attrs = dict(zip(values[::2], values[1::2]))
        require(len(attrs) * 2 == len(values))
        require(all('|' not in key or key.startswith(ANDROID + '|') and key.count('|') == 1 for key in attrs))
        if depth == 1:
            require(name == 'manifest' and attrs.get('package') == APP and android_declared)
        if name == 'permission' or name in ['uses-permission', 'uses-permission-sdk-23', 'uses-permission-sdk-m']:
            require(depth == 2)
            value = attrs.get(ANDROID + '|name')
            require(isinstance(value, str) and 0 < len(value.encode('utf-8')) <= 512)
            if name == 'permission':
                require(value not in declarations and len(declarations) < 128)
                declarations[value] = attrs.get(ANDROID + '|protectionLevel')
            else:
                require(value not in requested and len(requested) < 256)
                requested.add(value)
    def end(_name):
        nonlocal depth
        depth -= 1
    parser.StartNamespaceDeclHandler = namespace
    parser.StartElementHandler = start
    parser.EndElementHandler = end
    parser.CharacterDataHandler = lambda value: require(not value or value.isspace())
    parser.XmlDeclHandler = lambda version, encoding, _standalone: require(version == '1.0' and encoding in [None, 'utf-8', 'UTF-8'])
    parser.StartDoctypeDeclHandler = parser.EntityDeclHandler = parser.ExternalEntityRefHandler = reject
    parser.CommentHandler = parser.ProcessingInstructionHandler = parser.StartCdataSectionHandler = reject
    for offset in range(0, len(text), 4096):
        parser.Parse(text[offset:offset + 4096], False)
    parser.Parse('', True)
    require(depth == 0)
    other = sorted((name, protection) for name, protection in declarations.items() if name != TARGET)
    return {'permission': 'APP_DYNAMIC_RECEIVER_NOT_EXPORTED', 'present': TARGET in declarations,
            'signatureOnly': signature_only(declarations.get(TARGET)),
            'requested': TARGET in requested, 'otherDeclarationCount': len(other),
            'otherDeclarationsSHA256': sha(json.dumps(other, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))}

def private_digest(path, root, limit=MAX_APK_BYTES):
    """Bounded streaming hash; no symlink/FIFO, including ancestors, or changed inode."""
    path, root = Path(path), Path(root)
    require(root.is_absolute() and root.resolve() == root and path.resolve() == path and path.is_relative_to(root))
    for directory in [root, *path.relative_to(root).parents][:-1]:
        info = (directory if directory.is_absolute() else root / directory).lstat()
        require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.geteuid())
    entry = path.lstat()
    require(stat.S_ISREG(entry.st_mode) and stat.S_IMODE(entry.st_mode) == 0o600 and entry.st_uid == os.geteuid() and 0 < entry.st_size <= limit)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require((entry.st_dev, entry.st_ino, entry.st_mode, entry.st_size) == (before.st_dev, before.st_ino, before.st_mode, before.st_size))
        digest, size = hashlib.sha256(), 0
        while chunk := os.read(fd, 65536):
            size += len(chunk); require(size <= limit); digest.update(chunk)
        after = os.fstat(fd)
        require(size == before.st_size and all(getattr(before, key) == getattr(after, key) for key in ['st_dev', 'st_ino', 'st_mode', 'st_size', 'st_mtime_ns', 'st_ctime_ns']))
        final = path.lstat(); require((final.st_dev, final.st_ino, final.st_mode, final.st_size, final.st_mtime_ns, final.st_ctime_ns) == (after.st_dev, after.st_ino, after.st_mode, after.st_size, after.st_mtime_ns, after.st_ctime_ns))
        return {'bytes': size, 'mode': 0o600, 'sha256': digest.hexdigest()}
    finally:
        os.close(fd)

def inventory(root):
    rows = []
    for label, apk, manifest, apk_sha, manifest_sha, zip_sha in PINS:
        require(private_digest(root / apk, root)['sha256'] == apk_sha)
        if zip_sha:
            require(private_digest((root / apk).parent / 'puptime-android-qualification.zip', root)['sha256'] == zip_sha)
        pin = private_digest(root / manifest, root, MAX_BYTES)
        require(not manifest_sha or pin['sha256'] == manifest_sha)
        result = project_manifest(checked_file(root / manifest, pin, root))
        require(result['present'] and result['requested'] and result['signatureOnly'] and result['otherDeclarationCount'] == 0)
        rows.append({'artifact': label, 'apkSHA256': apk_sha, 'manifestSHA256': pin['sha256'], **result})
    return {'schema': 1, 'stage': 'permission-inventory', 'status': 'OBSERVED', 'source': SOURCE, 'artifacts': rows}

def project_owner(data):
    # Android16r1 runListPermissions(-f), no GROUP argument: canonical complete blocks.
    require(0 < len(data) <= MAX_OWNER_BYTES and b'\0' not in data)
    text = data.decode('utf-8', errors='strict')
    require(text.startswith('All Permissions:\n\n') and text.endswith('\n'))
    blocks = text[len('All Permissions:\n\n'):-1].split('\n+ permission:')
    require(0 < len(blocks) <= 8192 and blocks[0].startswith('+ permission:'))
    seen, target = set(), None
    for index, block in enumerate(blocks):
        lines = (block if index == 0 else '+ permission:' + block).split('\n')
        require(len(lines) in [3, 5])
        name = re.fullmatch(r'\+ permission:([A-Za-z0-9_.]{1,512})', lines[0])
        package = re.fullmatch(r'  package:([A-Za-z0-9_.]{1,512})', lines[1])
        require(name and package and name[1] not in seen)
        require(len(lines) == 3 or lines[2].startswith('  label:') and lines[3].startswith('  description:'))
        require(re.fullmatch(r'  protectionLevel:[A-Za-z0-9_|]+', lines[-1]))
        seen.add(name[1])
        if name[1] == TARGET:
            target = {'permission': 'APP_DYNAMIC_RECEIVER_NOT_EXPORTED', 'ownerObserved': True,
                      'expectedAppOwnsPermission': package[1] == APP,
                      'signatureOnly': lines[-1] == '  protectionLevel:signature'}
    require(target is not None)
    return target

def zip_payload(path, root):
    pin = private_digest(path, root)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd); rows, total, manifest = [], 0, None
        with os.fdopen(fd, 'rb', closefd=False) as stream, zipfile.ZipFile(stream) as archive:
            # Bind the very descriptor parsed by ZipFile to the already checked hash.
            stream.seek(0); digest = hashlib.sha256()
            while chunk := stream.read(65536): digest.update(chunk)
            require(digest.hexdigest() == pin['sha256'] and before.st_size == pin['bytes'])
            entries = archive.infolist(); require(0 < len(entries) <= MAX_ENTRIES)
            names = set()
            for item in entries:
                name = item.filename
                require(name == item.orig_filename and 0 < len(name.encode('utf-8')) <= 1024 and not name.startswith('/') and '\\' not in name and '\0' not in name and '..' not in name.split('/'))
                require(name not in names and not item.flag_bits & 1 and not stat.S_ISLNK(item.external_attr >> 16))
                require(0 <= item.file_size <= MAX_ENTRY_BYTES)
                names.add(name); total += item.file_size; require(total <= MAX_PAYLOAD_BYTES)
                digest, size = hashlib.sha256(), 0
                with archive.open(item) as source:
                    while chunk := source.read(65536):
                        size += len(chunk); require(size <= item.file_size); digest.update(chunk)
                require(size == item.file_size)
                value = digest.hexdigest(); rows.append([name, size, value])
                if name == 'AndroidManifest.xml': manifest = value
        require(manifest is not None)
        after = os.fstat(fd)
        require(all(getattr(before, key) == getattr(after, key) for key in ['st_dev', 'st_ino', 'st_mode', 'st_size', 'st_mtime_ns', 'st_ctime_ns']))
        require(private_digest(path, root) == pin)
        return pin['sha256'], sorted(rows), manifest
    finally:
        os.close(fd)

def compare_payloads(root):
    control, crows, cm = zip_payload(root / 'control6.apk', root)
    experiment, erows, em = zip_payload(root / 'bridge6.apk', root)
    _, _, original = zip_payload(root / 'bridge/input.apk', root)
    require(control != experiment and crows == erows and cm == em == original)
    return {'schema': 1, 'stage': 'permission-payload-equality', 'allEntriesEqual': True,
            'entryCount': len(crows), 'payloadSHA256': sha(json.dumps(crows, separators=(',', ':')).encode()),
            'manifestSHA256': cm, 'controlAPK': control, 'experimentAPK': experiment}

def self_check():
    body = ('<manifest xmlns:android="' + ANDROID + '" package="' + APP + '"><permission android:name="' + TARGET + '" android:protectionLevel="0x00000002"/><uses-permission android:name="' + TARGET + '"/></manifest>').encode()
    require(project_manifest(body)['signatureOnly'])
    row = ('All Permissions:\n\n+ permission:' + TARGET + '\n  package:' + APP + '\n  protectionLevel:signature\n').encode()
    require(project_owner(row)['expectedAppOwnsPermission'])
    for action in [lambda: project_manifest(body[:-1]), lambda: project_manifest(body.decode().encode('utf-16-le')), lambda: project_owner(row[:-1]), lambda: project_owner(row + row.split(b'\n\n')[1])]:
        try: action()
        except Exception: pass
        else: raise ValueError('Negative self-check failed.')

def main():
    os.umask(0o077)
    if sys.argv[1:] == ['--self-check']:
        self_check(); print('{"status":"self-check-passed"}'); return
    require(len(sys.argv) == 3 and sys.argv[1] in ['--inventory', '--payload', '--owner-original', '--owner-control'])
    root = Path(sys.argv[2]); run, attempt = os.environ.get('GITHUB_RUN_ID', ''), os.environ.get('GITHUB_RUN_ATTEMPT', '')
    require(re.fullmatch(r'[1-9][0-9]*', run) and re.fullmatch(r'[1-9][0-9]*', attempt))
    require(root.is_absolute() and root.resolve() == root and root == Path(os.environ['RUNNER_TEMP']).resolve() / ('puptime-signing-' + run + '-' + attempt))
    marker = root / 'NOT-FOR-RELEASE'
    require(checked_file(marker, {'bytes': 40, 'mode': 0o600, 'sha256': sha(SOURCE.encode())}, root) == SOURCE.encode())
    if sys.argv[1] == '--inventory': result = inventory(root)
    elif sys.argv[1] == '--payload': result = compare_payloads(root)
    else:
        path = root / ('permission-owner-' + sys.argv[1].removeprefix('--owner-') + '.txt')
        result = project_owner(checked_file(path, private_digest(path, root, MAX_OWNER_BYTES), root, MAX_OWNER_BYTES))
    print(json.dumps(result, separators=(',', ':')))

if __name__ == '__main__':
    try: main()
    except Exception:
        print('{"status":"UNKNOWN","category":"permission-evidence-rejected"}'); sys.exit(1)

