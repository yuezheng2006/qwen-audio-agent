package com.qwenaudio.agent.sdk.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import java.util.concurrent.atomic.AtomicBoolean

internal class PcmPlayer(
    private val onPlaybackStarted: (responseId: String) -> Unit,
    private val onPlaybackEnded: (responseId: String) -> Unit,
) {
    private var track: AudioTrack? = null
    private var sampleRate = 24_000
    private val playing = AtomicBoolean(false)
    private var activeResponseId = ""

    @Synchronized
    fun ensureRate(rate: Int) {
        if (rate <= 0) return
        if (track != null && sampleRate == rate) return
        release()
        sampleRate = rate
        val minBuf = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setBufferSizeInBytes(maxOf(minBuf, sampleRate))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
    }

    @Synchronized
    fun play(pcm: ByteArray, responseId: String) {
        val audioTrack = track ?: return
        if (!playing.getAndSet(true)) {
            activeResponseId = responseId
            audioTrack.play()
            onPlaybackStarted(responseId)
        } else if (responseId.isNotBlank() && responseId != activeResponseId) {
            activeResponseId = responseId
            onPlaybackStarted(responseId)
        }
        var offset = 0
        while (offset < pcm.size) {
            val written = audioTrack.write(pcm, offset, pcm.size - offset)
            if (written <= 0) break
            offset += written
        }
    }

    @Synchronized
    fun markDone(responseId: String) {
        // Stream mode: end signal is informational; keep track warm for next sentence.
        if (responseId.isNotBlank() && responseId == activeResponseId) {
            onPlaybackEnded(responseId)
        }
    }

    @Synchronized
    fun clear(reason: String = "") {
        val id = activeResponseId
        val wasPlaying = playing.getAndSet(false)
        try {
            track?.pause()
            track?.flush()
            track?.stop()
        } catch (_: Exception) {
        }
        activeResponseId = ""
        if (wasPlaying && id.isNotBlank()) {
            onPlaybackEnded(id)
        }
    }

    @Synchronized
    fun release() {
        clear()
        try {
            track?.release()
        } catch (_: Exception) {
        }
        track = null
    }
}
