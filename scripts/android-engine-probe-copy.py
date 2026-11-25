"""Private QA copy only. Never signs, installs, queries or modifies the product APK."""
import hashlib
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

BUNDLE = 'assets/index.android.bundle'
SIGNATURE = re.compile(r'META-INF/(?:MANIFEST\.MF|[A-Za-z0-9_-]{1,64}\.(?:SF|RSA|DSA|EC))\Z')
MAX_MEMBER = 192 * 1024 * 1024
MAX_TOTAL = 2 * 1024 * 1024 * 1024


def sha(data):
    return hashlib.sha256(data).hexdigest()


def stream_sha(stream):
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(chunk)
    return digest.hexdigest()


def file_sha(path):
    with path.open('rb') as stream:
        return stream_sha(stream)


def member_manifest(path):
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 256 * 1024 * 1024:
        raise ValueError('Require a bounded regular APK.')
    result = {}
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if not 0 < len(entries) <= 20000 or sum(item.file_size for item in entries) > MAX_TOTAL:
            raise ValueError('APK member bound exceeded.')
        for item in entries:
            name = item.filename
            if (name != item.orig_filename or name in result or '\\' in name or '\x00' in name
                    or name.startswith('/') or '..' in PurePosixPath(name).parts
                    or str(PurePosixPath(name)) != name.rstrip('/')
                    or item.flag_bits & 1 or item.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                    or not 0 <= item.file_size <= MAX_MEMBER
                    or stat.S_IFMT(item.external_attr >> 16) not in (0, stat.S_IFDIR if item.is_dir() else stat.S_IFREG)):
                raise ValueError('Unexpected APK member.')
            with archive.open(item) as stream:
                digest = stream_sha(stream)
            result[name] = (digest, item.file_size, item.compress_type, item.external_attr)
    for name in [BUNDLE, 'AndroidManifest.xml', 'classes.dex', 'resources.arsc', 'lib/x86_64/libexpo-sqlite.so']:
        if name not in result or result[name][1] == 0:
            raise ValueError('Required candidate member missing.')
    return result


def verify_copy(product, probe, expected_product_sha, expected_bundle_sha):
    if file_sha(product) != expected_product_sha:
        raise ValueError('Product APK differs from the admitted artifact.')
    original, copied = member_manifest(product), member_manifest(probe)
    ordinary = lambda values: {name: value for name, value in values.items() if name != BUNDLE and not SIGNATURE.fullmatch(name)}
    if ordinary(original) != ordinary(copied):
        raise ValueError('QA copy changed a member outside the JS/signature allowance.')
    if copied[BUNDLE][0] != expected_bundle_sha or copied[BUNDLE][0] == original[BUNDLE][0]:
        raise ValueError('QA copy must contain exactly the admitted distinct probe bundle.')
    if file_sha(product) != expected_product_sha:
        raise ValueError('Product APK changed during verification.')
    return {'ordinaryMembersCompared': len(ordinary(original)),
            'nativeLibrariesCompared': sum(name.startswith('lib/') and name.endswith('.so') for name in ordinary(original)),
            'allOrdinaryMemberBytesAndCompressionEqual': True,
            'onlyChangedProductMember': BUNDLE,
            'scope': 'QA JS-wrapper copy only; no production JS, Play, account or owner-upgrade qualification.'}


def create_copy(product, bundle, destination, expected_product_sha):
    """Create one exclusive unsigned private copy. Official zipalign/apksigner run separately."""
    if destination.exists() or destination.is_symlink() or destination.parent.is_symlink():
        raise ValueError('Require an absent private QA destination.')
    if destination.parent.stat().st_mode & 0o777 != 0o700:
        raise ValueError('Require an owned private directory.')
    if bundle.is_symlink() or not bundle.is_file() or not 0 < bundle.stat().st_size <= 64 * 1024 * 1024:
        raise ValueError('Require the bounded generated probe bundle.')
    expected_bundle_sha = sha(bundle.read_bytes())
    member_manifest(product)
    if file_sha(product) != expected_product_sha:
        raise ValueError('Product APK differs from the admitted artifact.')
    try:
        with destination.open('xb') as target:
            destination.chmod(0o600)
            with zipfile.ZipFile(product) as original, zipfile.ZipFile(target, 'w') as output:
                for item in original.infolist():
                    if SIGNATURE.fullmatch(item.filename):
                        continue
                    output.writestr(item, bundle.read_bytes() if item.filename == BUNDLE else original.read(item))
        return verify_copy(product, destination, expected_product_sha, expected_bundle_sha)
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
