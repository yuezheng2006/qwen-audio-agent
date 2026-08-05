package com.qwenaudio.agent.sdk.protocol

/** Aligns with shared/realtime-events.mjs — keep names in sync manually. */
object GatewayClientEvent {
    const val CONNECT = "connect"
    const val UNMUTE = "unmute"
    const val MUTE = "mute"
    const val INPUT_UNMUTE = "input.unmute"
    const val INPUT_MUTE = "input.mute"
    const val AUDIO_APPEND = "audio.append"
    const val TEXT_MESSAGE = "text.message"
    const val INTERRUPT = "interrupt"
    const val PLAYBACK_STARTED = "playback.started"
    const val PLAYBACK_ENDED = "playback.ended"
    const val PLAYBACK_CANCELLED = "playback.cancelled"
}

object GatewayServerEvent {
    const val GATEWAY_CONNECTED = "gateway.connected"
    const val GATEWAY_DISCONNECTED = "gateway.disconnected"
    const val VOICE_CONNECTION = "voice.connection"
    const val VOICE_READY = "voice.ready"
    const val VOICE_STATE = "voice.state"
    const val PLAYBACK_CLEAR = "playback.clear"
    const val AUDIO_DELTA = "audio.delta"
    const val AUDIO_DONE = "audio.done"
    const val TRANSCRIPT_DELTA = "transcript.delta"
    const val TRANSCRIPT_FINAL = "transcript.final"
    const val TRANSCRIPT_DISCARD = "transcript.discard"
    const val ERROR = "error"
}
