"""Synthetic archive/binding checks and actual public license-copy integrity."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import warnings
import zipfile

spec = importlib.util.spec_from_file_location('software_notices', Path(__file__).with_name('check-android-software-notices.py'))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class AndroidSoftwareNotices(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'src').mkdir()
        (self.root / 'scripts').mkdir()
        self.body = 'Copyright synthetic holder\n\nSynthetic permission and disclaimer.\n'
        self.payload = [{'id': 'one', 'title': 'Synthetic license', 'body': self.body, 'kind': 'notice', 'androidOnly': True, 'attributions': ['example:synthetic 1.0']}]
        observed = {'source': 'maven:example:synthetic:1.0/synthetic-1.0.jar!LICENSE', 'sha256': checker.sha(self.body)}
        component = {'component': 'maven:example:synthetic@1.0', 'name': 'example:synthetic', 'version': '1.0', 'ecosystem': 'maven', 'notices': [observed]}
        self.inventory = {'schema': 1, 'components': [component], 'mavenArtifacts': [{'component': component['component'], 'file': 'synthetic-1.0.jar', 'sha256': 'a' * 64}], 'nativeProjects': [], 'metroPackages': []}
        self.manifest = {'schema': 1, 'status': 'REVIEWED_SOURCE', 'components': [{**component, 'observedNotices': [observed], 'notices': [{**observed, 'sectionId': 'one'}]}], 'texts': [{'sectionId': 'one', 'sha256': checker.sha(self.body)}], 'publisherDocuments': [], 'nativeVendors': [], 'runtimeCandidate': {'notices': []}, 'sourceInputs': {'componentInputsSHA256': checker.sha(checker.canonical(checker.component_inputs(self.inventory)))}}
        self.archive = self.root / 'candidate.zip'
        self.input_path = self.root / 'inventory.json'
        self.write_source()

    def write_source(self):
        self.payload_bytes = (json.dumps(self.payload, indent=2) + '\n').encode()
        self.manifest['payloadSHA256'] = checker.sha(self.payload_bytes)
        (self.root / 'src/android-software-notices.json').write_bytes(self.payload_bytes)
        (self.root / 'scripts/android-software-notice-provenance.json').write_text(json.dumps(self.manifest))
        self.input_path.write_text(json.dumps(self.inventory))

    def write_archive(self, prefix='', body=None, present=True):
        with zipfile.ZipFile(self.archive, 'w') as target:
            target.writestr(prefix + checker.NOTICE if present else 'assets/unrelated', self.payload_bytes if body is None else body)

    def test_exact_apk_aab_bytes_and_missing_or_changed_payload(self):
        for prefix in ['', 'base/']:
            self.write_archive(prefix)
            result = checker.check(self.archive, self.input_path, self.root)
            self.assertEqual(result['noticeEntry'], prefix + checker.NOTICE)
            self.assertEqual(result['reviewedComponents'], 1)
            self.assertFalse(result['nativeOriginQualified'])
            for kwargs, code in [({'present': False}, 'missing-software-payload'), ({'body': self.payload_bytes + b' '}, 'packaged-payload-mismatch')]:
                self.write_archive(prefix, **kwargs)
                with self.assertRaisesRegex(ValueError, '^' + code + '$'):
                    checker.check(self.archive, self.input_path, self.root)

    def test_actual_resolved_component_and_artifact_drift_are_blocked(self):
        self.write_archive()
        original = copy.deepcopy(self.inventory)
        for change in ['component', 'artifact']:
            self.inventory = copy.deepcopy(original)
            if change == 'component':
                self.inventory['components'][0]['version'] = '2.0'
            else:
                self.inventory['mavenArtifacts'][0]['sha256'] = 'b' * 64
            self.write_source()
            with self.assertRaisesRegex(ValueError, '^resolved-input-mismatch$'):
                checker.check(self.archive, self.input_path, self.root)

    def test_incomplete_review_never_qualifies_an_archive(self):
        self.manifest['status'] = 'INCOMPLETE'
        self.write_source()
        self.write_archive()
        with self.assertRaisesRegex(ValueError, '^incomplete-source-review$'):
            checker.check(self.archive, self.input_path, self.root)

    def test_source_attribution_and_notice_coverage_cannot_be_dropped(self):
        self.payload[0]['attributions'] = []
        self.write_source()
        with self.assertRaisesRegex(ValueError, '^source-document-mismatch$'):
            checker.source_payload(self.root)
        self.payload[0]['attributions'] = ['example:synthetic 1.0']
        self.manifest['components'][0]['notices'] = []
        self.write_source()
        with self.assertRaisesRegex(ValueError, '^uncovered-component$'):
            checker.source_payload(self.root)

    def test_duplicate_zip_entry_is_blocked(self):
        self.write_archive()
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(self.archive, 'a') as target:
                target.writestr(checker.NOTICE, self.payload_bytes)
        with self.assertRaisesRegex(ValueError, '^invalid-archive$'):
            checker.check(self.archive, self.input_path, self.root)

    def test_actual_public_documents_and_original_publisher_texts_validate(self):
        manifest, _ = checker.source_payload(checker.ROOT)
        self.assertEqual(len(manifest['components']), 320)
        document = manifest['publisherDocuments'][0]
        document['pieces'][0]['literal'] = 'changed copyright header'
        (self.root / 'src/android-software-notices.json').write_bytes((checker.ROOT / 'src/android-software-notices.json').read_bytes())
        (self.root / 'scripts/android-software-notice-provenance.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, '^publisher-document-mismatch$'):
            checker.source_payload(self.root)


if __name__ == '__main__':
    unittest.main()
