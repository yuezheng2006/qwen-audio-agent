import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

export function restartGateway({ root, mode = 'cascade' } = {}) {
  setImmediate(() => {
    const child = spawn(
      process.execPath,
      [resolve(root, 'scripts/start-gateway.mjs'), mode],
      {
        cwd: root,
        detached: true,
        stdio: 'ignore',
      },
    )
    child.unref()
  })
}
