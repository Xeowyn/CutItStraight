#!/usr/bin/env python3
"""Local dev server for the Wood Cutting Game.

Exists for one reason: `python3 -m http.server` sends no Cache-Control header, so
Chrome applies heuristic freshness to the ES modules and will happily serve a stale
`src/*.js` from disk cache on a normal reload. That silently hides code changes and
has already cost one review cycle. Everything here is sent no-store.

    python3 tools/serve.py          # port 8936
    python3 tools/serve.py 8940     # any other port
"""

import http.server
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8936
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    # HTTP/1.1 so keep-alive works properly now that the server is threaded.
    protocol_version = 'HTTP/1.1'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Quiet: a 60fps game requesting nothing is not interesting, and errors
        # still surface through the browser console.
        if '404' in (fmt % args):
            super().log_message(fmt, *args)


# THREADED, like `python3 -m http.server` is (stdlib uses ThreadingHTTPServer).
# A single-threaded TCPServer serialises requests, and a browser opens up to six
# keep-alive connections per host — one held-open socket then blocks every other
# asset and the page stalls half-loaded. The first version of this file got that
# wrong and stranded the game on its loading screen.
class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    with Server(('', PORT), NoCacheHandler) as httpd:
        print(f'Wood Cutting Game -> http://localhost:{PORT}  (no-store, edits always land)')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nstopped')
