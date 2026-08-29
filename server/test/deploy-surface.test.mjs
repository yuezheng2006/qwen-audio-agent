import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function read(relative) {
  return readFileSync(resolve(root, relative), 'utf8')
}

test('docker self-host keeps 3101 private and splits support from operator auth', () => {
  assert.ok(existsSync(resolve(root, 'deploy/Caddyfile.insecure')))
  assert.ok(existsSync(resolve(root, 'deploy/caddy-boot.sh')))

  const compose = read('deploy/docker-compose.yml')
  assert.doesNotMatch(compose, /3101:3101/)
  assert.match(compose, /condition: service_healthy/)
  assert.match(compose, /caddy-boot\.sh/)
  assert.match(compose, /required: false/)

  const caddy = read('deploy/Caddyfile')
  assert.match(caddy, /query workspace=support/)
  assert.match(caddy, /path \/support/)
  assert.match(caddy, /header_up Host \{host\}/)
  assert.match(caddy, /flush_interval -1/)
  assert.match(caddy, /basic_auth/)

  const boot = read('deploy/caddy-boot.sh')
  assert.match(boot, /Caddyfile\.insecure/)
  assert.match(boot, /BASIC_AUTH_HASH/)

  const dockerignore = read('.dockerignore')
  assert.match(dockerignore, /!desktop\/package\.json/)
  assert.match(dockerignore, /desktop\/\*\*/)

  const dockerfile = read('deploy/Dockerfile')
  assert.match(dockerfile, /npm prune --omit=dev/)
  assert.match(dockerfile, /\/livez/)
})
