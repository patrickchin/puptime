import importlib.util
import json
from pathlib import Path
import unittest
import tempfile
import subprocess
import sys

SPEC = importlib.util.spec_from_file_location('notice_failure', Path(__file__).with_name('record-android-notice-failure.py'))
failure = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(failure)
SOURCE = 'a' * 40


class FiniteFailure(unittest.TestCase):
    def value(self):
        return {'schema': 1, 'status': 'INCOMPLETE', 'complete': False, 'sourceCommit': SOURCE, 'platform': 'android', 'stage': 'setup',
                'setup': {'phase': 'gradle-resolution', 'errorCategory': 'command-failed', 'collector': {
                    'phase': 'runtime-resolution', 'errorClass': 'ResolveException', 'causeChain': [{'errorClass': 'ResolveException', 'classSHA256': 'b' * 64}], 'causeChainEnd': 'end'}}}

    def test_valid_pinned_collector_fields_survive_without_inventing_cause(self):
        result = failure.receipt(SOURCE, '123', '1', ['success'] * 4 + ['failure', 'skipped', 'skipped'], self.value())
        self.assertEqual(result['stage'], 'gradle-resolution')
        self.assertEqual(result['exitCategory'], 'step-failed')
        self.assertEqual(result['collector']['phase'], 'runtime-resolution')
        self.assertFalse(result['complete'])

    def test_pre_init_metro_projection_and_cancelled_are_distinct(self):
        for index in range(7):
            outcomes = ['success'] * index + ['failure'] + ['skipped'] * (6 - index)
            result = failure.receipt(SOURCE, '123', '1', outcomes)
            self.assertEqual(result['stage'], failure.STAGES[index])
            self.assertIsNone(result['collector'])
        result = failure.receipt(SOURCE, '123', '1', ['success'] * 4 + ['cancelled', 'skipped', 'skipped'])
        self.assertEqual(result['exitCategory'], 'cancelled')
        self.assertEqual(failure.receipt(SOURCE, '123', '1', ['success'] * 7)['stage'], 'complete')

    def test_private_extra_fields_wrong_source_bad_hash_and_limits_are_dropped(self):
        cases = []
        value = self.value(); value['setup']['collector']['message'] = 'PRIVATE path / history'; cases.append(value)
        value = self.value(); value['sourceCommit'] = 'f' * 40; cases.append(value)
        value = self.value(); value['setup']['collector']['causeChain'][0]['classSHA256'] = 'PRIVATE'; cases.append(value)
        value = self.value(); value['setup']['collector']['causeChain'] *= 9; cases.append(value)
        value = self.value(); value['setup']['collector']['phase'] = '/PRIVATE/path'; cases.append(value)
        for value in cases:
            result = failure.receipt(SOURCE, '123', '1', ['success'] * 4 + ['failure', 'skipped', 'skipped'], value)
            self.assertIsNone(result['collector'])
            self.assertNotIn('PRIVATE', json.dumps(result))

    def test_actual_cli_writes_only_closed_private_receipt_and_preserves_existing_file(self):
        with tempfile.TemporaryDirectory(prefix='puptime-notice-failure-') as directory:
            root = Path(directory)
            raw = root / 'build/notices/android/failure.json'
            raw.parent.mkdir(parents=True)
            value = self.value()
            value['setup']['collector']['message'] = 'PRIVATE sentinel'
            raw.write_text(json.dumps(value))
            env = {'GITHUB_SHA': SOURCE, 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1'}
            for index, stage in enumerate(failure.STAGES):
                env['PUPTIME_NOTICE_' + stage.upper().replace('-', '_')] = 'success' if index < 4 else 'failure' if index == 4 else 'skipped'
            script = Path(__file__).with_name('record-android-notice-failure.py').resolve()
            result = subprocess.run([sys.executable, str(script)], cwd=root, env=env, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0)
            output = root / 'build/notices/android/review/failure.json'
            data = output.read_bytes()
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(data)['stage'], 'gradle-resolution')
            self.assertIsNone(json.loads(data)['collector'])
            self.assertNotIn(b'PRIVATE', data)
            result = subprocess.run([sys.executable, str(script)], cwd=root, env=env, capture_output=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(output.read_bytes(), data)

    def test_preexisting_invalid_receipt_rejects_cli_and_workflow_cannot_admit_upload(self):
        workflow = (Path(__file__).parents[1] / '.github/workflows/android-apk.yml').read_text()
        diagnostic = workflow.split('      - name: Record finite Android discovery diagnostics\n', 1)[1].split('      - name:', 1)[0]
        upload = workflow.split('      - name: Upload public license discovery inputs only (INCOMPLETE)\n', 1)[1].split('      - name:', 1)[0]
        self.assertIn('id: notice_diagnostic', diagnostic)
        self.assertIn("if: ${{ always() && inputs.discovery_only == true && steps.notice_diagnostic.outcome == 'success' }}", upload)
        with tempfile.TemporaryDirectory(prefix='puptime-notice-upload-rejection-') as directory:
            root = Path(directory)
            output = root / 'build/notices/android/review/failure.json'
            output.parent.mkdir(parents=True)
            sentinel = b'{"PRIVATE":"unvalidated existing receipt"}'
            output.write_bytes(sentinel)
            env = {'GITHUB_SHA': SOURCE, 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1'}
            script = Path(__file__).with_name('record-android-notice-failure.py').resolve()
            result = subprocess.run([sys.executable, str(script)], cwd=root, env=env, capture_output=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)  # GitHub step outcome=failure; upload requires success.
            self.assertEqual(output.read_bytes(), sentinel)
            self.assertNotIn(b'PRIVATE', result.stdout + result.stderr)

    def test_raw_fields_are_never_used_outside_gradle_stage(self):
        result = failure.receipt(SOURCE, '123', '1', ['success'] * 5 + ['failure', 'skipped'], self.value())
        self.assertEqual(result['stage'], 'metro-collection')
        self.assertIsNone(result['collector'])


if __name__ == '__main__':
    unittest.main()
