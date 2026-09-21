#!/usr/bin/env python3
"""Tiny local server for Focus.

Serves the app's files exactly like a normal static server (GET), but also
accepts POST requests that write a file into this same folder — that's how
the app saves focus-data.json to disk instead of trusting browser storage,
which is what used to get thrown away on every restart.

Only ever binds to 127.0.0.1 — never reachable from outside this PC.
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        name = self.path.lstrip('/')
        ok_name = name and '/' not in name and '\\' not in name and '..' not in name
        ok_ext = name.endswith('.json') or name.endswith('.md')
        if not (ok_name and ok_ext):
            self.send_response(400)
            self.end_headers()
            return
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        try:
            with open(name, 'wb') as f:
                f.write(body)
        except OSError:
            self.send_response(500)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'ok')

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        http.server.SimpleHTTPRequestHandler.end_headers(self)


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)) or '.')
    httpd = http.server.HTTPServer(('127.0.0.1', PORT), Handler)
    print(f"Focus — serving http://127.0.0.1:{PORT}  (Ctrl+C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
