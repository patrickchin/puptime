"""Read-only, bounded SDK/archive notice input. Never extracts files."""
import base64
import hashlib
import io
import json
import re
import sys
import zipfile
from pathlib import Path, PurePosixPath

MAX_TEXT = 1024 * 1024
MAX_TOTAL_TEXT = 16 * MAX_TEXT
MAX_NESTED = 128 * MAX_TEXT


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
                if any(re.fullmatch(r"(licen[sc]es?|notices?|copying|copyright|third[._-]?party[._-]?(licen[sc]es?|notices?))([._-].*)?", part, re.I) for part in PurePosixPath(name).parts):
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
                if name.endswith(".so"):
                    if entry.file_size > MAX_NESTED:
                        raise ValueError("Oversized native input")
                    result["nativeFiles"].append({"path": logical, "sha256": hashlib.sha256(archive.read(entry)).hexdigest()})
                elif ".framework/" in name or name.endswith(".dylib"):
                    with archive.open(entry) as stream:
                        magic = stream.read(4)
                    if magic in [b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca"]:
                        if entry.file_size > MAX_NESTED:
                            raise ValueError("Oversized native input")
                        result["nativeFiles"].append({"path": logical, "sha256": hashlib.sha256(archive.read(entry)).hexdigest()})
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
