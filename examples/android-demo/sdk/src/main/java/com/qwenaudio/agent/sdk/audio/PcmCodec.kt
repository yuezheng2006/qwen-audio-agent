package com.qwenaudio.agent.sdk.audio

import android.util.Base64
import java.nio.ByteBuffer
import java.nio.ByteOrder

internal object PcmCodec {
    fun encodeBase64(pcm16Le: ByteArray): String =
        Base64.encodeToString(pcm16Le, Base64.NO_WRAP)

    fun decodeBase64(base64: String): ByteArray =
        Base64.decode(base64, Base64.DEFAULT)

    fun floatToPcm16Le(samples: FloatArray): ByteArray {
        val out = ByteArray(samples.size * 2)
        val buf = ByteBuffer.wrap(out).order(ByteOrder.LITTLE_ENDIAN)
        for (sample in samples) {
            val clamped = sample.coerceIn(-1f, 1f)
            buf.putShort((clamped * Short.MAX_VALUE).toInt().toShort())
        }
        return out
    }
}
