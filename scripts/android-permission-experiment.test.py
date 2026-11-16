"""Synthetic/source-only checks. No real APK, manifest, key, device or network IO."""
import hashlib, importlib.util, json, os, subprocess, tempfile, unittest, warnings, zipfile
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('permission', HERE / 'android-permission-experiment.py')
p = importlib.util.module_from_spec(spec); spec.loader.exec_module(p)

def xml(body=''):
    return ('<manifest xmlns:android="' + p.ANDROID + '" package="' + p.APP + '">' + body + '</manifest>').encode()

BODY = '<permission android:name="' + p.TARGET + '" android:protectionLevel="signature"/><uses-permission android:name="' + p.TARGET + '"/>'

def owner(name=p.TARGET, package=p.APP, protection='signature', labels=False):
    return ('+ permission:' + name + '\n  package:' + package + ('\n  label:PRIVATE LABEL\n  description:PRIVATE DESCRIPTION' if labels else '') + '\n  protectionLevel:' + protection + '\n').encode()

def private(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_bytes(data); path.chmod(0o600)
    return hashlib.sha256(data).hexdigest()

class PermissionTests(unittest.TestCase):
    def test_closed_projection_and_signature_numeric_formats(self):
        for value in ['signature', '2', '0000000002', '0x2', '0x00000002', '0X00000002']:
            self.assertTrue(p.project_manifest(xml(BODY.replace('"signature"', '"' + value + '"')))['signatureOnly'])
        for value in ['0x12', '18', '0x100000002', '00000000002', 'signature|privileged', '+2', '-2', ' 2', '2.0', '0b10', 'PRIVATE_SECRET']:
            self.assertFalse(p.project_manifest(xml(BODY.replace('"signature"', '"' + value + '"')))['signatureOnly'])
        result = p.project_manifest(xml(BODY + '<application android:label="PRIVATE_NAME"/>'))
        self.assertEqual(result, {'permission': 'APP_DYNAMIC_RECEIVER_NOT_EXPORTED', 'present': True, 'signatureOnly': True, 'requested': True, 'otherDeclarationCount': 0, 'otherDeclarationsSHA256': hashlib.sha256(b'[]').hexdigest()})
        result = p.project_manifest(xml('<permission android:name="PRIVATE_NAME" android:protectionLevel="PRIVATE_SECRET"/>'))
        self.assertEqual(result['otherDeclarationCount'], 1); self.assertNotIn('PRIVATE', json.dumps(result))

    def test_bounded_complete_utf8_xml_no_alias_entities_or_side_channels(self):
        values = [b'', b'\xff', xml(BODY)[:-1], b'x' * (p.MAX_BYTES + 1), xml(BODY + BODY), xml(BODY).replace(p.APP.encode(), b'WRONG', 1), xml('<application>' * 65 + '</application>' * 65), xml('<application/>' * 4096), xml().replace(b'package=', b'package="duplicate" package='), xml('<application xmlns:android="' + p.ANDROID + '"/>'), xml().replace(b'android=', b'other='), xml('<application xmlns:x="' + p.ANDROID + '"/>')]
        values += [xml(BODY).decode().encode(enc) for enc in ['utf-16-le', 'utf-16-be', 'utf-32-le', 'utf-32-be']]
        values += [xml(value) for value in ['<!-- PRIVATE -->', '<?private SECRET?>', '<![CDATA[PRIVATE]]>', '<application android:label="A&amp;B"/>']]
        values += [prefix + xml(BODY) for prefix in [b'<!DOCTYPE manifest>', b'<!DOCTYPE manifest [<!ENTITY x "PRIVATE">]>', b'<?xml version="1.0" encoding="ISO-8859-1"?>']]
        for value in values:
            with self.subTest(size=len(value)), self.assertRaises(Exception): p.project_manifest(value)

    def test_owner_source_shaped_unique_block_and_only_finite_public_fields(self):
        data = b'All Permissions:\n\n' + owner('android.permission.INTERNET', 'android', 'normal') + owner(labels=True)
        self.assertEqual(p.project_owner(data), {'permission': 'APP_DYNAMIC_RECEIVER_NOT_EXPORTED', 'ownerObserved': True, 'expectedAppOwnsPermission': True, 'signatureOnly': True})
        result = p.project_owner(b'All Permissions:\n\n' + owner(package='PRIVATE_OTHER_OWNER'))
        self.assertFalse(result['expectedAppOwnsPermission']); self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertFalse(p.project_owner(b'All Permissions:\n\n' + owner(protection='signature|privileged'))['signatureOnly'])

    def test_owner_malformed_duplicate_truncated_and_unsupported_outputs_stop(self):
        valid = b'All Permissions:\n\n' + owner()
        invalid = [b'', b'\xff', valid[:-1], valid + b'junk', valid + owner(), valid.replace(b'  package:', b' package:'), valid.replace(b'\n  protectionLevel:', b'\n  package:duplicate\n  protectionLevel:'), valid.replace(b'All Permissions:', b'Normal Permissions:'), valid.replace(p.TARGET.encode(), b'PRIVATE_OTHER_PERMISSION'), valid.replace(b'package:', b'package:\x00'), valid.replace(b'  package:', b'  label:PRIVATE\n  package:'), valid.replace(b'\n', b'\r\n'), b'x' * (p.MAX_OWNER_BYTES + 1)]
        for value in invalid:
            with self.subTest(size=len(value)), self.assertRaises(Exception): p.project_owner(value)

    def test_private_reader_rejects_fifo_symlink_modes_and_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); root.chmod(0o700); path = root / 'manifest.xml'; private(path, xml(BODY))
            pin = p.private_digest(path, root, p.MAX_BYTES)
            self.assertTrue(p.project_manifest(p.checked_file(path, pin, root))['present'])
            for changed in [{**pin, 'bytes': pin['bytes'] + 1}, {**pin, 'sha256': '0' * 64}, {**pin, 'mode': 0o644}]:
                with self.assertRaises(Exception): p.checked_file(path, changed, root)
            path.chmod(0o644)
            with self.assertRaises(Exception): p.private_digest(path, root)
            path.chmod(0o600); real = root / 'real.xml'; path.rename(real); path.symlink_to(real)
            with self.assertRaises(Exception): p.private_digest(path, root)
            path.unlink(); os.mkfifo(path, mode=0o600)
            with patch.object(p.os, 'open', side_effect=AssertionError('FIFO opened')) as opened:
                with self.assertRaises(ValueError): p.private_digest(path, root)
                with self.assertRaises(ValueError): p.checked_file(path, pin, root)
                opened.assert_not_called()

    def test_private_stream_rejects_in_place_change_during_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); root.chmod(0o700); path = root / 'fixture.bin'; private(path, b'SYNTHETIC')
            original = os.read; changed = False
            def read(fd, count):
                nonlocal changed
                data = original(fd, count)
                if not changed: changed = True; path.write_bytes(b'CHANGED')
                return data
            with patch.object(p.os, 'read', side_effect=read), self.assertRaises(ValueError): p.private_digest(path, root)

    def test_production_inventory_all_three_and_125_unknown_blocks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); root.chmod(0o700); pins = []
            for i, label in enumerate(['original125', 'QA6', 'QA7']):
                folder = '' if i == 0 else ['bridge', 'later'][i - 1] + '/'
                apk, manifest = folder + 'input.apk', folder + 'manifest.xml'
                apk_sha = private(root / apk, ('SYNTHETIC_APK_' + label).encode()); manifest_sha = private(root / manifest, xml(BODY))
                zip_sha = private((root / apk).parent / 'puptime-android-qualification.zip', ('SYNTHETIC_ZIP_' + label).encode()) if i else None
                pins.append((label, apk, manifest, apk_sha, manifest_sha if i else None, zip_sha))
            with patch.object(p, 'PINS', pins):
                value = p.inventory(root)
                self.assertEqual([row['artifact'] for row in value['artifacts']], ['original125', 'QA6', 'QA7'])
                self.assertNotIn(str(root), json.dumps(value)); self.assertNotIn('SYNTHETIC', json.dumps(value))
                private(root / pins[0][2], xml())
                with self.assertRaises(ValueError): p.inventory(root)
                private(root / pins[0][2], xml(BODY)); private(root / pins[0][1], b'WRONG_APK')
                with patch.object(p, 'project_manifest', side_effect=AssertionError('Must stop before projection')) as project:
                    with self.assertRaises(ValueError): p.inventory(root)
                    project.assert_not_called()

    def test_payload_every_zip_entry_and_manifest_no_meta_inf_exception(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); root.chmod(0o700); (root / 'bridge').mkdir(mode=0o700)
            def archive(name, entries, comment=b''):
                path = root / name
                with warnings.catch_warnings(), zipfile.ZipFile(path, 'w') as z:
                    warnings.simplefilter('ignore', UserWarning)
                    for key, value in entries: z.writestr(key, value)
                    z.comment = comment
                path.chmod(0o600)
            entries = [('AndroidManifest.xml', b'SAME_BINARY_MANIFEST'), ('classes.dex', b'SAME_CODE'), ('META-INF/SIGNATURE.RSA', b'SAME_SIGNATURE')]
            archive('bridge/input.apk', entries); archive('control6.apk', entries, b'control-signing-block-model'); archive('bridge6.apk', entries, b'experiment-signing-block-model')
            result = p.compare_payloads(root)
            self.assertTrue(result['allEntriesEqual']); self.assertEqual(result['entryCount'], 3); self.assertNotIn('classes.dex', json.dumps(result))
            for changed in [entries + [('other', b'x')], entries[:-1] + [('META-INF/SIGNATURE.RSA', b'CHANGED')], [('AndroidManifest.xml', b'CHANGED')] + entries[1:], entries + [entries[0]], [('AndroidManifest.xml', b'SAME_BINARY_MANIFEST'), ('../private', b'x')]]:
                archive('bridge6.apk', changed, b'different')
                with self.assertRaises(Exception): p.compare_payloads(root)
            archive('bridge6.apk', entries, b'control-signing-block-model')
            with self.assertRaises(ValueError): p.compare_payloads(root)

    def test_zip_crc_symlink_and_all_three_explicit_limits_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); root.chmod(0o700); path = root / 'fixture.apk'
            def write(symlink=False):
                with zipfile.ZipFile(path, 'w') as archive:
                    archive.writestr('AndroidManifest.xml', b'MANIFEST')
                    entry = zipfile.ZipInfo('classes.dex')
                    if symlink: entry.external_attr = (0o120777 << 16)
                    archive.writestr(entry, b'SYNTHETIC_CODE')
                path.chmod(0o600)
            write(); self.assertEqual(p.zip_payload(path, root)[2], hashlib.sha256(b'MANIFEST').hexdigest())
            for name, limit in [('MAX_ENTRIES', 1), ('MAX_ENTRY_BYTES', 4), ('MAX_PAYLOAD_BYTES', 8)]:
                with patch.object(p, name, limit), self.assertRaises(ValueError): p.zip_payload(path, root)
            write(True)
            with self.assertRaises(ValueError): p.zip_payload(path, root)
            write(); data = path.read_bytes().replace(b'SYNTHETIC_CODE', b'SYNTHETIC_FAIL'); private(path, data)
            with self.assertRaises(zipfile.BadZipFile): p.zip_payload(path, root)

    def test_second_descriptor_growth_stops_at_pinned_size_plus_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); root.chmod(0o700); path = root / 'fixture.apk'
            with zipfile.ZipFile(path, 'w') as archive: archive.writestr('AndroidManifest.xml', b'SYNTHETIC_MANIFEST')
            path.chmod(0o600); initial = path.stat().st_size; fdopen = os.fdopen; original_zip = zipfile.ZipFile
            requested, consumed = [], []
            class Reader:
                def __init__(self, stream): self.stream, self.hashing, self.grown = stream, False, False
                def __enter__(self): return self
                def __exit__(self, *args): return self.stream.__exit__(*args)
                def __getattr__(self, name): return getattr(self.stream, name)
                def seek(self, offset, whence=0):
                    if offset == 0 and whence == 0: self.hashing = True
                    return self.stream.seek(offset, whence)
                def read(self, count=-1):
                    if self.hashing and not self.grown:
                        self.grown = True
                        with path.open('ab') as output: output.write(b'GROWTH' * 1000)
                    data = self.stream.read(count)
                    if self.hashing: requested.append(count); consumed.append(len(data))
                    return data
            with patch.object(p.os, 'fdopen', side_effect=lambda *args, **kwargs: Reader(fdopen(*args, **kwargs))), patch.object(p.zipfile, 'ZipFile', wraps=original_zip) as parsed:
                with self.assertRaises(ValueError): p.zip_payload(path, root)
                parsed.assert_not_called()
            self.assertTrue(requested)
            self.assertTrue(all(0 < count <= min(65536, initial + 1) for count in requested))
            self.assertLessEqual(sum(consumed), initial + 1)

    def test_cli_no_arbitrary_path_mode_or_error_disclosure(self):
        for args in [[], ['--unknown', '/PRIVATE_TOKEN'], ['--inventory', '/PRIVATE_TOKEN']]:
            result = subprocess.run(['python3', str(HERE / 'android-permission-experiment.py'), *args], text=True, capture_output=True, timeout=10, env={**os.environ, 'GITHUB_RUN_ID': '1', 'GITHUB_RUN_ATTEMPT': '1', 'RUNNER_TEMP': '/private/tmp'})
            self.assertEqual(result.returncode, 1); self.assertEqual(result.stderr, '')
            self.assertEqual(json.loads(result.stdout), {'status': 'UNKNOWN', 'category': 'permission-evidence-rejected'})

    def test_actual_node_helpers_control_gate_default_scope_and_original_error(self):
        source = r'''
(async()=>{
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const source=fs.readFileSync(process.argv[1],'utf8'),context={assert,utilTypes:require('node:util').types,createHash:crypto.createHash,join:path.join};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const app='),source.indexOf('const [mode]='))+'\nglobalThis.api={commandFailure,permissionControl,permissionCapabilityPair,equivalentChanges};',context);
const api=context.api,begin=source.indexOf("if(permissionExperimentSelected){\n exerciseEvidence.begin('permission-control-install')"),end=source.indexOf("\nexerciseEvidence.begin('bridge-install')",begin);assert(begin>0&&end>begin);
const body=source.slice(begin,end),keys=['permissionExperimentSelected','exerciseEvidence','command','device','join','root','permissionExperiment','permissionControl','persistPermission','equal','before','snapshot','installedApkHash','oldSHA','permissionOwner','pass','assert','app'];
const run=new (Object.getPrototypeOf(async()=>{}).constructor)(...keys,body+';return "experiment-next";'),details={commandKind:'adb-install',installCodeDecline:'ambiguous-content',installCodeAmbiguity:{firstPredicate:'code-token-count',successToken:false,codeTokens:'multiple',failureMarkers:'multiple',publicCodes:['INSTALL_FAILED_DUPLICATE_PERMISSION'],unknownCodeObserved:false}};
let cases=0;
for(const defect of ['none','unknown-control','success-control','state','readback','owner']){
 let compared=false,passed=false;const original=api.commandFailure(new Error('PRIVATE ORIGINAL'),{status:1},defect==='unknown-control'?{}:details),stable={ownerObserved:true,expectedAppOwnsPermission:true,signatureOnly:true},experiment={originalOwner:stable};
 const values=[true,{begin(){},end(){}},(_binary,args)=>{if(args.includes('control6.apk')||args.some(v=>typeof v==='string'&&v.endsWith('/control6.apk'))){if(defect!=='success-control')throw original;return 'Success';}return Buffer.from('installed');},'emulator-5588',path.join,'/private/synthetic',experiment,api.permissionControl,()=>{},()=>{compared=true;if(defect==='state')throw original;},{},()=>({}),async()=>defect==='readback'?'wrong':'expected','expected',()=>defect==='owner'?{...stable,expectedAppOwnsPermission:false}:stable,()=>{passed=true;},assert,'com.patrickchin.puptime'];
 if(defect==='none'){assert.equal(await run(...values),'experiment-next');assert(compared&&passed);assert.equal(experiment.control.installCode,undefined);assert.equal(experiment.control.evidence,'consistent-observed-set-only');}
 else{let caught;try{await run(...values);}catch(error){caught=error;}assert(caught);assert.equal(passed,false);if(['unknown-control','state'].includes(defect))assert.equal(caught,original);}
 const before=JSON.stringify(experiment);values[0]=false;assert.equal(await run(...values),'experiment-next');assert.equal(JSON.stringify(experiment),before);cases++;
}
console.log(JSON.stringify({status:'passed',actualControlBlockCases:cases,defaultNewControlIO:0}));
})().catch(()=>{process.exitCode=1;});
'''
        result = subprocess.run(['node', '-e', source, str(HERE / 'verify-android-signing-upgrade.mjs')], text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, 'Actual control block model failed (private details suppressed).')
        self.assertEqual(json.loads(result.stdout), {'status': 'passed', 'actualControlBlockCases': 6, 'defaultNewControlIO': 0})

    def test_actual_dispatch_invalid_flag_never_prevents_owned_host_cleanup(self):
        source = r'''
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const source=fs.readFileSync(process.argv[1],'utf8'),mode=process.argv[2],calls=[];let flagReads=0,selfChecks=0;
const context={assert,utilTypes:require('node:util').types,createHash:crypto.createHash,join:path.join};vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const app='),source.indexOf('const [mode]=')),context);
const select=context.permissionSelection;context.permissionSelection=value=>{flagReads++;return select(value);};context.emulatorHost=value=>calls.push(value);context.selfCheck=()=>selfChecks++;
const report=exit=>console.log(JSON.stringify({mode,calls,flagReads,selfChecks,exit}));
context.console={error(){}};context.process={argv:['node','driver',mode],env:{PUPTIME_PERMISSION_EXPERIMENT:'INVALID'},exit(code){report(code);process.exit(code);}};
try{vm.runInContext(source.slice(source.indexOf('const [mode]='),source.indexOf('const exerciseReceipt=')),context);report(null);}catch{report('rejected');}
'''
        for mode in ['--emulator-record', '--emulator-root', '--emulator-offline', '--emulator-cleanup', '--self-check', '--preflight', '--exercise', '--unknown']:
            result = subprocess.run(['node', '-e', source, str(HERE / 'verify-android-signing-upgrade.mjs'), mode], text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, 'Actual dispatch model failed (private details suppressed).')
            value = json.loads(result.stdout)
            if mode.startswith('--emulator-'):
                self.assertEqual(value, {'mode': mode, 'calls': [mode], 'flagReads': 0, 'selfChecks': 0, 'exit': 0})
            elif mode == '--unknown':
                self.assertEqual(value, {'mode': mode, 'calls': [], 'flagReads': 0, 'selfChecks': 0, 'exit': None})
            else:
                self.assertEqual(value, {'mode': mode, 'calls': [], 'flagReads': 1, 'selfChecks': 0, 'exit': 'rejected'})

    def test_source_inventory_precedes_keys_device_and_workflow_selection_is_explicit(self):
        source = (HERE / 'verify-android-signing-upgrade.mjs').read_text()
        workflow = (HERE.parent / '.github/workflows/android-signing-proof.yml').read_text()
        self.assertLess(workflow.index('--preflight'), workflow.index('- name: Prepare isolated Android tools'))
        self.assertLess(source.index("inputs.permissionInventory=permissionEvidence('--inventory')"), source.index("exerciseEvidence.begin('qa-key-creation')"))
        self.assertLess(source.index("assert.deepEqual(permissionEvidence('--inventory'),inputs.permissionInventory)"), source.index("const device='emulator-5588'"))
        self.assertIn('permission_experiment:\n        description:', workflow); self.assertIn('type: boolean\n        default: false', workflow)
        self.assertIn('PUPTIME_PERMISSION_EXPERIMENT: ${{ inputs.permission_experiment }}', workflow)
        self.assertIn("const permissionSource='" + p.SOURCE + "';", source)
        self.assertIn("oldSHA='" + p.PINS[0][3] + "'", source)
        for row in p.PINS[1:]: self.assertIn(row[5], source)

    def test_actual_signing_matrix_same_b_same_input_sdk33_and_default_unchanged(self):
        source = r'''
const fs=require('node:fs'),assert=require('node:assert/strict'),source=fs.readFileSync(process.argv[1],'utf8');
const start=source.indexOf('for(const [name,input,keys] of '),end=source.indexOf('){\n const target=',start);assert(start>0&&end>start);
const expression=source.slice(start+'for(const [name,input,keys] of '.length,end),matrix=new Function('permissionExperimentSelected','A','B','lineage','signingLineage','return '+expression),A=['A-KEY'],B=['ONE-B-KEY'];
const expected=[['plain6','bridge',B],['bridge6','bridge',[...A,'--next-signer',...B,'--lineage','FALSE-LINEAGE','--rotation-min-sdk-version','33']],['plain7','later',B]];
assert.deepEqual(matrix(false,A,B,'FALSE-LINEAGE','FALSE-LINEAGE'),expected);
const selected=matrix(true,A,B,'FALSE-LINEAGE','TRUE-LINEAGE');assert.deepEqual(selected.slice(0,3),[expected[0],['bridge6','bridge',[...A,'--next-signer',...B,'--lineage','TRUE-LINEAGE','--rotation-min-sdk-version','33']],expected[2]]);
assert.deepEqual(selected[3],['control6','bridge',expected[1][2]]);assert.equal(selected.length,4);
console.log('{"status":"passed","defaultVariants":3,"selectedVariants":4}');
'''
        result = subprocess.run(['node', '-e', source, str(HERE / 'verify-android-signing-upgrade.mjs')], text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, 'Actual signing matrix model failed (private details suppressed).')
        self.assertEqual(json.loads(result.stdout), {'status': 'passed', 'defaultVariants': 3, 'selectedVariants': 4})

if __name__ == '__main__': unittest.main()
