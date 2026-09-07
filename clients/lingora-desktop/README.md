# Lingora Desktop

Rust/Tauri client shell for Lingora.

The client is intentionally a separate host from the Agent runtime:

- React is the replaceable workbench UI.
- Rust owns windows, native permissions, lifecycle, notifications, and platform adapters.
- The Agent/Gateway remains the shared local-first runtime and is reached through the published gateway protocol.
- Electron remains the compatibility client until this host reaches feature parity.

## Current delivery slice

The client now includes:

- the VoiceStudio-style workbench as the default surface;
- gallery, recording, clip preview/download, clone and voice selection flows;
- native Gateway health, start and stop commands;
- native API/WebSocket routing to the local Gateway;
- a bundle-aware Gateway runtime contract under Tauri's `runtime/` resource directory.

The Gateway remains a separate local-first process. The desktop host does not
embed Agent business logic, so the same protocol can be used by Web, macOS,
Windows, iOS and Android hosts.

## Development

From this directory:

```bash
cargo tauri dev
```

The Vite workbench uses port `5174` in this repository; the Tauri dev URL is kept in sync with that configuration.

To build a local macOS application bundle from the same directory:

```bash
cargo tauri build --debug --bundles app
```

The bundle is written to `src-tauri/target/debug/bundle/macos/Lingora.app`.

For a local checkout, the host expects the repository Node runtime and its
installed dependencies. `LINGORA_RUNTIME_ROOT` can point to another Gateway
checkout, and `LINGORA_NODE_BINARY` can select a specific Node executable.

The runtime staging step also copies the platform's Node executable into the
bundle (`runtime/node` or `runtime/node.exe`). A release build therefore does
not require Node to be preinstalled on the target machine; each platform's
build pipeline must stage its own native Node binary.
