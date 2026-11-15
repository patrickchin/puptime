"""Bounded producer-side Maestro JUnit projection; never return XML/body/errors."""
# cli-2.11.0 c8c361be: JUnitTestSuiteReporter.kt emits these exact nesting/count
# and file/status attributes. Unknown attributes/properties/text are never output.
import json
import sys
from xml.parsers import expat


def project(data, expected):
    unknown = {"complete": False, "rows": []}
    if len(data) > 2 * 1024 * 1024 or len(expected) not in (1, 13) or len(set(expected)) != len(expected):
        return unknown
    indexes = {name: index for index, name in enumerate(expected)}
    stack, rows, seen = [], [], set()
    state = {"root": False, "closed": False, "suites": 0, "nodes": 0, "properties": False}
    current = None
    failures = None

    def invalid(*_):
        raise ValueError("unsupported report")

    def start(name, attrs):
        nonlocal current, failures
        state["nodes"] += 1
        if state["nodes"] > 10000:
            invalid()
        parent = stack[-1] if stack else None
        if parent is None:
            if name != "testsuites" or state["root"]:
                invalid()
            state["root"] = True
        elif parent == "testsuites":
            if name != "testsuite" or state["suites"]:
                invalid()
            state["suites"] += 1
            tests, failed = attrs.get("tests", ""), attrs.get("failures", "")
            if not tests.isascii() or not tests.isdecimal() or int(tests) != len(expected):
                invalid()
            if not failed.isascii() or not failed.isdecimal() or int(failed) > len(expected):
                invalid()
            failures = int(failed)
        elif parent == "testsuite":
            if name == "properties":
                if state["properties"] or rows:
                    invalid()
                state["properties"] = True
                stack.append(name)
                return
            file = attrs.get("file")
            if name != "testcase" or file not in indexes or file in seen or "status" not in attrs:
                invalid()
            seen.add(file)
            status = attrs["status"] if attrs["status"] in ("SUCCESS", "ERROR") else "UNKNOWN"
            current = {"index": indexes[file], "status": status, "properties": False, "failure": False}
        elif parent == "testcase":
            if name == "properties" and not current["properties"]:
                current["properties"] = True
            elif name in ("failure", "error") and not current["failure"]:
                current["failure"] = True
            else:
                invalid()
        elif parent != "properties" or name != "property":
            invalid()
        stack.append(name)

    def end(name):
        nonlocal current
        if name == "testcase":
            status = "UNKNOWN" if current["status"] == "SUCCESS" and current["failure"] else current["status"]
            rows.append({"index": current["index"], "status": status})
            current = None
        stack.pop()
        if name == "testsuites":
            state["closed"] = True

    def text(value):
        if value.strip(" \t\r\n") and (not stack or stack[-1] not in ("failure", "error", "property")):
            invalid()

    def declaration(version, encoding, _):
        if version != "1.0" or encoding and encoding.upper() not in ("UTF-8", "UTF8"):
            invalid()

    try:
        parser = expat.ParserCreate(encoding="UTF-8")
        parser.StartElementHandler, parser.EndElementHandler = start, end
        parser.CharacterDataHandler, parser.XmlDeclHandler = text, declaration
        parser.StartDoctypeDeclHandler = parser.EntityDeclHandler = invalid
        parser.ExternalEntityRefHandler = parser.SkippedEntityHandler = invalid
        parser.CommentHandler = parser.StartCdataSectionHandler = invalid
        parser.ProcessingInstructionHandler = invalid
        parser.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)
        parser.Parse(data, True)
        if not state["closed"] or stack or state["suites"] != 1 or len(rows) != len(expected):
            return unknown
        if failures != sum(row["status"] == "ERROR" for row in rows):
            return unknown
        return {"complete": all(row["status"] != "UNKNOWN" for row in rows), "rows": rows}
    except Exception:
        return unknown


if __name__ == "__main__":
    try:
        result = project(sys.stdin.buffer.read(2 * 1024 * 1024 + 1), sys.argv[1:])
    except Exception:
        result = {"complete": False, "rows": []}
    sys.stdout.write(json.dumps(result, separators=(",", ":")))
