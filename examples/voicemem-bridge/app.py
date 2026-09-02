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
voice_mem = VoiceMem(
    mode=os.getenv("VOICEMEM_MODE", "normal"),
    openai_key=os.getenv("OPENAI_API_KEY", ""),
    top_k=int(os.getenv("VOICEMEM_TOP_K", "5")),
)
streams: dict[str, TurnStream] = {}


@app.on_event("startup")
async def warmup() -> None:
    await asyncio.to_thread(voice_mem.warmup)


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
    return {"status": "ok", "provider": "voicemem"}


@app.post("/v1/turn/partial")
async def turn_partial(request: PartialRequest) -> dict:
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
