"""Expose VoiceMem's external-ASR streaming path to Cascade.

This bridge deliberately only performs current-turn retrieval. Durable ingest
and episode capture remain owned by qwen-audio-agent's existing memory layers.
"""

import asyncio
import os
from dataclasses import dataclass

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from voicemem import VoiceMem


class PartialRequest(BaseModel):
    session_id: str
    turn_id: str
    text: str


@dataclass
class TurnStream:
    stream: object
    lock: asyncio.Lock


app = FastAPI(title="qwen-audio-agent VoiceMem bridge")
llm_provider = os.getenv("VOICEMEM_LLM_PROVIDER", "deepseek").strip().lower()
default_base_url = (
    "http://127.0.0.1:11434/v1"
    if llm_provider == "ollama"
    else "https://api.deepseek.com"
)
llm_key = (
    os.getenv("VOICEMEM_LLM_API_KEY")
    or os.getenv("DEEPSEEK_API_KEY")
    or os.getenv("OPENAI_API_KEY", "")
    or ("ollama" if llm_provider == "ollama" else "")
)
llm_base_url = os.getenv("VOICEMEM_LLM_BASE_URL", default_base_url).rstrip("/")
llm_model = os.getenv(
    "VOICEMEM_LLM_MODEL",
    "qwen2.5:7b" if llm_provider == "ollama" else "deepseek-v4-flash",
)

# Cascade already owns VAD/ASR/audio perception. Use VoiceMem's text mode and
# local E5 retrieval so DeepSeek is only used for cognitive LLM work; DeepSeek
# does not provide an embeddings endpoint.
voice_mem: VoiceMem | None = None
warmup_task: asyncio.Task | None = None
warmup_error: str | None = None


def create_voice_mem() -> VoiceMem:
    return VoiceMem.from_config({
        # Explicit internal name: avoid VoiceMem's multi-modal warmup because
        # Cascade already owns ASR/VAD/audio perception.
        "mode": os.getenv("VOICEMEM_MODE", "text_mode"),
        "api_key": llm_key,
        "base_url": llm_base_url,
        "embedding": {"provider": "local"},
        "slots": {"provider": "local"},
        "llm": {"provider": "openai", "config": {
            "model": llm_model,
            "api_key": llm_key,
            "base_url": llm_base_url,
        }},
    })
streams: dict[str, TurnStream] = {}


@app.on_event("startup")
async def warmup() -> None:
    global warmup_task
    warmup_task = asyncio.create_task(load_voice_mem())


async def load_voice_mem() -> None:
    global voice_mem, warmup_error
    try:
        instance = await asyncio.to_thread(create_voice_mem)
        # VoiceMem 0.2.3 warmup currently loads its own ASR/VAD/perception
        # stack regardless of text_mode. Cascade already owns those stages;
        # warm only the local text classifier used by speculative retrieval.
        await asyncio.to_thread(instance.classify, "你好")
        voice_mem = instance
    except Exception as error:
        warmup_error = str(error)


def key_for(request: PartialRequest) -> str:
    return f"{request.session_id}:{request.turn_id}"


def result_payload(state: object) -> dict:
    return {
        "facts": list(getattr(state, "result_leftbrain", []) or []),
        "affect": list(getattr(state, "result_rightbrain", []) or []),
        "relationship": [],
        "source": "voicemem",
    }


@app.get("/health")
async def health() -> dict:
    if warmup_error:
        return {"status": "error", "provider": "voicemem", "detail": warmup_error}
    if voice_mem is None:
        return {"status": "warming_up", "provider": "voicemem"}
    return {"status": "ok", "provider": "voicemem"}


@app.post("/v1/turn/partial")
async def turn_partial(request: PartialRequest) -> dict:
    if voice_mem is None:
        raise HTTPException(status_code=503, detail="VoiceMem is still warming up")
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    key = key_for(request)
    turn = streams.get(key)
    if turn is None:
        turn = TurnStream(
            stream=voice_mem.stream(on_partial=lambda _text: None),
            lock=asyncio.Lock(),
        )
        streams[key] = turn
    async with turn.lock:
        try:
            state = await turn.stream.feed_partial(text, ended=False)
        except Exception as error:
            raise HTTPException(status_code=502, detail=str(error)) from error
    return result_payload(state)


@app.delete("/v1/turn/{session_id}/{turn_id}")
async def close_turn(session_id: str, turn_id: str) -> dict:
    streams.pop(f"{session_id}:{turn_id}", None)
    return {"ok": True}
