#!/usr/bin/env python3
"""Small local faster-whisper HTTP sidecar for qwen-audio-agent."""

import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from faster_whisper import WhisperModel

MODEL = os.environ.get("FASTER_WHISPER_MODEL", "base")
DEVICE = os.environ.get("FASTER_WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("FASTER_WHISPER_COMPUTE_TYPE", "int8")
HOST = os.environ.get("FASTER_WHISPER_HOST", "127.0.0.1")
PORT = int(os.environ.get("FASTER_WHISPER_PORT", "8765"))
MAX_BYTES = 256 * 1024 * 1024
model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE_TYPE)


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ok": True, "model": MODEL, "device": DEVICE})
            return
        self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/transcribe":
            self.send_json(404, {"error": "not_found"})
            return
        path = None
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > MAX_BYTES:
                self.send_json(413, {"error": "audio_too_large_or_empty"})
                return
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
                handle.write(self.rfile.read(size))
                path = Path(handle.name)
            language = self.headers.get("x-language") or None
            segments, info = model.transcribe(str(path), language=language, vad_filter=True)
            rows = [{
                "id": f"segment_{index}",
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
            } for index, segment in enumerate(segments, start=1)]
            self.send_json(200, {
                "text": "".join(row["text"] for row in rows),
                "language": info.language or language or "auto",
                "segments": rows,
            })
        except Exception as error:
            self.send_json(500, {"error": str(error)[:500]})
        finally:
            if path:
                path.unlink(missing_ok=True)

    def log_message(self, format, *args):
        print(format % args, flush=True)


if __name__ == "__main__":
    print(f"faster-whisper sidecar listening on http://{HOST}:{PORT} (model={MODEL})", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
