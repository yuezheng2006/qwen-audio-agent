#!/usr/bin/env node
/**
 * Stable dual-path gateway launcher.
 *
 *   node scripts/start-gateway.mjs s2s        # low-latency Realtime + longanqian
 *   node scripts/start-gateway.mjs cascade    # likeness via Qwen-Audio-TTS fengge
 *   node scripts/start-gateway.mjs status
 *   node scripts/start-gateway.mjs stop
 *
 * Detaches into its own process group with a PID file so the service survives
 * the launching shell (including Cursor tool shells).
 */

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listCascadeTtsPassthroughEnvKeys } from '../shared/cascade-tts-plugins.mjs'
import { loadRuntimeEnvironment } from '../shared/runtime-environment.mjs'
import {
  describeGatewayMode,
  resolveGatewayMode,
  resolveGatewayModeEnv,
  voiceDisplayName,
} from './lib/gateway-mode.mjs'
import {
  persistGatewayMode,
  readEnvFile,
  resolveUserConfigPath,
} from './lib/runtime-config-file.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runDir = resolve(root, '.run')
const pidPath = resolve(runDir, 'gateway.pid')
const logPath = resolve(runDir, 'gateway.log')
const modePath = resolve(runDir, 'gateway.mode')

loadRuntimeEnvironment({ root })

const host = process.env.HOST || '127.0.0.1'
const port = String(process.env.PORT || '3101')
const publicHost = host === '0.0.0.0' ? '127.0.0.1' : host
const healthUrl = `http://${publicHost}:${port}/api/health`
const publicUrl = `http://${publicHost}:${port}`

function usage(exitCode = 1) {
  process.stderr.write(`用法：
  node scripts/start-gateway.mjs [cascade|s2s]  启动（默认 cascade）
  node scripts/start-gateway.mjs status         查看状态
  node scripts/start-gateway.mjs stop           停止

主链路（音色优先 → 默认 cascade）：
  cascade   本地级联 + Qwen-Audio-TTS 峰哥复刻（默认）
  s2s       DashScope Realtime + 系统音色 longanqian（低延迟旁路）
`)
  process.exit(exitCode)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function readPid() {
  if (!existsSync(pidPath)) return null
  const pid = Number(readFileSync(pidPath, 'utf8').trim())
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

function isAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function fetchHealth() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function stopGateway({ quiet = false } = {}) {
  const pid = readPid()
  if (!pid || !isAlive(pid)) {
    if (existsSync(pidPath)) unlinkSync(pidPath)
    if (!quiet) process.stdout.write('gateway 未在运行\n')
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // already gone
  }
  for (let i = 0; i < 50 && isAlive(pid); i += 1) await sleep(100)
  if (isAlive(pid)) {
    try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
  }
  if (existsSync(pidPath)) unlinkSync(pidPath)
  if (!quiet) process.stdout.write(`已停止 gateway（pid ${pid}）\n`)
}

async function printStatus() {
  const pid = readPid()
  const alive = isAlive(pid)
  const mode = existsSync(modePath)
    ? readFileSync(modePath, 'utf8').trim()
    : '(unknown)'
  const health = await fetchHealth()
  process.stdout.write(`${JSON.stringify({
    pid: alive ? pid : null,
    mode,
    url: publicUrl,
    healthOk: Boolean(health?.ok),
    realtimeProvider: health?.realtimeProvider || null,
    log: logPath,
  }, null, 2)}\n`)
  process.exitCode = health?.ok || alive ? 0 : 1
}

async function waitHealthy(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await fetchHealth()
    if (health?.ok) return health
    await sleep(250)
  }
  return null
}

async function startGateway(modeArg) {
  const mode = resolveGatewayMode(modeArg)
  // Persist + re-read so shell-exported stale TTS vars cannot override config.env.
  persistGatewayMode(mode)
  const fileEnv = readEnvFile(resolveUserConfigPath())
  const modeEnv = resolveGatewayModeEnv(mode, fileEnv)
  const info = describeGatewayMode(mode, fileEnv)
  const ttsProvider = fileEnv.CASCADE_TTS_PROVIDER || modeEnv.CASCADE_TTS_PROVIDER || 'dashscope'
  const ttsVoice = fileEnv.CASCADE_TTS_VOICE_ID || modeEnv.CASCADE_TTS_VOICE_ID || info.voice
  const ttsLabel = voiceDisplayName(ttsVoice, { provider: ttsProvider })

  if (isAlive(readPid()) || await fetchHealth()) {
    await stopGateway({ quiet: true })
    await sleep(400)
  }

  mkdirSync(runDir, { recursive: true })
  writeFileSync(modePath, `${mode}\n`, 'utf8')
  writeFileSync(logPath, '', 'utf8')

  const childEnv = {
    ...process.env,
    ...modeEnv,
  }
  // Capability keys from config.env (WeRead panel, shared DashScope, etc.)
  for (const key of [
    'WEREAD_API_KEY',
    'DASHSCOPE_API_KEY',
    'QWEN_AUDIO_REALTIME_API_KEY',
    'MINERU_API_URL',
    'CONTENT_DIR',
    'KNOWLEDGE_DIR',
  ]) {
    if (fileEnv[key] !== undefined && fileEnv[key] !== '') {
      childEnv[key] = fileEnv[key]
    }
  }
  // Config file wins for cascade TTS selection. Keys come from the plugin
  // registry so new suppliers do not require start-gateway edits.
  if (mode === 'cascade') {
    for (const key of listCascadeTtsPassthroughEnvKeys()) {
      if (fileEnv[key] !== undefined && fileEnv[key] !== '') {
        childEnv[key] = fileEnv[key]
      }
    }
  }

  const logFd = openSync(logPath, 'a')
  const daemon = spawn(process.execPath, [resolve(root, 'server/src/index.mjs')], {
    cwd: resolve(root, 'server'),
    env: childEnv,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  })
  daemon.unref()
  writeFileSync(pidPath, `${daemon.pid}\n`, 'utf8')

  const health = await waitHealthy()
  if (!health?.ok) {
    process.stderr.write(`gateway 启动超时。日志：${logPath}\n`)
    if (existsSync(logPath)) {
      process.stderr.write(readFileSync(logPath, 'utf8').slice(-2000))
    }
    process.exitCode = 1
    return
  }

  process.stdout.write(`gateway 已启动
  mode:     ${info.mode} — ${info.label}
  tts:      ${ttsProvider} / ${health.cascade?.tts || modeEnv.CASCADE_TTS_MODEL || ''}
  voice:    ${ttsLabel}
  provider: ${health.realtimeProvider}
  url:      ${publicUrl}
  pid:      ${daemon.pid}
  log:      ${logPath}
`)
}

const arg = process.argv[2]
if (arg === '-h' || arg === '--help') usage(0)
if (arg === 'stop') {
  await stopGateway()
} else if (arg === 'status') {
  await printStatus()
} else {
  try {
    // No arg → cascade (likeness-first default).
    await startGateway(arg || 'cascade')
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    usage(1)
  }
}
