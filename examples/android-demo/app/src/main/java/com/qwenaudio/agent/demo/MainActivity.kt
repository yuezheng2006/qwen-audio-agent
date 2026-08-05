package com.qwenaudio.agent.demo

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlin.math.sin
import kotlin.random.Random
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat

class MainActivity : ComponentActivity() {
    private val viewModel: DemoViewModel by viewModels()
    private var pendingStartCall = false

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted && pendingStartCall) {
            pendingStartCall = false
            viewModel.startCall { true }
        } else {
            pendingStartCall = false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = android.graphics.Color.BLACK
        setContent {
            val state by viewModel.ui.collectAsState()
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(CallColors.Background)
                    .statusBarsPadding(),
            ) {
                if (state.inCall) {
                    CallScreen(
                        state = state,
                        onMute = viewModel::toggleMute,
                        onHangUp = viewModel::hangUp,
                        onInterrupt = viewModel::interrupt,
                    )
                } else {
                    IdleScreen(
                        state = state,
                        onUrlChange = viewModel::onUrlChange,
                        onStart = { startCallWithPermission() },
                    )
                }
            }
        }
    }

    private fun startCallWithPermission() {
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            viewModel.startCall { true }
        } else {
            pendingStartCall = true
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }
}

@Composable
private fun IdleScreen(
    state: DemoUiState,
    onUrlChange: (String) -> Unit,
    onStart: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 28.dp)
            .padding(top = 20.dp, bottom = 36.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        StatusBadge(text = "待接通", active = false)

        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                ListeningOrb(active = true, speaking = false, compact = false)
                Text(
                    "语音助手",
                    color = CallColors.TextPrimary,
                    fontSize = 26.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    "靠近说话 · 接通后直接开口",
                    color = CallColors.TextMuted,
                    fontSize = 14.sp,
                )
                TipChip("● 按下方按钮开始通话")
                state.error?.let {
                    Text(it, color = CallColors.HangUp, fontSize = 13.sp, textAlign = TextAlign.Center)
                }
            }
        }

        // Gateway 地址：窄一些，不当主视觉
        OutlinedTextField(
            value = state.gatewayUrl,
            onValueChange = onUrlChange,
            modifier = Modifier
                .widthIn(max = 320.dp)
                .fillMaxWidth(0.88f),
            singleLine = true,
            label = { Text("Gateway") },
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = CallColors.White,
                unfocusedTextColor = CallColors.TextMuted,
                focusedBorderColor = CallColors.NeonDim,
                unfocusedBorderColor = CallColors.PanelBorder,
                focusedLabelColor = CallColors.Neon,
                unfocusedLabelColor = CallColors.TextMuted,
                cursorColor = CallColors.Neon,
            ),
            shape = RoundedCornerShape(16.dp),
        )

        Box(modifier = Modifier.height(20.dp))

        // 胶囊按钮：内容宽度，居中，不铺满
        Box(
            modifier = Modifier
                .wrapContentWidth()
                .height(48.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(CallColors.Neon)
                .clickable(onClick = onStart)
                .padding(horizontal = 36.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "开始通话",
                color = Color.Black,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun CallScreen(
    state: DemoUiState,
    onMute: () -> Unit,
    onHangUp: () -> Unit,
    onInterrupt: () -> Unit,
) {
    val statusLabel = callStatusLabel(state)
    val listState = rememberLazyListState()
    val speaking = state.voiceState.contains("speaking", ignoreCase = true) ||
        state.voiceState.contains("responding", ignoreCase = true) ||
        state.voiceState.contains("thinking", ignoreCase = true)
    val liveAudio = !state.muted && (state.listening || speaking)

    LaunchedEffect(state.drafts.size, state.drafts.lastOrNull()?.text) {
        if (state.drafts.isNotEmpty()) {
            listState.animateScrollToItem(state.drafts.lastIndex)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp)
            .padding(top = 10.dp, bottom = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StatusBadge(text = statusLabel, active = liveAudio)
            Text(
                formatCallTimer(state.callSeconds),
                color = CallColors.White,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
            )
        }

        Box(modifier = Modifier.height(18.dp))

        // 通话中心：波形（像正在通话）+ 轻点打断
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(96.dp)
                .clickable(onClick = onInterrupt),
            contentAlignment = Alignment.Center,
        ) {
            if (liveAudio) {
                VoiceWaveform(
                    active = true,
                    intense = speaking,
                    modifier = Modifier
                        .fillMaxWidth(0.72f)
                        .height(72.dp),
                )
            } else {
                ListeningOrb(active = false, speaking = false, compact = true)
            }
        }

        Box(modifier = Modifier.height(10.dp))
        Text(
            statusLabel,
            color = CallColors.TextPrimary,
            fontSize = 22.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            when {
                state.muted -> "已静音"
                speaking -> "点波形可打断"
                else -> "直接开口说话"
            },
            color = CallColors.TextMuted,
            fontSize = 13.sp,
        )

        state.error?.let {
            Box(modifier = Modifier.height(8.dp))
            Text(it, color = CallColors.HangUp, fontSize = 12.sp, textAlign = TextAlign.Center)
        }

        Box(modifier = Modifier.height(16.dp))

        // Siri 式对话：无边框容器，气泡居中叠层
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 8.dp),
            contentAlignment = Alignment.BottomCenter,
        ) {
            if (state.drafts.isEmpty()) {
                Text(
                    "说点什么吧…",
                    color = CallColors.TextMuted.copy(alpha = 0.55f),
                    fontSize = 16.sp,
                    modifier = Modifier.align(Alignment.Center),
                )
            } else {
                LazyColumn(
                    state = listState,
                    verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.Bottom),
                    modifier = Modifier.fillMaxSize(),
                    reverseLayout = false,
                ) {
                    items(state.drafts.takeLast(12)) { line ->
                        SiriBubble(line = line)
                    }
                }
            }
        }

        Box(modifier = Modifier.height(20.dp))

        // 底栏：小按钮居中，不铺满
        Row(
            modifier = Modifier
                .wrapContentWidth()
                .align(Alignment.CenterHorizontally),
            horizontalArrangement = Arrangement.spacedBy(36.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CallAction(
                label = if (state.muted) "取消静音" else "静音",
                background = CallColors.MuteButton,
                size = 52.dp,
                labelSize = 12.sp,
                onClick = onMute,
            ) {
                Icon(
                    imageVector = if (state.muted) Icons.Filled.MicOff else Icons.Filled.Mic,
                    contentDescription = if (state.muted) "取消静音" else "静音",
                    tint = CallColors.White,
                    modifier = Modifier.size(22.dp),
                )
            }
            CallAction(
                label = "挂断",
                background = CallColors.HangUp,
                size = 58.dp,
                labelSize = 12.sp,
                onClick = onHangUp,
            ) {
                Icon(
                    imageVector = Icons.Filled.CallEnd,
                    contentDescription = "挂断",
                    tint = CallColors.White,
                    modifier = Modifier.size(24.dp),
                )
            }
        }
    }
}

@Composable
private fun SiriBubble(line: TranscriptLine) {
    val isUser = line.role == "user"
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
    ) {
        Text(
            text = line.text + if (!line.isFinal) " …" else "",
            color = if (isUser) CallColors.White else CallColors.TextSecondary,
            fontSize = 16.sp,
            lineHeight = 23.sp,
            textAlign = if (isUser) TextAlign.End else TextAlign.Start,
            modifier = Modifier
                .widthIn(max = 300.dp)
                .background(
                    color = if (isUser) CallColors.NeonSoft else Color(0x22FFFFFF),
                    shape = RoundedCornerShape(
                        topStart = 18.dp,
                        topEnd = 18.dp,
                        bottomStart = if (isUser) 18.dp else 6.dp,
                        bottomEnd = if (isUser) 6.dp else 18.dp,
                    ),
                )
                .padding(horizontal = 14.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun VoiceWaveform(
    active: Boolean,
    intense: Boolean,
    modifier: Modifier = Modifier,
) {
    val barCount = 36
    var phase by remember { mutableFloatStateOf(0f) }
    var frame by remember { mutableIntStateOf(0) }
    val levels = remember { FloatArray(barCount) { 0.25f } }

    LaunchedEffect(active, intense) {
        while (active) {
            phase += if (intense) 0.28f else 0.16f
            for (i in levels.indices) {
                val wave = (sin(phase + i * 0.45f) + 1f) / 2f
                val jitter = Random.nextFloat() * if (intense) 0.55f else 0.28f
                val target = (0.12f + wave * (if (intense) 0.88f else 0.55f) + jitter)
                    .coerceIn(0.08f, 1f)
                levels[i] = levels[i] * 0.55f + target * 0.45f
            }
            frame += 1
            delay(32)
        }
        for (i in levels.indices) levels[i] = 0.12f
        frame += 1
    }

    Canvas(modifier = modifier) {
        // read frame so Canvas redraws each tick
        val snapshot = frame
        val gap = 3.dp.toPx()
        val barWidth = ((size.width - gap * (barCount - 1)) / barCount).coerceAtLeast(2.dp.toPx())
        val maxH = size.height
        val color = if (intense) CallColors.Neon else CallColors.Neon.copy(alpha = 0.85f)
        for (i in 0 until barCount) {
            val level = levels[i] * (0.97f + (snapshot % 3) * 0.01f)
            val h = maxH * level
            val x = i * (barWidth + gap)
            val y = (maxH - h) / 2f
            drawRoundRect(
                color = color,
                topLeft = Offset(x, y),
                size = Size(barWidth, h),
                cornerRadius = CornerRadius(barWidth / 2f, barWidth / 2f),
            )
        }
    }
}

@Composable
private fun StatusBadge(text: String, active: Boolean) {
    Row(
        modifier = Modifier
            .background(CallColors.BadgeFill, RoundedCornerShape(50))
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Canvas(modifier = Modifier.size(8.dp)) {
            drawCircle(if (active) CallColors.Neon else CallColors.TextMuted)
        }
        Text(
            text,
            color = if (active) CallColors.Neon else CallColors.TextMuted,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun TipChip(text: String) {
    Text(
        text = text,
        color = CallColors.Neon,
        fontSize = 13.sp,
        modifier = Modifier
            .border(1.dp, CallColors.NeonDim, RoundedCornerShape(50))
            .background(CallColors.BadgeFill, RoundedCornerShape(50))
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

@Composable
private fun ListeningOrb(
    active: Boolean,
    speaking: Boolean,
    compact: Boolean = false,
) {
    val transition = rememberInfiniteTransition(label = "orb")
    val pulse by transition.animateFloat(
        initialValue = 0.92f,
        targetValue = 1.08f,
        animationSpec = infiniteRepeatable(
            animation = tween(if (speaking) 700 else 1400, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulse",
    )
    val ring by transition.animateFloat(
        initialValue = 0.85f,
        targetValue = 1.2f,
        animationSpec = infiniteRepeatable(
            animation = tween(2200, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "ring",
    )

    Canvas(modifier = Modifier.size(if (compact) 96.dp else 220.dp)) {
        val center = Offset(size.width / 2f, size.height / 2f)
        val base = size.minDimension * 0.28f
        val glowAlpha = if (active) 0.45f else 0.18f

        if (active) {
            drawCircle(
                color = CallColors.Neon.copy(alpha = 0.12f * (1.3f - (ring - 0.85f))),
                radius = base * 1.85f * ring,
                center = center,
                style = Stroke(width = 2.dp.toPx()),
            )
            drawCircle(
                color = CallColors.NeonRing,
                radius = base * 1.45f * pulse,
                center = center,
                style = Stroke(width = 1.5.dp.toPx()),
            )
        }

        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(
                    CallColors.Neon.copy(alpha = glowAlpha + 0.25f),
                    CallColors.NeonDim.copy(alpha = glowAlpha),
                    Color.Transparent,
                ),
                center = center,
                radius = base * 1.7f,
            ),
            radius = base * 1.7f,
            center = center,
        )

        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(
                    Color(0xFF7DFFC4),
                    CallColors.Neon,
                    CallColors.NeonDim,
                ),
                center = Offset(center.x - base * 0.25f, center.y - base * 0.3f),
                radius = base * 1.2f,
            ),
            radius = base * pulse,
            center = center,
        )

        // specular highlight
        drawCircle(
            color = Color.White.copy(alpha = 0.35f),
            radius = base * 0.18f,
            center = Offset(center.x - base * 0.28f, center.y - base * 0.32f),
        )

        val inner = base * 0.42f
        drawCircle(
            color = CallColors.Neon,
            radius = inner,
            center = center,
        )

        // mic glyph
        val micColor = Color.Black
        val micW = inner * 0.28f
        val micH = inner * 0.42f
        val micTop = center.y - micH * 0.55f
        drawRoundRect(
            color = micColor,
            topLeft = Offset(center.x - micW / 2f, micTop),
            size = androidx.compose.ui.geometry.Size(micW, micH),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(micW / 2f, micW / 2f),
        )
        drawCircle(
            color = micColor,
            radius = micW * 0.55f,
            center = Offset(center.x, micTop + micH - micW * 0.2f),
            style = Stroke(width = 3.dp.toPx()),
        )
        drawLine(
            color = micColor,
            start = Offset(center.x, micTop + micH + micW * 0.15f),
            end = Offset(center.x, micTop + micH + micW * 0.55f),
            strokeWidth = 3.dp.toPx(),
        )
    }
}

@Composable
private fun CallAction(
    label: String,
    background: Color,
    size: androidx.compose.ui.unit.Dp,
    onClick: () -> Unit,
    labelSize: androidx.compose.ui.unit.TextUnit = 14.sp,
    icon: @Composable () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            modifier = Modifier
                .size(size)
                .clip(CircleShape)
                .background(background)
                .clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            icon()
        }
        Box(modifier = Modifier.height(6.dp))
        Text(label, color = CallColors.White, fontSize = labelSize)
    }
}

private fun callStatusLabel(state: DemoUiState): String {
    if (state.connectionState == "connecting") return "连接中"
    if (state.connectionState != "connected") return "未连接"
    if (state.muted) return "已静音"
    val vs = state.voiceState.lowercase()
    return when {
        vs.contains("speaking") || vs.contains("responding") || vs.contains("thinking") -> "助手在说"
        state.listening -> "在听你说"
        else -> "已连接"
    }
}

private fun formatCallTimer(seconds: Int): String {
    val m = seconds / 60
    val s = seconds % 60
    return "%02d:%02d".format(m, s)
}
