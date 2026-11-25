"""Synthetic archive checks; no build, network or user data."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('font_notices', Path(__file__).with_name('check-android-font-notices.py'))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class AndroidFontNotices(unittest.TestCase):
    def test_exact_archive_contract(self):
        payload = (checker.ROOT / 'src/font-icon-notices.json').read_bytes()
        font = (checker.ROOT / 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf').read_bytes()
        for prefix in ['', 'base/']:
            with tempfile.TemporaryDirectory() as directory:
                archive = Path(directory) / 'candidate.zip'
                def write(notice=payload, font_bytes=font, include_notice=True, include_font=True):
                    with zipfile.ZipFile(archive, 'w') as target:
                        if include_notice:
                            target.writestr(prefix + checker.NOTICE, notice)
                        if include_font:
                            target.writestr(prefix + 'assets/renamed-font.bin', font_bytes)
                write()
                result = checker.check(archive)
                self.assertEqual(result['status'], 'passed')
                self.assertEqual(result['noticeEntry'], prefix + checker.NOTICE)
                self.assertEqual(result['fonts'][0]['component'], 'material-community-icons')
                self.assertFalse(result['otherSoftwareNoticesQualified'])
                for kwargs, code in [({'include_notice':False}, 'missing-notice'),
                                     ({'notice':payload + b' '}, 'notice-mismatch'),
                                     ({'font_bytes':b'OTTOunreviewed'}, 'unreviewed-font'),
                                     ({'include_font':False}, 'missing-used-icon-font')]:
                    write(**kwargs)
                    with self.assertRaisesRegex(ValueError, '^' + code + '$'):
                        checker.check(archive)
                write()
                with zipfile.ZipFile(archive, 'a') as target:
                    target.writestr('../outside.ttf', font)
                with self.assertRaisesRegex(ValueError, '^invalid-archive$'):
                    checker.check(archive)


if __name__ == '__main__':
    unittest.main()
