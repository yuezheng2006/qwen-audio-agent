package com.qwenaudio.agent.sdk.audio

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Process
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Captures mono PCM16 at [sampleRateHz] and emits fixed ~20ms frames.
 */
internal class MicCapture(
    private val sampleRateHz: Int = 16_000,
    private val onFrame: (ByteArray) -> Unit,
) {
    private val running = AtomicBoolean(false)
    private var thread: Thread? = null
    private var record: AudioRecord? = null

    fun start() {
        if (!running.compareAndSet(false, true)) return
        val minBuf = AudioRecord.getMinBufferSize(
            sampleRateHz,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        val frameBytes = sampleRateHz / 50 * 2 // 20ms
        val bufferSize = maxOf(minBuf, frameBytes * 4)
        val audioRecord = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            sampleRateHz,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize,
        )
        if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
            running.set(false)
            audioRecord.release()
            throw IllegalStateException("AudioRecord init failed")
        }
        record = audioRecord
        audioRecord.startRecording()
        thread = Thread({
            Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
            val buf = ByteArray(frameBytes)
            while (running.get()) {
                val read = audioRecord.read(buf, 0, buf.size)
                if (read > 0) {
                    val frame = if (read == buf.size) buf.copyOf() else buf.copyOf(read)
                    onFrame(frame)
                }
            }
        }, "voice-agent-mic").also { it.start() }
    }

    fun stop() {
        if (!running.compareAndSet(true, false)) return
        try {
            record?.stop()
        } catch (_: Exception) {
        }
        try {
            record?.release()
        } catch (_: Exception) {
        }
        record = null
        thread?.join(500)
        thread = null
    }
}
