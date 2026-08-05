package com.qwenaudio.agent.sdk.client

import com.qwenaudio.agent.sdk.audio.MicCapture
import com.qwenaudio.agent.sdk.audio.PcmCodec
import com.qwenaudio.agent.sdk.audio.PcmPlayer
import com.qwenaudio.agent.sdk.protocol.GatewayClientEvent
import com.qwenaudio.agent.sdk.protocol.GatewayServerEvent
import com.qwenaudio.agent.sdk.transport.RealtimeSocket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class VoiceAgentClient(
    private val config: VoiceAgentConfig,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _events = MutableSharedFlow<VoiceAgentEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<VoiceAgentEvent> = _events.asSharedFlow()

    private val clientInstanceId = UUID.randomUUID().toString()
    private val connected = AtomicBoolean(false)
    private val listening = AtomicBoolean(false)
    private val reconnectAttempt = AtomicInteger(0)
    private var reconnectJob: Job? = null
    private var inputSampleRate = 16_000
    private var outputSampleRate = 24_000

    private val player = PcmPlayer(
        onPlaybackStarted = { id ->
            send(
                JSONObject()
                    .put("type", GatewayClientEvent.PLAYBACK_STARTED)
                    .put("responseId", id),
            )
        },
        onPlaybackEnded = { id ->
            send(
                JSONObject()
                    .put("type", GatewayClientEvent.PLAYBACK_ENDED)
                    .put("responseId", id),
            )
        },
    )

    private var mic: MicCapture? = null

    private val socket = RealtimeSocket(
        onOpen = {
            connected.set(true)
            reconnectAttempt.set(0)
            emit(VoiceAgentEvent.ConnectionChanged("connecting"))
            sendConnect()
        },
        onMessage = { handleServerEvent(it) },
        onFailure = { err ->
            connected.set(false)
            stopListeningInternal()
            emit(VoiceAgentEvent.ConnectionChanged("disconnected", err.message))
            emit(VoiceAgentEvent.Error(err.message ?: "WebSocket failure"))
            scheduleReconnect()
        },
        onClosed = {
            connected.set(false)
            stopListeningInternal()
            emit(VoiceAgentEvent.ConnectionChanged("disconnected"))
            scheduleReconnect()
        },
    )

    private var userWantsConnection = false

    fun connect() {
        userWantsConnection = true
        reconnectJob?.cancel()
        emit(VoiceAgentEvent.ConnectionChanged("connecting"))
        socket.connect(config.realtimeWsUrl(), config.authToken)
    }

    fun disconnect() {
        userWantsConnection = false
        reconnectJob?.cancel()
        stopListeningInternal()
        player.release()
        socket.close()
        connected.set(false)
        emit(VoiceAgentEvent.ConnectionChanged("disconnected"))
    }

    fun startListening() {
        if (!connected.get()) {
            emit(VoiceAgentEvent.Error("未连接 Gateway"))
            return
        }
        if (!listening.compareAndSet(false, true)) return
        send(JSONObject().put("type", GatewayClientEvent.UNMUTE).put("takeover", false))
        try {
            val capture = MicCapture(inputSampleRate) { frame ->
                send(
                    JSONObject()
                        .put("type", GatewayClientEvent.AUDIO_APPEND)
                        .put("audio", PcmCodec.encodeBase64(frame)),
                )
            }
            mic = capture
            capture.start()
        } catch (e: Exception) {
            listening.set(false)
            emit(VoiceAgentEvent.Error(e.message ?: "无法打开麦克风"))
        }
    }

    fun stopListening() {
        stopListeningInternal()
        if (connected.get()) {
            send(JSONObject().put("type", GatewayClientEvent.MUTE))
        }
    }

    fun sendText(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        if (!connected.get()) {
            emit(VoiceAgentEvent.Error("未连接 Gateway"))
            return
        }
        send(
            JSONObject()
                .put("type", GatewayClientEvent.TEXT_MESSAGE)
                .put("text", trimmed),
        )
    }

    fun interrupt() {
        player.clear("user_interruption")
        emit(VoiceAgentEvent.PlaybackCleared)
        send(JSONObject().put("type", GatewayClientEvent.INTERRUPT))
    }

    private fun stopListeningInternal() {
        if (!listening.compareAndSet(true, false)) {
            mic?.stop()
            mic = null
            return
        }
        mic?.stop()
        mic = null
    }

    private fun sendConnect() {
        send(
            JSONObject()
                .put("type", GatewayClientEvent.CONNECT)
                .put("timeZone", config.timeZone)
                .put("locale", config.locale)
                .put("voiceEnabled", true)
                .put("inputEnabled", true)
                .put("outputEnabled", true)
                .put("clientType", config.clientType)
                .put("clientLabel", config.clientLabel)
                .put("clientInstanceId", clientInstanceId)
                .put("takeover", false),
        )
    }

    private fun handleServerEvent(event: JSONObject) {
        when (event.optString("type")) {
            GatewayServerEvent.VOICE_READY -> {
                val inRate = event.optInt("inputSampleRate", 0)
                val outRate = event.optInt("outputSampleRate", 0)
                if (inRate > 0) inputSampleRate = inRate
                if (outRate > 0) outputSampleRate = outRate
                player.ensureRate(outputSampleRate)
                emit(VoiceAgentEvent.ConnectionChanged("connected"))
            }
            GatewayServerEvent.VOICE_CONNECTION -> {
                val state = event.optString("state", "connecting")
                val message = if (event.has("message")) event.optString("message") else null
                emit(VoiceAgentEvent.ConnectionChanged(state, message))
            }
            GatewayServerEvent.VOICE_STATE -> {
                emit(VoiceAgentEvent.VoiceState(event.optString("state", "")))
            }
            GatewayServerEvent.PLAYBACK_CLEAR -> {
                player.clear(event.optString("reason", ""))
                emit(VoiceAgentEvent.PlaybackCleared)
            }
            GatewayServerEvent.AUDIO_DELTA -> {
                val audio = event.optString("audio", "")
                if (audio.isBlank()) return
                val rate = event.optInt("sampleRate", outputSampleRate)
                player.ensureRate(rate)
                player.play(PcmCodec.decodeBase64(audio), event.optString("responseId", ""))
            }
            GatewayServerEvent.AUDIO_DONE -> {
                player.markDone(event.optString("responseId", ""))
            }
            GatewayServerEvent.TRANSCRIPT_DELTA -> {
                val text = event.optString(
                    "content",
                    event.optString("text", event.optString("delta", "")),
                )
                val role = event.optString("role", "assistant")
                if (text.isNotBlank()) {
                    emit(VoiceAgentEvent.Transcript(role, text, isFinal = false))
                }
            }
            GatewayServerEvent.TRANSCRIPT_FINAL -> {
                val text = event.optString(
                    "content",
                    event.optString("transcript", event.optString("text", "")),
                )
                val role = event.optString("role", "assistant")
                if (text.isNotBlank()) {
                    emit(VoiceAgentEvent.Transcript(role, text, isFinal = true))
                }
            }
            GatewayServerEvent.ERROR -> {
                emit(VoiceAgentEvent.Error(event.optString("message", "Gateway error")))
            }
        }
    }

    private fun send(payload: JSONObject) {
        socket.send(payload)
    }

    private fun emit(event: VoiceAgentEvent) {
        _events.tryEmit(event)
    }

    private fun scheduleReconnect() {
        if (!userWantsConnection) return
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            val attempt = reconnectAttempt.incrementAndGet().coerceAtMost(6)
            val delayMs = (500L * (1 shl (attempt - 1))).coerceAtMost(15_000L)
            delay(delayMs)
            if (userWantsConnection && !connected.get()) {
                emit(VoiceAgentEvent.ConnectionChanged("connecting", "正在重连…"))
                socket.connect(config.realtimeWsUrl(), config.authToken)
            }
        }
    }
}
