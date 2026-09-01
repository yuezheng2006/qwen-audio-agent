#!/usr/bin/env python3
"""Dependency-light local STT sidecar backed by whisper.cpp."""

import json
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WHISPER_BIN = os.environ.get("WHISPER_CPP_BIN", "whisper-cli")
MODEL = os.environ.get("WHISPER_CPP_MODEL", "")
HOST = os.environ.get("WHISPER_CPP_HOST", "127.0.0.1")
PORT = int(os.environ.get("WHISPER_CPP_PORT", "8765"))
MAX_BYTES = 256 * 1024 * 1024


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
            self.send_json(200 if MODEL else 503, {"ok": bool(MODEL), "model": MODEL, "backend": "whisper.cpp"})
            return
        self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/transcribe":
            self.send_json(404, {"error": "not_found"})
            return
        if not MODEL:
            self.send_json(503, {"error": "WHISPER_CPP_MODEL is not configured"})
            return
        source = output = None
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > MAX_BYTES:
                self.send_json(413, {"error": "audio_too_large_or_empty"})
                return
            with tempfile.TemporaryDirectory(prefix="qwaudio-whisper-") as directory:
                source = Path(directory) / "input.wav"
                output = Path(directory) / "result"
                source.write_bytes(self.rfile.read(size))
                language = self.headers.get("x-language") or "auto"
                command = [WHISPER_BIN, "-m", MODEL, "-f", str(source), "-oj", "-of", str(output), "-l", language, "--no-prints"]
                completed = subprocess.run(command, capture_output=True, text=True, timeout=300, check=False)
                if completed.returncode != 0:
                    raise RuntimeError((completed.stderr or completed.stdout or "whisper.cpp failed")[-500:])
                payload = json.loads(Path(f"{output}.json").read_text(encoding="utf-8"))
                rows = [{
                    "id": f"segment_{index}",
                    "start": item.get("offsets", {}).get("from", 0) / 1000,
                    "end": item.get("offsets", {}).get("to", 0) / 1000,
                    "text": item.get("text", "").strip(),
                } for index, item in enumerate(payload.get("transcription", []), start=1)]
                detected = payload.get("result", {}).get("language") or language
                self.send_json(200, {"text": "".join(row["text"] for row in rows), "language": detected, "segments": rows})
        except Exception as error:
            self.send_json(500, {"error": str(error)[:500]})

    def log_message(self, format, *args):
        print(format % args, flush=True)


if __name__ == "__main__":
    print(f"whisper.cpp sidecar listening on http://{HOST}:{PORT} (model={MODEL or 'unset'})", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
