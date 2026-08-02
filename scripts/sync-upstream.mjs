#!/usr/bin/env node
/**
 * Keep this working tree current with the official QwenAudio/qwen-audio-agent.
 *
 * Remotes (ensured by this script):
 *   upstream  → https://github.com/QwenAudio/qwen-audio-agent.git
 *   origin    → your fork
 *
 * Recommended workflow (rebase-first):
 *   1. Product work lives on a feature branch (e.g. fengge-cascade)
 *   2. Prefer committed WIP; dirty trees need --autostash
 *   3. npm run sync:upstream              # fetch + rebase onto upstream/main
 *   4. Resolve conflicts, npm test, continue
 *   5. If history was rewritten: git push --force-with-lease origin HEAD
 *
 * Usage:
 *   npm run sync:upstream                 # fetch + rebase (default)
 *   npm run sync:upstream -- --check      # status only
 *   npm run sync:upstream -- --merge      # merge instead of rebase
 *   npm run sync:upstream -- --ff-only    # merge, refuse non-ff
 *   npm run sync:upstream -- --autostash  # stash dirty tree around rebase/merge
 */

import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const UPSTREAM_URL = 'https://github.com/QwenAudio/qwen-audio-agent.git'
const UPSTREAM_REF = 'upstream/main'

function run(args, { allowFail = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.status !== 0 && !allowFail) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(detail || `git ${args.join(' ')} failed`)
  }
  return {
    status: result.status ?? 1,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  }
}

function parseArgs(argv) {
  return {
    check: argv.includes('--check'),
    merge: argv.includes('--merge'),
    ffOnly: argv.includes('--ff-only'),
    autostash: argv.includes('--autostash'),
    help: argv.includes('-h') || argv.includes('--help'),
  }
}

function ensureUpstreamRemote() {
  const remotes = run(['remote']).stdout.split('\n').filter(Boolean)
  if (!remotes.includes('upstream')) {
    run(['remote', 'add', 'upstream', UPSTREAM_URL])
    process.stdout.write(`已添加 remote upstream → ${UPSTREAM_URL}\n`)
    return
  }
  const url = run(['remote', 'get-url', 'upstream']).stdout
  if (url !== UPSTREAM_URL) {
    run(['remote', 'set-url', 'upstream', UPSTREAM_URL])
    process.stdout.write(`已校正 upstream URL → ${UPSTREAM_URL}\n`)
  }
}

function dirtyWorktree() {
  return Boolean(run(['status', '--porcelain']).stdout)
}

function currentBranch() {
  return run(['rev-parse', '--abbrev-ref', 'HEAD']).stdout
}

function describeSync() {
  const branch = currentBranch()
  const local = run(['rev-parse', 'HEAD']).stdout
  const upstream = run(['rev-parse', UPSTREAM_REF], { allowFail: true })
  if (upstream.status !== 0) {
    return { branch, local, upstream: null, ahead: null, behind: null }
  }
  const counts = run([
    'rev-list',
    '--left-right',
    '--count',
    `HEAD...${UPSTREAM_REF}`,
  ]).stdout.split(/\s+/)
  return {
    branch,
    local,
    upstream: upstream.stdout,
    ahead: Number(counts[0] || 0),
    behind: Number(counts[1] || 0),
  }
}

function usage() {
  process.stdout.write(`用法：
  npm run sync:upstream                 # fetch + rebase onto upstream/main（默认）
  npm run sync:upstream -- --check      # 只查看领先/落后
  npm run sync:upstream -- --merge      # 改用 merge
  npm run sync:upstream -- --ff-only    # merge，仅允许快进
  npm run sync:upstream -- --autostash  # 脏工作区自动 stash/pop

说明：
  - 官方仓库固定为 remote「upstream」
  - 本地 cascade / 峰哥定制请放在功能分支（如 fengge-cascade）
  - 默认可持续 rebase；rebase 改写历史后用 --force-with-lease 推 fork
  - 无 --autostash 时，脏工作区会中止同步
`)
}

function withOptionalAutostash(autostash, fn) {
  let stashed = false
  if (dirtyWorktree()) {
    if (!autostash) {
      throw new Error(
        '工作区有未提交改动。请先 commit，或加 --autostash：npm run sync:upstream -- --autostash',
      )
    }
    process.stdout.write('autostash: git stash push -u...\n')
    run(['stash', 'push', '-u', '-m', 'sync-upstream autostash'])
    stashed = true
  }
  try {
    fn()
  } finally {
    if (stashed) {
      process.stdout.write('autostash: git stash pop...\n')
      const pop = run(['stash', 'pop'], { allowFail: true })
      if (pop.status !== 0) {
        process.stderr.write(
          `stash pop 有冲突，请手动解决：\n${pop.stderr || pop.stdout}\n`,
        )
        process.exitCode = 1
      }
    }
  }
}

try {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    usage()
    process.exit(0)
  }

  ensureUpstreamRemote()
  process.stdout.write('fetch upstream...\n')
  run(['fetch', 'upstream', '--prune'])

  const info = describeSync()
  const mode = opts.merge || opts.ffOnly ? 'merge' : 'rebase'
  process.stdout.write(`${JSON.stringify({
    branch: info.branch,
    aheadOfUpstream: info.ahead,
    behindUpstream: info.behind,
    upstream: UPSTREAM_REF,
    dirty: dirtyWorktree(),
    mode,
  }, null, 2)}\n`)

  if (opts.check) {
    process.exitCode = info.behind > 0 ? 2 : 0
    process.exit()
  }

  if (info.behind === 0) {
    process.stdout.write('已与 upstream/main 同步，无需 rebase/merge。\n')
    if (info.ahead > 0) {
      process.stdout.write(
        `本地领先 upstream ${info.ahead} 个提交（功能分支正常）。\n`,
      )
    }
    process.exit(0)
  }

  const before = info.local

  withOptionalAutostash(opts.autostash, () => {
    if (mode === 'rebase') {
      process.stdout.write(`rebase onto ${UPSTREAM_REF}...\n`)
      run(['rebase', UPSTREAM_REF])
    } else {
      const mergeArgs = ['merge', UPSTREAM_REF, '-m', `sync: merge ${UPSTREAM_REF}`]
      if (opts.ffOnly) mergeArgs.splice(1, 0, '--ff-only')
      process.stdout.write(`merge ${UPSTREAM_REF}...\n`)
      run(mergeArgs)
    }
  })

  const after = describeSync()
  process.stdout.write(`同步完成。
  branch:  ${after.branch}
  mode:    ${mode}
  behind:  ${after.behind}
  ahead:   ${after.ahead}
建议：npm test && npm run gateway:status
`)

  if (mode === 'rebase' && before !== after.local && after.ahead > 0) {
    process.stdout.write(
      '注意：rebase 已改写本地历史。推 fork 请用：\n  git push --force-with-lease origin HEAD\n',
    )
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
