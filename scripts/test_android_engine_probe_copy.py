"""Generated archive controls only; no real APK, keys, SDK or device."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('probe_copy', Path(__file__).with_name('android-engine-probe-copy.py'))
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


class PrivateEngineCopy(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='puptime-engine-copy-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root.chmod(0o700)
        self.original = self.root / 'product.apk'
        self.bundle = self.root / 'probe.bundle'
        self.output = self.root / 'NOT-FOR-DISTRIBUTION-unsigned.apk'
        self.files = {name: ('synthetic ' + name).encode() for name in [probe.BUNDLE, 'AndroidManifest.xml', 'classes.dex',
                      'resources.arsc', 'lib/x86_64/libexpo-sqlite.so', 'lib/arm64-v8a/libexpo-sqlite.so',
                      'assets/public-notices.json', 'META-INF/LICENSE', 'META-INF/CERT.RSA', 'META-INF/CERT.SF', 'META-INF/MANIFEST.MF']}
        self.archive(self.original, self.files)
        self.original_sha = probe.sha(self.original.read_bytes())
        self.bundle.write_bytes(b'synthetic closed fixed-SELECT wrapper bundle')

    def archive(self, path, files):
        with zipfile.ZipFile(path, 'w', zipfile.ZIP_STORED) as output:
            for name, data in files.items():
                output.writestr(name, data)

    def create(self):
        return probe.create_copy(self.original, self.bundle, self.output, self.original_sha)

    def test_only_js_and_signature_metadata_can_change(self):
        result = self.create()
        self.assertTrue(result['allOrdinaryMemberBytesAndCompressionEqual'])
        self.assertEqual(result['nativeLibrariesCompared'], 2)
        self.assertEqual(probe.sha(self.original.read_bytes()), self.original_sha)
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(archive.read('META-INF/LICENSE'), self.files['META-INF/LICENSE'])
            self.assertNotIn('META-INF/CERT.RSA', archive.namelist())

    def test_every_native_dex_resource_manifest_notice_change_or_extra_fails(self):
        self.create()
        for name in ['classes.dex', 'AndroidManifest.xml', 'resources.arsc', 'lib/x86_64/libexpo-sqlite.so',
                     'lib/arm64-v8a/libexpo-sqlite.so', 'assets/public-notices.json', 'META-INF/LICENSE', 'assets/extra']:
            altered = {**self.files, probe.BUNDLE: self.bundle.read_bytes(), name: b'changed synthetic sentinel'}
            self.archive(self.output, altered)
            with self.subTest(name=name), self.assertRaises(ValueError):
                probe.verify_copy(self.original, self.output, self.original_sha, probe.sha(self.bundle.read_bytes()))

    def test_removed_notice_or_changed_compression_fails(self):
        copied = {**self.files, probe.BUNDLE: self.bundle.read_bytes()}
        copied.pop('META-INF/LICENSE')
        self.archive(self.output, copied)
        with self.assertRaises(ValueError):
            probe.verify_copy(self.original, self.output, self.original_sha, probe.sha(self.bundle.read_bytes()))
        with zipfile.ZipFile(self.output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, data in {**self.files, probe.BUNDLE: self.bundle.read_bytes()}.items():
                archive.writestr(name, data)
        with self.assertRaises(ValueError):
            probe.verify_copy(self.original, self.output, self.original_sha, probe.sha(self.bundle.read_bytes()))

    def test_wrong_product_existing_destination_and_nonprivate_parent_fail(self):
        with self.assertRaises(ValueError):
            probe.create_copy(self.original, self.bundle, self.output, 'f' * 64)
        self.create()
        existing = self.output.read_bytes()
        with self.assertRaises(ValueError):
            self.create()
        self.assertEqual(self.output.read_bytes(), existing)
        self.output.unlink()
        self.root.chmod(0o755)
        with self.assertRaises(ValueError):
            self.create()

    def test_invalid_identical_probe_cleans_only_its_partial_copy(self):
        self.bundle.write_bytes(self.files[probe.BUNDLE])
        with self.assertRaises(ValueError):
            self.create()
        self.assertFalse(self.output.exists())
        self.assertEqual(probe.sha(self.original.read_bytes()), self.original_sha)

    def test_exclusive_open_race_never_unlinks_the_other_creator(self):
        original_open = Path.open
        sentinel = b'other creator sentinel'
        def racing_open(path, *args, **kwargs):
            if path == self.output and args and args[0] == 'xb':
                with original_open(path, 'wb') as target:
                    target.write(sentinel)
            return original_open(path, *args, **kwargs)
        with patch.object(Path, 'open', racing_open), self.assertRaises(FileExistsError):
            self.create()
        self.assertEqual(self.output.read_bytes(), sentinel)

    def test_replaced_destination_survives_failure_cleanup(self):
        sentinel = b'replacement creator sentinel'
        def replace_then_fail(*args):
            replacement = self.root / 'replacement.fixture'
            replacement.write_bytes(sentinel)
            replacement.replace(self.output)
            raise ValueError('synthetic verification failure')
        with patch.object(probe, 'verify_copy', replace_then_fail), self.assertRaises(ValueError):
            self.create()
        self.assertEqual(self.output.read_bytes(), sentinel)
        self.assertEqual(probe.sha(self.original.read_bytes()), self.original_sha)

    def test_unknown_member_path_and_missing_native_file_fail(self):
        for name in ['../outside', '/absolute', 'bad\\name']:
            self.archive(self.original, {**self.files, name: b'synthetic'})
            with self.subTest(name=name), self.assertRaises(ValueError):
                probe.member_manifest(self.original)
        self.files.pop('lib/x86_64/libexpo-sqlite.so')
        self.archive(self.original, self.files)
        with self.assertRaises(ValueError):
            probe.member_manifest(self.original)


if __name__ == '__main__':
    unittest.main()
