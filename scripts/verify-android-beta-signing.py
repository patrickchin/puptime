"""Exact artifact certificate gate only; no key access, enrollment or release claim."""
import base64
import hashlib
import importlib.util
import os
from pathlib import Path
import re

SPEC = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-android-release.py'))
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)
TEMPLATE_CERT = 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c'


def verify_beta_signers(expected, apk_report, aab_pem):
    if not re.fullmatch(r'[a-f0-9]{64}', expected) or expected == TEMPLATE_CERT:
        raise ValueError('An approved non-template upload certificate is required.')
    if publisher.signing_identity(apk_report) != [expected]:
        raise ValueError('APK certificate does not match the approved upload certificate.')
    certificates = re.findall(r'-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END CERTIFICATE-----', aab_pem)
    if len(certificates) != 1:
        raise ValueError('Require exactly one AAB signing certificate.')
    der = base64.b64decode(re.sub(r'\s', '', certificates[0]), validate=True)
    if not der or hashlib.sha256(der).hexdigest() != expected:
        raise ValueError('AAB certificate does not match the approved upload certificate.')


if __name__ == '__main__':
    root = Path('qualification')
    verify_beta_signers(os.environ.get('PUPTIME_UPLOAD_CERT_SHA256', ''),
                        (root / 'APK-SIGNING.txt').read_text(),
                        (root / 'AAB-CERTIFICATE.pem').read_text())
    print('PASS both artifact certificates match the approved non-template upload certificate; Play signing and delivery remain unqualified.')
