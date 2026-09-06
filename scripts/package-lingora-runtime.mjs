/**
 * Stage the JavaScript Gateway runtime used by the Lingora Tauri bundle.
 *
 * The staged directory is ignored by git and is intentionally rebuilt by a
 * release build. Keeping this step explicit prevents the Rust host from
 * silently depending on the repository's development node_modules.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(root, 'clients/lingora-desktop/runtime')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const runtimePackage = {
  name: '@lingora/local-runtime',
  private: true,
  version: manifest.version,
  type: 'module',
  dependencies: manifest.dependencies || {},
}

mkdirSync(target, { recursive: true })

for (const directory of ['scripts', 'server', 'shared', 'config']) {
  rmSync(join(target, directory), { recursive: true, force: true })
  cpSync(join(root, directory), join(target, directory), {
    recursive: true,
    force: true,
    filter: source => !source.includes(`${join(directory, '.run')}`),
  })
}

writeFileSync(join(target, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`)

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const install = spawnSync(npm, [
  'install',
  '--omit=dev',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  '--package-lock=false',
], {
  cwd: target,
  stdio: 'inherit',
})

if (install.error) throw install.error
if (install.status !== 0) {
  process.exitCode = install.status || 1
  process.stderr.write('Lingora runtime dependency staging failed.\n')
  process.exit()
}

if (!existsSync(join(target, 'node_modules'))) {
  throw new Error('Lingora runtime dependency staging produced no node_modules directory.')
}

process.stdout.write(`Lingora runtime staged at ${target}\n`)
