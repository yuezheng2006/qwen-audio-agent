package com.qwenaudio.agent.sdk.transport

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

internal class RealtimeSocket(
    private val client: OkHttpClient = defaultClient(),
    private val onOpen: () -> Unit,
    private val onMessage: (JSONObject) -> Unit,
    private val onFailure: (Throwable) -> Unit,
    private val onClosed: () -> Unit,
) {
    private val socket = AtomicReference<WebSocket?>(null)
    private val intentionalClose = AtomicBoolean(false)

    fun connect(url: String, authToken: String?) {
        intentionalClose.set(false)
        closeQuietly()
        val builder = Request.Builder().url(url)
        if (!authToken.isNullOrBlank()) {
            builder.header("Authorization", "Bearer $authToken")
        }
        socket.set(
            client.newWebSocket(
                builder.build(),
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        onOpen()
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        try {
                            onMessage(JSONObject(text))
                        } catch (_: Exception) {
                            // ignore non-JSON frames
                        }
                    }

                    override fun onFailure(
                        webSocket: WebSocket,
                        t: Throwable,
                        response: Response?,
                    ) {
                        if (!intentionalClose.get()) onFailure(t)
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        if (!intentionalClose.get()) onClosed()
                    }
                },
            ),
        )
    }

    fun send(payload: JSONObject): Boolean {
        val ws = socket.get() ?: return false
        return ws.send(payload.toString())
    }

    fun close() {
        intentionalClose.set(true)
        closeQuietly()
    }

    private fun closeQuietly() {
        socket.getAndSet(null)?.close(1000, "client_close")
    }

    companion object {
        fun defaultClient(): OkHttpClient =
            OkHttpClient.Builder()
                .pingInterval(20, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .build()
    }
}
