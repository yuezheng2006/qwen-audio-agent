package com.qwenaudio.agent.sdk.client

sealed class VoiceAgentEvent {
    data class ConnectionChanged(
        val state: String,
        val message: String? = null,
    ) : VoiceAgentEvent()

    data class Transcript(
        val role: String,
        val text: String,
        val isFinal: Boolean,
    ) : VoiceAgentEvent()

    data class VoiceState(val state: String) : VoiceAgentEvent()

    data class Error(val message: String) : VoiceAgentEvent()

    data object PlaybackCleared : VoiceAgentEvent()
}
