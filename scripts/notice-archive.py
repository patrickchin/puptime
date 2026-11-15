"""Read-only, bounded SDK/archive notice input. Never extracts files."""
import base64
import hashlib
import io
import json
import re
import struct
import sys
import zipfile
from pathlib import Path, PurePosixPath

MAX_TEXT = 1024 * 1024
MAX_TOTAL_TEXT = 16 * MAX_TEXT
MAX_NESTED = 128 * MAX_TEXT
MAX_NATIVE = 192 * MAX_TEXT
NATIVE_CHUNK = MAX_TEXT


def native_digest(archive, entry):
    if entry.file_size > MAX_NATIVE:
        raise ValueError("Oversized native input")
    digest = hashlib.sha256()
    observed = 0
    with archive.open(entry) as stream:
        while chunk := stream.read(NATIVE_CHUNK):
            observed += len(chunk)
            if observed > entry.file_size or observed > MAX_NATIVE:
                raise ValueError("Native input size mismatch")
            digest.update(chunk)
    if observed != entry.file_size:
        raise ValueError("Native input size mismatch")
    return digest.hexdigest()


def is_macho(archive, entry):
    # CAFEBABE is shared with JVM class files. Check the bounded universal
    # architecture table, not magic alone (Apple mach-o/fat.h; JVMS 4.1).
    with archive.open(entry) as stream:
        header = stream.read(8)
        magic = header[:4]
        if magic in [b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xce"]:
            return True
        if magic not in [b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca", b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca"]:
            return False
        endian = ">" if magic[:2] == b"\xca\xfe" else "<"
        count = struct.unpack(endian + "I", header[4:8])[0] if len(header) == 8 else 0
        wide = magic in [b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca"]
        width = 32 if wide else 20
        if 0 < count <= 64 and 8 + count * width <= entry.file_size:
            table = stream.read(count * width)
            ranges = [struct.unpack_from(endian + ("QQ" if wide else "II"), table, i * width + 8) for i in range(count)]
            if all(offset >= 8 + count * width and size >= 4 and offset + size <= entry.file_size for offset, size in ranges):
                return True
        if magic == b"\xca\xfe\xba\xbe" and entry.filename.endswith(".class") and len(header) == 8 and struct.unpack(">H", header[6:8])[0] >= 45:
            return False
        raise ValueError("Malformed or unsupported universal native input")


def inspect_archive(path, payload_path=None, bundle_path=None):
    result = {"notices": [], "nativeFiles": [], "payload": None, "bundle": None}
    total = 0

    def inspect(source, prefix="", depth=0):
        nonlocal total
        with zipfile.ZipFile(source) as archive:
            entries = archive.infolist()
            if len(entries) > 100000:
                raise ValueError("Too many archive entries")
            names = [entry.filename for entry in entries]
            if len(set(names)) != len(names):
                raise ValueError("Duplicate archive entry")
            for entry in entries:
                name = entry.filename
                if name.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", name) or "\\" in name or ".." in PurePosixPath(name).parts:
                    raise ValueError("Unsafe archive entry")
                if entry.is_dir():
                    continue
                logical = prefix + name
                if payload_path and not prefix and name == payload_path:
                    if entry.file_size > MAX_TOTAL_TEXT:
                        raise ValueError("Oversized notice payload")
                    raw = archive.read(entry)
                    json.loads(raw)
                    result["payload"] = {"sha256": hashlib.sha256(raw).hexdigest(), "base64": base64.b64encode(raw).decode()}
                if bundle_path and not prefix and name == bundle_path:
                    if not 0 < entry.file_size <= MAX_NESTED:
                        raise ValueError("Empty or oversized application bundle")
                    result["bundle"] = {"sha256": hashlib.sha256(archive.read(entry)).hexdigest(), "bytes": entry.file_size}
                if not (payload_path and not prefix and name == payload_path) and any(re.fullmatch(r"(licen[sc]es?|notices?|copying|copyright|third[._-]?party[._-]?(licen[sc]es?|notices?))([._-].*)?", part, re.I) for part in PurePosixPath(name).parts):
                    if not 0 < entry.file_size <= MAX_TEXT:
                        raise ValueError("Empty or oversized notice")
                    total += entry.file_size
                    if total > MAX_TOTAL_TEXT:
                        raise ValueError("Too much notice text")
                    raw = archive.read(entry)
                    body = raw.decode("utf-8")
                    if not body.strip() or "\0" in body:
                        raise ValueError("Unreadable notice")
                    result["notices"].append({"source": logical, "body": body, "sha256": hashlib.sha256(raw).hexdigest()})
                if name.endswith(".so") or is_macho(archive, entry):
                    result["nativeFiles"].append({"path": logical, "sha256": native_digest(archive, entry)})
                if depth == 0 and name.endswith(".jar"):
                    if entry.file_size > MAX_NESTED:
                        raise ValueError("Oversized nested SDK archive")
                    inspect(io.BytesIO(archive.read(entry)), logical + "!", depth + 1)

    inspect(path)
    return result


if __name__ == "__main__":
    try:
        print(json.dumps(inspect_archive(Path(sys.argv[1]), *sys.argv[2:4])))
    except Exception:
        # SDK/cache paths and arbitrary archive data never enter CI logs.
        print("Notice archive inspection failed closed.", file=sys.stderr)
        sys.exit(1)
