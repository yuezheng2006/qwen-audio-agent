# Lingora Desktop

Rust/Tauri client shell for Lingora.

The client is intentionally a separate host from the Agent runtime:

- React is the replaceable workbench UI.
- Rust owns windows, native permissions, lifecycle, notifications, and platform adapters.
- The Agent/Gateway remains the shared local-first runtime and is reached through the published gateway protocol.
- Electron remains the compatibility client until this host reaches feature parity.

## Development

From the repository root:

```bash
cargo tauri dev --directory clients/lingora-desktop
```

The first slice only establishes the Tauri host and exposes a `client_info` command. Gateway lifecycle and native audio are deliberately migrated behind separate Rust seams.
