#!/usr/bin/env python3
"""Serve local review media with byte ranges, so browser video seeking works."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re


class ReviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        if Path(self.translate_path(self.path)).is_file():
            self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def send_head(self):
        self.byte_range = None
        value = self.headers.get('Range', '')
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', value)
        path = Path(self.translate_path(self.path))
        # Unsupported/multipart ranges and conditional requests safely use a full response.
        if not match or not any(match.groups()) or self.headers.get('If-Range') or not path.is_file():
            return super().send_head()
        try:
            source = path.open('rb')
        except OSError:
            self.send_error(404, 'File not found')
            return None
        size = path.stat().st_size
        first, last = match.groups()
        start = int(first) if first else max(0, size - int(last))
        end = min(int(last), size - 1) if first and last else size - 1
        if not size or start >= size or start > end or (not first and int(last) == 0):
            source.close()
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None
        self.byte_range = (start, end)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(str(path)))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Last-Modified', self.date_time_string(path.stat().st_mtime))
        self.end_headers()
        source.seek(start)
        return source

    def copyfile(self, source, destination):
        if self.byte_range is None:
            return super().copyfile(source, destination)
        remaining = self.byte_range[1] - self.byte_range[0] + 1
        while remaining:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            destination.write(chunk)
            remaining -= len(chunk)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--port', type=int, default=8877)
    args = parser.parse_args()
    directory = args.directory.resolve(strict=True)
    if not directory.is_dir():
        parser.error('directory must be a folder')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(ReviewHandler, directory=str(directory)))
    print(f'Review gallery: http://127.0.0.1:{server.server_port}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
