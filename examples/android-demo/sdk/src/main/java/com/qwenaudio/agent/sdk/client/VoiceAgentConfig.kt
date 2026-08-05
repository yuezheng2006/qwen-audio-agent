package com.qwenaudio.agent.sdk.client

/**
 * @param baseUrl Gateway origin, e.g. `http://192.168.1.8:3101` or `https://host`
 * @param sessionId query session; empty → `android-demo`
 * @param authToken reserved; unused in personal mode
 */
data class VoiceAgentConfig(
    val baseUrl: String,
    val sessionId: String = "android-demo",
    val authToken: String? = null,
    val clientType: String = "android",
    val clientLabel: String = "AndroidDemo",
    val timeZone: String = java.util.TimeZone.getDefault().id,
    val locale: String = java.util.Locale.getDefault().toLanguageTag(),
) {
    fun realtimeWsUrl(): String {
        val trimmed = baseUrl.trim().trimEnd('/')
        val wsBase = when {
            trimmed.startsWith("https://", ignoreCase = true) ->
                "wss://" + trimmed.removePrefix("https://").removePrefix("HTTPS://")
            trimmed.startsWith("http://", ignoreCase = true) ->
                "ws://" + trimmed.removePrefix("http://").removePrefix("HTTP://")
            trimmed.startsWith("wss://", ignoreCase = true) ||
                trimmed.startsWith("ws://", ignoreCase = true) -> trimmed
            else -> "ws://$trimmed"
        }
        val sid = sessionId.ifBlank { "android-demo" }
        val sep = if (wsBase.contains('?')) '&' else '?'
        // API 26–32 无 encode(String, Charset)；用 String 重载兼容 Android 12。
        @Suppress("DEPRECATION")
        val encoded = java.net.URLEncoder.encode(sid, "UTF-8")
        return "$wsBase/api/realtime${sep}sessionId=$encoded"
    }
}
