# Android demo Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Scaffold `examples/android-demo` with `:sdk` + `:app` so a phone can demo realtime voice against the existing Gateway.

**Architecture:** Kotlin dual-module Gradle project; SDK owns WS + PCM; App is a thin Compose PTT UI. No Gateway protocol changes.

**Tech Stack:** Kotlin, Android Gradle Plugin, Jetpack Compose, OkHttp WebSocket, Coroutines, AudioRecord/AudioTrack

## Global Constraints

- Path: `examples/android-demo/` only
- Audio: 16 kHz in / 24 kHz out PCM16 Base64
- Events align with `shared/realtime-events.mjs`
- cleartext `ws://` for LAN demo; `wss://` supported
- No task/permission UI in phase 1

---

## Task 1: Spec + repo hygiene

- [x] Design: `docs/superpowers/specs/2026-08-05-android-demo-design.md`
- [x] `.gitignore` Android build artifacts under `examples/android-demo/`

## Task 2: Gradle dual-module skeleton

- [x] Root `settings.gradle.kts`, `build.gradle.kts`, `gradle.properties` + wrapper
- [x] `:sdk` Android library module
- [x] `:app` application module depends on `:sdk`
- [x] README with LAN Gateway steps

## Task 3: SDK protocol + transport + audio + client

- [x] Event constants + JSON encode/decode
- [x] OkHttp WebSocket session + reconnect
- [x] AudioRecord / AudioTrack bridges
- [x] `VoiceAgentClient` public API + `SharedFlow` events

## Task 4: Demo App UI

- [x] Single-screen Compose: URL, connect, PTT, text, interrupt, transcripts, errors
- [x] RECORD_AUDIO permission + cleartext network config

## Task 5: Hand-verify notes

- [x] README acceptance checklist matches design §验收
- [ ] Device hand-verify (needs LAN Gateway + Android Studio install)
