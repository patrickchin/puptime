"""Bounded native hashing; no SDK setup or native execution."""
import hashlib
import importlib.util
import io
from pathlib import Path
import struct
import tempfile
from types import SimpleNamespace
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("notice_archive", Path(__file__).with_name("notice-archive.py"))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def jvm_fixture(extra=b"", slots=0, major=52):
    pool = b"\x01\x00\x02QA\x07\x00\x01\x01\x00\x10java/lang/Object\x07\x00\x03"
    return b"\xca\xfe\xba\xbe" + struct.pack(">HHH", 0, major, 5 + slots) + pool + extra + struct.pack(">7H", 0x21, 2, 4, 0, 0, 0, 0)


class NativeArchiveTests(unittest.TestCase):
    def test_empty_notices_are_crc_verified_metadata_and_never_text(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "empty.aar"
            for compression in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                nested = io.BytesIO()
                with zipfile.ZipFile(nested, "w", compression=compression) as archive:
                    archive.writestr("META-INF/NOTICE", b"")
                with zipfile.ZipFile(path, "w", compression=compression) as archive:
                    archive.writestr("third_party_licenses.txt", b"")
                    archive.writestr("LICENSE", b"Actual synthetic notice\n")
                    archive.writestr("classes.jar", nested.getvalue())
                result = reader.inspect_archive(path)
                self.assertEqual(result["notices"], [{"source": "LICENSE", "body": "Actual synthetic notice\n", "sha256": hashlib.sha256(b"Actual synthetic notice\n").hexdigest()}])
                self.assertEqual(result["emptyNotices"], [{"source": source, "bytes": 0, "sha256": hashlib.sha256(b"").hexdigest(), "crc32": "00000000"} for source in ("third_party_licenses.txt", "classes.jar!META-INF/NOTICE")])

    def test_empty_notice_bad_crc_and_nonempty_member_forged_as_zero_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "corrupt.zip"
            for compression in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                for forged in (False, True):
                    with self.subTest(compression=compression, forged=forged):
                        with zipfile.ZipFile(path, "w", compression=compression) as archive:
                            archive.writestr("NOTICE", b"nonempty" if forged else b"")
                        data = bytearray(path.read_bytes())
                        central = data.index(b"PK\x01\x02")
                        struct.pack_into("<I", data, central + 16, 0 if forged else 1)
                        struct.pack_into("<I", data, 14, 0 if forged else 1)
                        if forged:
                            struct.pack_into("<I", data, central + 24, 0)
                            struct.pack_into("<I", data, 22, 0)
                        path.write_bytes(data)
                        with self.assertRaises(zipfile.BadZipFile):
                            reader.inspect_archive(path)

    def test_nonempty_invalid_notices_and_aggregate_limit_still_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.zip"
            for body in (b" \n", b"notice\0body", b"\xff"):
                with zipfile.ZipFile(path, "w") as archive:
                    archive.writestr("NOTICE", body)
                with self.assertRaises(ValueError):
                    reader.inspect_archive(path)
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("NOTICE.empty", b"")
                for index in range(17):
                    archive.writestr(f"NOTICE.{index}", b"a" * 1024**2)
            with self.assertRaisesRegex(ValueError, "Too much notice text"):
                reader.inspect_archive(path)

    def test_positive_jvm_structure_does_not_depend_on_extension(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "classes.jar"
            with zipfile.ZipFile(path, "w") as archive:
                for name in ("QA.class", "DebugProbesKt.bin", "extensionless"):
                    archive.writestr(name, jvm_fixture())
                archive.writestr("modified-utf8", jvm_fixture(b"\x01\x00\x05\xc0\x80\xed\xa0\x80", 1))
            self.assertEqual(reader.inspect_archive(path)["nativeFiles"], [])

    def test_malformed_jvm_pool_version_references_lengths_and_eof_fail(self):
        valid = jvm_fixture()
        invalid = [valid[:8] + b"\x00\x00" + valid[10:], valid[:-1], valid + b"\0",
                   valid[:10] + b"\x02" + valid[11:], valid[:16] + b"\x00\xff" + valid[18:],
                   valid[:-12] + b"\x00\x01" + valid[-10:],
                   valid[:-2] + b"\x00\x01\x00\x01\x00\x00\x00\x03ab",
                   jvm_fixture(b"\x05" + bytes(8), 1),
                   jvm_fixture(b"\x05" + bytes(8) + b"\x07\x00\x06", 3),
                   jvm_fixture(b"\x13\x00\x01", 1), jvm_fixture(major=70),
                   jvm_fixture(b"\x01\x00\x01\x00", 1), jvm_fixture(b"\x01\x00\x01\xff", 1),
                   b"\xca\xfe\xba\xbe\x00\x00\x00\x34" + bytes(1100)]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.jar"
            for data in invalid:
                with self.subTest(sha256=hashlib.sha256(data).hexdigest()):
                    with zipfile.ZipFile(path, "w") as archive:
                        archive.writestr("ambiguous.bin", data)
                    with self.assertRaises(ValueError):
                        reader.inspect_archive(path)

    def test_valid_fat_32_64_swapped_and_jvm_looking_header_are_native_first(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fat.zip"
            with zipfile.ZipFile(path, "w") as archive:
                for endian in (">", "<"):
                    for wide in (False, True):
                        width = 32 if wide else 20
                        table = struct.pack(endian + ("IIQQII" if wide else "IIIII"), 12, 0, 8 + width, 4, 0, *([0] if wide else []))
                        archive.writestr(f"{endian}-{wide}.class", struct.pack(endian + "II", 0xcafebabf if wide else 0xcafebabe, 1) + table + bytes(4))
                table = struct.pack(">IIIII", 12, 0, 1048, 4, 0) * 52
                archive.writestr("major52.bin", struct.pack(">II", 0xcafebabe, 52) + table + bytes(4))
            self.assertEqual(len(reader.inspect_archive(path)["nativeFiles"]), 5)

    def test_jvm_crc_and_original_read_errors_propagate(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "crc.jar"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("QA.bin", jvm_fixture())
            with zipfile.ZipFile(path) as archive:
                entry = archive.infolist()[0]
                offset = entry.header_offset + 30 + len(entry.filename.encode()) + len(entry.extra)
            corrupt = bytearray(path.read_bytes())
            corrupt[offset + 13] ^= 1
            path.write_bytes(corrupt)
            with self.assertRaises(zipfile.BadZipFile):
                reader.inspect_archive(path)
        original = OSError("synthetic JVM read failure")

        class FailedStream(io.BytesIO):
            def read(self, size=-1):
                if self.tell() >= 8:
                    raise original
                return super().read(size)

        with self.assertRaises(OSError) as caught:
            reader.jvm_class_structure(SimpleNamespace(open=lambda _: FailedStream(jvm_fixture())), SimpleNamespace(file_size=len(jvm_fixture())))
        self.assertIs(caught.exception, original)

    def test_jvm_attribute_skip_and_declared_file_bound_are_finite(self):
        data = jvm_fixture()[:-2] + struct.pack(">HHI", 1, 1, 2 * 1024**2) + bytes(2 * 1024**2)
        requests = []

        class BoundedStream(io.BytesIO):
            def read(self, size=-1):
                requests.append(size)
                if not 0 <= size <= 1024**2:
                    raise AssertionError("Unbounded JVM read")
                return super().read(size)

        archive = SimpleNamespace(open=lambda _: BoundedStream(data))
        reader.jvm_class_structure(archive, SimpleNamespace(file_size=len(data)))
        self.assertIn(1024**2, requests)
        with self.assertRaises(ValueError):
            reader.jvm_class_structure(archive, SimpleNamespace(file_size=len(data) + 1))
        requests.clear()
        with self.assertRaises(ValueError):
            reader.jvm_class_structure(archive, SimpleNamespace(file_size=128 * 1024**2 + 1))
        self.assertEqual(requests, [])

    def test_native_stream_never_uses_unbounded_reads(self):
        class BoundedStream(io.BytesIO):
            def read(self, size=-1):
                self_test.assertGreater(size, 0)
                self_test.assertLessEqual(size, 1024 * 1024)
                return super().read(size)

        self_test = self
        data = b"native bytes" * 200000
        archive = SimpleNamespace(open=lambda _: BoundedStream(data))
        self.assertEqual(reader.native_digest(archive, SimpleNamespace(file_size=len(data))), hashlib.sha256(data).hexdigest())

    def test_native_sizes_and_original_read_error_stay_strict(self):
        archive = SimpleNamespace(open=lambda _: io.BytesIO(b"1234"))
        for size in (3, 5):
            with self.assertRaisesRegex(ValueError, "Native input size mismatch"):
                reader.native_digest(archive, SimpleNamespace(file_size=size))
        opened = []
        with self.assertRaisesRegex(ValueError, "Oversized native input"):
            reader.native_digest(SimpleNamespace(open=lambda _: opened.append(True)), SimpleNamespace(file_size=reader.MAX_NATIVE + 1))
        self.assertEqual(opened, [])
        original = OSError("synthetic read failure")

        class FailedStream(io.BytesIO):
            def read(self, size=-1):
                if self.tell() == 0:
                    return super().read(1)
                raise original

        with self.assertRaises(OSError) as caught:
            reader.native_digest(SimpleNamespace(open=lambda _: FailedStream(b"12")), SimpleNamespace(file_size=2))
        self.assertIs(caught.exception, original)

    def test_real_zip_crc_and_truncation_errors_propagate(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "native.aar"
            data = b"\x7fELF" + b"native" * 1000
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("jni/arm64-v8a/libqa.so", data)
            self.assertEqual(reader.inspect_archive(path)["nativeFiles"][0]["sha256"], hashlib.sha256(data).hexdigest())
            original = path.read_bytes()
            with zipfile.ZipFile(path) as archive:
                entry = archive.infolist()[0]
                offset = entry.header_offset + 30 + len(entry.filename.encode()) + len(entry.extra)
            corrupt = bytearray(original)
            corrupt[offset] ^= 1
            path.write_bytes(corrupt)
            with self.assertRaises(zipfile.BadZipFile):
                reader.inspect_archive(path)
            path.write_bytes(original[:-10])
            with self.assertRaises(zipfile.BadZipFile):
                reader.inspect_archive(path)

    def test_native_above_old_cap_streams_but_bundle_and_jar_caps_do_not_change(self):
        self.assertEqual((reader.MAX_TEXT, reader.MAX_TOTAL_TEXT, reader.MAX_NESTED, reader.MAX_NATIVE), (1024**2, 16 * 1024**2, 128 * 1024**2, 192 * 1024**2))
        chunk = bytes(1024**2)
        expected = hashlib.sha256()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "large.aar"
            for name in ("libqa.so", "classes.jar"):
                with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    with archive.open(name, "w") as stream:
                        for _ in range(129):
                            stream.write(chunk)
                            if name == "libqa.so":
                                expected.update(chunk)
                if name == "libqa.so":
                    self.assertEqual(reader.inspect_archive(path)["nativeFiles"], [{"path": name, "sha256": expected.hexdigest()}])
                    with self.assertRaisesRegex(ValueError, "Empty or oversized application bundle"):
                        reader.inspect_archive(path, bundle_path=name)
                    with zipfile.ZipFile(path) as archive:
                        entry = archive.infolist()[0]
                        entry.file_size = reader.MAX_NATIVE + 1
                        with self.assertRaisesRegex(ValueError, "Oversized native input"):
                            reader.native_digest(archive, entry)
                else:
                    with self.assertRaisesRegex(ValueError, "Oversized nested SDK archive"):
                        reader.inspect_archive(path)

    def test_text_and_payload_caps_are_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "text.zip"
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("LICENSE", b"a" * (1024**2 + 1))
            with self.assertRaisesRegex(ValueError, "Empty or oversized notice"):
                reader.inspect_archive(path)
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("third_party_notices.json", b"a" * (16 * 1024**2 + 1))
            with self.assertRaisesRegex(ValueError, "Oversized notice payload"):
                reader.inspect_archive(path, payload_path="third_party_notices.json")


if __name__ == "__main__":
    unittest.main()
