"""Small archive checks; no build, service or owner data is used."""
import importlib.util
import json
from pathlib import Path
import plistlib
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('check_store_audio', Path(__file__).with_name('check-store-audio.py'))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class StoreAudioCheck(unittest.TestCase):
    def test_archive_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            candidate = Path(directory) / 'candidate.ipa'
            info = {'CFBundleIdentifier': 'com.patrickchin.puptime',
                    'CFBundleShortVersionString': '1.12.0', 'CFBundleVersion': '123'}
            with zipfile.ZipFile(candidate, 'w') as archive:
                archive.writestr('Payload/Puptime.app/Info.plist', plistlib.dumps(info))
            self.assertEqual(checker.check(candidate, '1.12.0', '123'), [])
            for version, build in [('1.12.0', '124'), ('1.12.1', '123')]:
                with self.assertRaises(ValueError):
                    checker.check(candidate, version, build)
            original = json.loads(checker.LEDGER.read_text())['recordings'][0]
            audio = checker.ROOT / 'assets/puppy-care/audio' / original['filename']
            with zipfile.ZipFile(candidate, 'a') as archive:
                archive.writestr('Payload/Puptime.app/assets/renamed-resource.bin', audio.read_bytes())
            self.assertEqual(checker.check(candidate), [original['filename']])
            with self.assertRaises(ValueError):
                checker.check(Path(directory) / 'missing.ipa')


if __name__ == '__main__':
    unittest.main()
