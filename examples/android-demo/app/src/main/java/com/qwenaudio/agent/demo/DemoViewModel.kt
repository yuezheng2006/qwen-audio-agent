package com.qwenaudio.agent.demo

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.qwenaudio.agent.sdk.client.VoiceAgentClient
import com.qwenaudio.agent.sdk.client.VoiceAgentConfig
import com.qwenaudio.agent.sdk.client.VoiceAgentEvent
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class TranscriptLine(
    val role: String,
    val text: String,
    val isFinal: Boolean,
)

data class DemoUiState(
    val gatewayUrl: String = "http://127.0.0.1:3101",
    val connectionState: String = "disconnected",
    val connectionMessage: String? = null,
    val error: String? = null,
    val inCall: Boolean = false,
    val muted: Boolean = false,
    val listening: Boolean = false,
    val voiceState: String = "",
    val callSeconds: Int = 0,
    val drafts: List<TranscriptLine> = emptyList(),
)

class DemoViewModel : ViewModel() {
    private val _ui = MutableStateFlow(DemoUiState())
    val ui: StateFlow<DemoUiState> = _ui.asStateFlow()

    private var client: VoiceAgentClient? = null
    private var eventsJob: Job? = null
    private var timerJob: Job? = null
    private var pendingListenAfterConnect = false

    fun onUrlChange(value: String) {
        _ui.update { it.copy(gatewayUrl = value) }
    }

    /** 开始通话：连接 Gateway，连上后自动开麦（对齐参考图「直接开口」）。 */
    fun startCall(ensureMic: () -> Boolean) {
        if (!ensureMic()) return
        pendingListenAfterConnect = true
        _ui.update {
            it.copy(
                inCall = true,
                muted = false,
                error = null,
                callSeconds = 0,
                drafts = emptyList(),
            )
        }
        connectInternal()
        startTimer()
    }

    fun hangUp() {
        pendingListenAfterConnect = false
        timerJob?.cancel()
        timerJob = null
        stopListeningInternal()
        client?.disconnect()
        client = null
        eventsJob?.cancel()
        eventsJob = null
        _ui.update {
            it.copy(
                inCall = false,
                connectionState = "disconnected",
                listening = false,
                muted = false,
                voiceState = "",
                connectionMessage = null,
                callSeconds = 0,
            )
        }
    }

    fun toggleMute() {
        val state = _ui.value
        if (!state.inCall || state.connectionState != "connected") return
        if (state.muted) {
            _ui.update { it.copy(muted = false) }
            startListeningInternal()
        } else {
            _ui.update { it.copy(muted = true) }
            stopListeningInternal()
        }
    }

    fun interrupt() {
        client?.interrupt()
    }

    override fun onCleared() {
        hangUp()
        super.onCleared()
    }

    private fun connectInternal() {
        eventsJob?.cancel()
        client?.disconnect()
        val next = VoiceAgentClient(
            VoiceAgentConfig(baseUrl = _ui.value.gatewayUrl.trim()),
        )
        client = next
        eventsJob = viewModelScope.launch {
            next.events.collect { event ->
                when (event) {
                    is VoiceAgentEvent.ConnectionChanged -> {
                        _ui.update {
                            it.copy(
                                connectionState = event.state,
                                connectionMessage = event.message,
                                error = if (event.state == "connected") null else it.error,
                            )
                        }
                        if (event.state == "connected" && pendingListenAfterConnect && !_ui.value.muted) {
                            pendingListenAfterConnect = false
                            startListeningInternal()
                        }
                        if (event.state == "disconnected" && _ui.value.inCall) {
                            _ui.update { it.copy(listening = false) }
                        }
                    }
                    is VoiceAgentEvent.Transcript -> {
                        _ui.update { state ->
                            state.copy(drafts = mergeTranscript(state.drafts, event))
                        }
                    }
                    is VoiceAgentEvent.VoiceState -> {
                        _ui.update { it.copy(voiceState = event.state) }
                    }
                    is VoiceAgentEvent.Error -> {
                        _ui.update { it.copy(error = event.message) }
                    }
                    VoiceAgentEvent.PlaybackCleared -> Unit
                }
            }
        }
        next.connect()
    }

    private fun startListeningInternal() {
        client?.startListening()
        _ui.update { it.copy(listening = true, error = null) }
    }

    private fun stopListeningInternal() {
        client?.stopListening()
        _ui.update { it.copy(listening = false) }
    }

    private fun startTimer() {
        timerJob?.cancel()
        timerJob = viewModelScope.launch {
            while (isActive) {
                delay(1000)
                if (_ui.value.inCall) {
                    _ui.update { it.copy(callSeconds = it.callSeconds + 1) }
                }
            }
        }
    }

    private fun mergeTranscript(
        current: List<TranscriptLine>,
        event: VoiceAgentEvent.Transcript,
    ): List<TranscriptLine> {
        val last = current.lastOrNull()
        return if (
            last != null &&
            last.role == event.role &&
            !last.isFinal &&
            !event.isFinal
        ) {
            current.dropLast(1) + last.copy(text = event.text)
        } else if (
            last != null &&
            last.role == event.role &&
            !last.isFinal &&
            event.isFinal
        ) {
            current.dropLast(1) + TranscriptLine(event.role, event.text, true)
        } else {
            (current + TranscriptLine(event.role, event.text, event.isFinal)).takeLast(40)
        }
    }
}
