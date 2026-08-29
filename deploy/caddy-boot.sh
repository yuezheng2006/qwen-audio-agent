#!/bin/sh
set -eu
config=/etc/caddy/Caddyfile
if [ -z "${BASIC_AUTH_HASH:-}" ]; then
  echo "caddy: BASIC_AUTH_HASH is empty; operator login disabled (local/dev only)" >&2
  config=/etc/caddy/Caddyfile.insecure
fi
exec caddy run --config "$config" --adapter caddyfile
