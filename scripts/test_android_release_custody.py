"""Offline publication-boundary tests: no GitHub, SDK, signing, or release calls."""
import copy
import datetime
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-android-release.py'))
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)
SHA = lambda data: hashlib.sha256(data).hexdigest()


def zip_bytes(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return output.getvalue()


class PublicationBoundary(unittest.TestCase):
    def setUp(self):
        self.source = 'a' * 40
        self.certificate = 'c' * 64
        self.apk = b'public synthetic APK fixture, never executed'
        self.env = {'GITHUB_REPOSITORY': publisher.REPOSITORY, 'PUPTIME_RUN_ID': '1', 'PUPTIME_RUN_ATTEMPT': '2',
                    'PUPTIME_SOURCE_COMMIT': self.source, 'PUPTIME_TAG': 'v1.12.6',
                    'PUPTIME_APK_ARTIFACT_ID': '11', 'PUPTIME_APK_ARTIFACT_SHA256': '0' * 64,
                    'PUPTIME_QUALIFICATION_ARTIFACT_ID': '12', 'PUPTIME_QUALIFICATION_ARTIFACT_SHA256': '0' * 64,
                    'PUPTIME_APK_SHA256': SHA(self.apk)}
        now = datetime.datetime.now(datetime.timezone.utc)
        clock = lambda offset: (now + datetime.timedelta(seconds=offset)).isoformat().replace('+00:00', 'Z')
        self.run = {'id': 1, 'run_attempt': 2, 'head_sha': self.source, 'head_branch': 'candidate',
                    'repository': {'full_name': publisher.REPOSITORY, 'id': 100},
                    'head_repository': {'full_name': publisher.REPOSITORY, 'id': 100},
                    'path': publisher.WORKFLOW, 'workflow_id': 77, 'event': 'workflow_dispatch',
                    'status': 'completed', 'conclusion': 'success'}
        self.jobs = [{'id': 200 + index, 'name': name, 'run_id': 1, 'run_attempt': 2, 'head_sha': self.source,
                      'status': 'completed', 'conclusion': conclusion, 'started_at': clock(-120), 'completed_at': clock(-20)}
                     for index, (name, conclusion) in enumerate((('build', 'success'), ('publish', 'skipped')))]
        self.items = [{'id': identity, 'name': name, 'expired': False, 'size_in_bytes': 1, 'digest': 'sha256:' + '0' * 64,
                       'created_at': clock(-60), 'expires_at': clock(86400),
                       'workflow_run': {'id': 1, 'head_sha': self.source, 'head_branch': 'candidate',
                                        'repository_id': 100, 'head_repository_id': 100}}
                      for identity, name in ((11, 'puptime-android-apk'), (12, 'puptime-android-qualification'))]
        self.tag = {'object': {'type': 'commit', 'sha': self.source}}
        self.info = {'sourceCommit': self.source, 'runId': '1', 'configuredPackage': publisher.PACKAGE,
                     'configuredVersion': '1.12.6', 'configuredVersionCode': 1012006}
        self.files = {name: b'public build receipt' for name in publisher.QUALIFICATION_FILES}
        self.files.update({'SHA256SUMS.txt': (SHA(self.apk) + '  app-release.apk\n' + 'd' * 64 + '  app-release.aab\n').encode(),
                           'APK-MANIFEST.xml': b'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.patrickchin.puptime" android:versionName="1.12.6" android:versionCode="1012006"/>',
                           'APK-SIGNING.txt': ('Signer #1 certificate SHA-256 digest: ' + self.certificate + '\n').encode()})
        self.archives = {11: zip_bytes({'app-release.apk': self.apk})}
        self.rebuild_qualification()

    def rebuild_qualification(self):
        self.files['BUILD-INFO.json'] = json.dumps(self.info).encode()
        self.archives[12] = zip_bytes(self.files)
        for item, kind in zip(self.items, ('APK', 'QUALIFICATION')):
            data = self.archives[item['id']]
            item.update({'size_in_bytes': len(data), 'digest': 'sha256:' + SHA(data)})
            self.env['PUPTIME_' + kind + '_ARTIFACT_SHA256'] = SHA(data)

    def api(self, route):
        values = {'actions/runs/1': self.run,
                  'actions/workflows/android-apk.yml': {'id': 77, 'path': publisher.WORKFLOW},
                  'actions/runs/1/attempts/2/jobs?per_page=100': {'total_count': len(self.jobs), 'jobs': self.jobs},
                  'actions/runs/1/artifacts?per_page=100': {'total_count': len(self.items), 'artifacts': self.items},
                  'git/ref/tags/v1.12.6': self.tag,
                  'git/tags/' + 'b' * 40: {'object': {'type': 'commit', 'sha': self.source}}}
        return copy.deepcopy(values[route])

    def exercise(self, rejected=False, measure=None):
        def download(item, target):
            target.write_bytes(self.archives[item['id']])
        measured = ((publisher.PACKAGE, '1.12.6', 1012006), [self.certificate])
        with patch.object(publisher, 'api', side_effect=self.api), \
             patch.object(publisher, 'download_artifact', side_effect=download), \
             patch.object(publisher, 'measure_apk', side_effect=measure or (lambda _: measured)), \
             patch.object(publisher, 'create_release') as create:
            if rejected:
                with self.assertRaises((ValueError, KeyError, zipfile.BadZipFile)):
                    publisher.publish_release(publisher.pins_from_environment(self.env), 'Reviewed notes\nwith newline')
                create.assert_not_called()
            else:
                def check_files(pins, apk, sums, notes):
                    self.assertEqual(apk.name, 'Puptime-1.12.6.apk')
                    self.assertEqual(apk.read_bytes(), self.apk)
                    self.assertEqual(sums.read_text(), SHA(self.apk) + '  Puptime-1.12.6.apk\n')
                    self.assertEqual(notes.read_text(), 'Reviewed notes\nwith newline')
                create.side_effect = check_files
                publisher.publish_release(publisher.pins_from_environment(self.env), 'Reviewed notes\nwith newline')
                create.assert_called_once()

    def test_exact_artifact_only_run_publishes_once(self):
        self.exercise()

    def test_annotated_tag_resolves_to_exact_source(self):
        self.tag['object'] = {'type': 'tag', 'sha': 'b' * 40}
        self.exercise()

    def test_wrong_producer_or_attempt_never_publishes(self):
        original = copy.deepcopy(self.run)
        for key, bad in (('path', '.github/workflows/other.yml'), ('workflow_id', 78), ('event', 'push'),
                         ('status', 'in_progress'), ('conclusion', 'failure'), ('run_attempt', 3), ('head_sha', 'b' * 40)):
            with self.subTest(key=key):
                self.run = {**copy.deepcopy(original), key: bad}
                self.exercise(rejected=True)
        self.run = copy.deepcopy(original)
        self.run['head_repository']['full_name'] = 'someone/puptime'
        self.exercise(rejected=True)

    def test_wrong_job_or_prior_attempt_artifact_never_publishes(self):
        self.jobs[1]['conclusion'] = 'success'
        self.exercise(rejected=True)
        self.jobs[1]['conclusion'] = 'skipped'
        self.jobs[0]['run_attempt'] = 1
        self.exercise(rejected=True)
        self.jobs[0]['run_attempt'] = 2
        self.items[0]['created_at'] = (publisher.timestamp(self.jobs[0]['started_at']) - datetime.timedelta(days=1)).isoformat().replace('+00:00', 'Z')
        self.exercise(rejected=True)

    def test_tag_mismatch_never_publishes(self):
        self.tag['object']['sha'] = 'b' * 40
        self.exercise(rejected=True)

    def test_artifact_identity_expiry_and_digest_never_publishes(self):
        original = copy.deepcopy(self.items)
        for key, bad in (('id', 99), ('expired', True), ('digest', 'sha256:' + 'f' * 64), ('size_in_bytes', 0)):
            with self.subTest(key=key):
                self.items = copy.deepcopy(original)
                self.items[0][key] = bad
                self.exercise(rejected=True)
        self.items = copy.deepcopy(original)
        self.items[0]['expires_at'] = self.jobs[0]['started_at']
        self.exercise(rejected=True)
        self.items = copy.deepcopy(original)
        self.items[0]['workflow_run']['head_sha'] = 'b' * 40
        self.exercise(rejected=True)
        self.items = copy.deepcopy(original)
        self.items.append(copy.deepcopy(self.items[0]))
        self.exercise(rejected=True)

    def test_full_zip_and_apk_digests_never_publishes(self):
        original = self.archives[11]
        self.archives[11] += b'changed ZIP bytes'
        self.exercise(rejected=True)
        self.archives[11] = original
        self.env['PUPTIME_APK_SHA256'] = 'f' * 64
        self.exercise(rejected=True)
        self.env['PUPTIME_APK_SHA256'] = SHA(self.apk)
        self.archives[11] = zip_bytes({'app-release.apk': b'different APK with newly pinned ZIP'})
        self.rebuild_qualification()
        self.exercise(rejected=True)

    def test_qualification_source_run_and_config_never_publishes(self):
        original = copy.deepcopy(self.info)
        for key, bad in (('sourceCommit', 'b' * 40), ('runId', '9'), ('configuredVersion', '1.12.5'),
                         ('configuredVersionCode', 1012005), ('configuredPackage', 'wrong.package')):
            with self.subTest(key=key):
                self.info = {**original, key: bad}
                self.rebuild_qualification()
                self.exercise(rejected=True)

    def test_manifest_and_signer_receipts_must_match_measured_apk(self):
        self.files['APK-MANIFEST.xml'] = self.files['APK-MANIFEST.xml'].replace(b'1012006', b'1012005')
        self.rebuild_qualification()
        self.exercise(rejected=True)
        self.files['APK-MANIFEST.xml'] = self.files['APK-MANIFEST.xml'].replace(b'1012005', b'1012006')
        self.files['APK-SIGNING.txt'] = ('Signer #1 certificate SHA-256 digest: ' + 'e' * 64 + '\n').encode()
        self.rebuild_qualification()
        self.exercise(rejected=True)

    def test_actual_apk_package_name_code_and_certificate_must_match(self):
        for identity in (('wrong.package', '1.12.6', 1012006), (publisher.PACKAGE, '1.12.5', 1012006),
                         (publisher.PACKAGE, '1.12.6', 1012005)):
            with self.subTest(identity=identity):
                self.exercise(rejected=True, measure=lambda _, value=identity: (value, [self.certificate]))
        self.exercise(rejected=True, measure=lambda _: ((publisher.PACKAGE, '1.12.6', 1012006), ['e' * 64]))

    def test_tag_or_attempt_change_during_validation_never_publishes(self):
        def tag_changed(_):
            self.tag['object']['sha'] = 'b' * 40
            return (publisher.PACKAGE, '1.12.6', 1012006), [self.certificate]
        self.exercise(rejected=True, measure=tag_changed)
        self.tag['object']['sha'] = self.source
        def attempt_changed(_):
            self.run['run_attempt'] = 3
            return (publisher.PACKAGE, '1.12.6', 1012006), [self.certificate]
        self.exercise(rejected=True, measure=attempt_changed)

    def test_extra_zip_member_rejected(self):
        self.archives[11] = zip_bytes({'app-release.apk': self.apk, '../unexpected': b'x'})
        self.rebuild_qualification()
        self.exercise(rejected=True)

    def test_symlink_member_rejected(self):
        entry = zipfile.ZipInfo('app-release.apk')
        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.archives[11] = zip_bytes({entry: self.apk})
        self.rebuild_qualification()
        self.exercise(rejected=True)

    def test_workflow_wires_all_required_pins_to_only_publisher(self):
        workflow = (Path(__file__).parents[1] / '.github/workflows/publish-android-release.yml').read_text()
        for name in ('run_id', 'run_attempt', 'source_commit', 'tag', 'apk_artifact_id', 'apk_artifact_sha256',
                     'qualification_artifact_id', 'qualification_artifact_sha256', 'apk_sha256'):
            self.assertIn('PUPTIME_' + name.upper() + ': ${{ inputs.' + name + ' }}', workflow)
        self.assertEqual(workflow.count('run: python3 scripts/publish-android-release.py'), 1)
        self.assertNotIn('gh release create', workflow)

    def test_sdk_measurement_uses_apk_manifest_and_verified_signer(self):
        badging = b"package: name='com.patrickchin.puptime' versionCode='1012006' versionName='1.12.6' compileSdkVersion='36'\n"
        signature = ('Signer #1 certificate SHA-256 digest: ' + self.certificate + '\n').encode()
        with patch.object(publisher, 'sdk_tool', side_effect=lambda name: '/sdk/' + name), \
             patch.object(publisher.subprocess, 'run', side_effect=[SimpleNamespace(stdout=badging), SimpleNamespace(stdout=signature)]) as command:
            self.assertEqual(publisher.measure_apk(Path('input.apk')),
                             ((publisher.PACKAGE, '1.12.6', 1012006), [self.certificate]))
            self.assertEqual(command.call_args_list[0].args[0], ['/sdk/aapt2', 'dump', 'badging', 'input.apk'])
            self.assertEqual(command.call_args_list[1].args[0], ['/sdk/apksigner', 'verify', '--verbose', '--print-certs', 'input.apk'])

    def test_missing_digest_or_noncanonical_version_input_rejected(self):
        for key, value in (('PUPTIME_QUALIFICATION_ARTIFACT_SHA256', ''), ('PUPTIME_TAG', 'v1.12.06'),
                           ('GITHUB_REPOSITORY', 'someone/puptime')):
            env = {**self.env, key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                publisher.pins_from_environment(env)


class BetaCertificateBoundary(unittest.TestCase):
    def test_exact_both_signers_and_fail_closed_controls(self):
        spec = importlib.util.spec_from_file_location('beta', Path(__file__).with_name('verify-android-beta-signing.py'))
        beta = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(beta)
        import base64
        der = b'finite synthetic certificate bytes, never a private key'
        expected = SHA(der)
        apk = 'Signer #1 certificate SHA-256 digest: ' + expected + '\n'
        pem = '-----BEGIN CERTIFICATE-----\n' + base64.b64encode(der).decode() + '\n-----END CERTIFICATE-----\n'
        beta.verify_beta_signers(expected, apk, pem)
        for certificate, report, certificate_pem in [
            ('', apk, pem), (beta.TEMPLATE_CERT, apk, pem), ('f' * 64, apk, pem),
            (expected, '', pem), (expected, apk.replace(expected, 'f' * 64), pem),
            (expected, apk + apk.replace('#1', '#2'), pem),
            (expected, apk, ''), (expected, apk, pem + pem),
            (expected, apk, pem.replace(base64.b64encode(der).decode(), 'ZmFrZQ==')),
        ]:
            with self.subTest(certificate=certificate), self.assertRaises(ValueError):
                beta.verify_beta_signers(certificate, report, certificate_pem)


class BetaWorkflowBoundary(unittest.TestCase):
    def run_source_step(self, title, env):
        import subprocess
        workflow = (Path(__file__).parents[1] / '.github/workflows/android-apk.yml').read_text()
        step = workflow.split('      - name: ' + title + '\n', 1)[1].split('      - ', 1)[0]
        script = '\n'.join(line[10:] for line in step.split('        run: |\n', 1)[1].splitlines())
        return subprocess.run(['/bin/bash', '--noprofile', '--norc', '-eo', 'pipefail', '-c', script],
                              env=env, capture_output=True, timeout=10).returncode

    def test_actual_unsigned_discovery_admission_guard(self):
        valid = {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_SHA': 'a' * 40,
                 'PUPTIME_EXPECTED_SOURCE': 'a' * 40, 'PUPTIME_SIGNING': 'qa-template', 'PUPTIME_PUBLISH': 'false'}
        title = 'Admit exact unsigned discovery source'
        self.assertEqual(self.run_source_step(title, valid), 0)
        for key, wrong in [('GITHUB_EVENT_NAME', 'pull_request'), ('PUPTIME_EXPECTED_SOURCE', 'b' * 40),
                           ('PUPTIME_SIGNING', 'beta-upload'), ('PUPTIME_PUBLISH', 'true')]:
            with self.subTest(key=key):
                self.assertNotEqual(self.run_source_step(title, {**valid, key: wrong}), 0)

    def test_actual_source_admission_and_template_publication_guards(self):
        valid = {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REF': 'refs/heads/main',
                 'GITHUB_SHA': 'a' * 40, 'PUPTIME_EXPECTED_SOURCE': 'a' * 40,
                 'PUPTIME_PUBLISH': 'false', 'PUPTIME_UPLOAD_CERT_SHA256': 'c' * 64}
        title = 'Admit exact beta source before accessing signing credentials'
        self.assertEqual(self.run_source_step(title, valid), 0)
        for key, wrong in [('GITHUB_EVENT_NAME', 'pull_request'), ('GITHUB_REF', 'refs/heads/unreviewed'),
                           ('PUPTIME_EXPECTED_SOURCE', 'b' * 40), ('PUPTIME_PUBLISH', 'true'),
                           ('PUPTIME_UPLOAD_CERT_SHA256', ''), ('PUPTIME_UPLOAD_CERT_SHA256', 'f' * 63),
                           ('PUPTIME_UPLOAD_CERT_SHA256', 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c')]:
            with self.subTest(key=key, wrong=wrong):
                self.assertNotEqual(self.run_source_step(title, {**valid, key: wrong}), 0)
        title = 'Keep template QA artifacts out of public releases'
        self.assertEqual(self.run_source_step(title, {'PUPTIME_PUBLISH': 'false'}), 0)
        self.assertNotEqual(self.run_source_step(title, {'PUPTIME_PUBLISH': 'true'}), 0)


if __name__ == '__main__':
    unittest.main()
