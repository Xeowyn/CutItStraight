#!/bin/sh
# Mac launcher: serves this folder on http://localhost:8936/ and opens the browser.
# Needs python3 (macOS offers to install it the first time if it is missing).
cd "$(dirname "$0")" || exit 1
PORT=8936
(sleep 1; open "http://localhost:$PORT/") &
echo ""
echo "  CUT IT STRAIGHT is running at http://localhost:$PORT/"
echo "  Leave this window open while you play. Close it when you are done."
echo ""
exec python3 -m http.server "$PORT" --bind 127.0.0.1
