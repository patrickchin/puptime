"""Bounded native hashing; no SDK setup or native execution."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("notice_archive", Path(__file__).with_name("notice-archive.py"))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class NativeArchiveTests(unittest.TestCase):
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
