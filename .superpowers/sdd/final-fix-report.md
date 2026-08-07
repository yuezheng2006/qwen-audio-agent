# Voice Studio whole-branch review final fixes

## 2026-08-07

- Fixed C1: `presetsDir` is wired from bootstrap into the default `SampleResolver`; regression coverage uses a real file under a configured presets directory.
- Fixed C2: a missing `config/voice-presets/catalog.json` now logs a warning and exposes an empty catalog; the package whitelist includes `config/voice-presets/`.
- Fixed I1: persisted sample references use the source file when enrollment receives a data URI, while serialized tool profiles omit sample paths, `ownerId`, and opaque provider payloads.
- Fixed I2: `voice_confirm` returns `mode_conflict` outside cascade mode before persistence or restart.
- Fixed I3: cross-provider confirmation applies a known provider model default when `targetModel` is absent.
- Fixed I4: profile labels preserve the user-facing text, including Chinese; DashScope prefix sanitization remains provider-local.

Remaining manual step: perform the live DashScope API smoke test (I5). Fish/MiniMax enroll HTTP and real cloud ASR remain out of scope.
