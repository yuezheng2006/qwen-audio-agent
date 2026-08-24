"""Small local HTTP bridge for the qwaudio faster-whisper STT plugin.

Run with uv without installing into the system Python:
  uv run --with faster-whisper python scripts/faster-whisper-server.py
"""

import io
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import wave

from faster_whisper import WhisperModel


MODEL_NAME = os.environ.get("FASTER_WHISPER_MODEL", "tiny")
DEVICE = os.environ.get("FASTER_WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get(
    "FASTER_WHISPER_COMPUTE_TYPE",
    "int8" if DEVICE == "cpu" else "float16",
)
LANGUAGE = os.environ.get("FASTER_WHISPER_LANGUAGE", "") or None
HOST = os.environ.get("FASTER_WHISPER_HOST", "127.0.0.1")
PORT = int(os.environ.get("FASTER_WHISPER_PORT", "8000"))

print(
    f"loading faster-whisper model={MODEL_NAME} device={DEVICE} compute_type={COMPUTE_TYPE}",
    flush=True,
)
MODEL = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE)


def transcribe_wav(payload):
    with wave.open(io.BytesIO(payload), "rb") as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise ValueError("只支持单声道 16-bit PCM WAV")
    segments, _ = MODEL.transcribe(
        io.BytesIO(payload),
        language=LANGUAGE,
        vad_filter=True,
    )
    return "".join(segment.text for segment in segments).strip()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path != "/transcribe":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            text = transcribe_wav(self.rfile.read(length))
            body = json.dumps({"text": text}, ensure_ascii=False).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as error:  # noqa: BLE001 - return service errors as JSON
            body = json.dumps({"error": str(error)}, ensure_ascii=False).encode("utf-8")
            self.send_response(HTTPStatus.BAD_REQUEST)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"{self.address_string()} - {format % args}", flush=True)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"faster-whisper server listening on http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
