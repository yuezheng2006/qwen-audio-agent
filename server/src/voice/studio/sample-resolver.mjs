import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, resolve as resolvePath } from 'node:path'
import { tmpdir } from 'node:os'

function resolverError(errorCode, userMessage) {
  const error = new Error(userMessage)
  error.normalized = { error_code: errorCode, user_message: userMessage, retryable: false }
  return error
}

function within(file, root) {
  const relative = file.slice(root.length)
  return file === root || (file.startsWith(`${root}/`) && !relative.includes('/../'))
}

function dataUri(file) {
  const extension = extname(file).toLowerCase()
  const mime = extension === '.mp3'
    ? 'audio/mpeg'
    : extension === '.m4a'
      ? 'audio/mp4'
      : 'audio/wav'
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`
}

export function createSampleResolver({
  catalog,
  presetsDir,
  tmpRoot = tmpdir(),
} = {}) {
  if (!catalog) throw new Error('preset catalog is required')
  const allowedRoots = [presetsDir, tmpRoot]
    .filter(Boolean)
    .map(item => resolvePath(String(item)))

  function resolveLocal(inputPath) {
    const raw = String(inputPath || '').trim()
    if (!raw) throw resolverError('sample_missing', '未找到音频样本，请提供 preset_id、sample_url 或 sample_path。')
    const file = resolvePath(isAbsolute(raw) ? raw : resolvePath(String(presetsDir || ''), raw))
    if (!allowedRoots.some(root => within(file, root))) {
      throw resolverError('sample_missing', '音频样本路径不在允许的预设或临时目录内。')
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      throw resolverError('sample_missing', '音频样本文件不存在。')
    }
    let realFile
    let realRoots
    try {
      realFile = realpathSync(file)
      realRoots = allowedRoots.map(root => realpathSync(root))
    } catch {
      throw resolverError('sample_missing', '音频样本文件无法读取。')
    }
    if (!realRoots.some(root => within(realFile, root))) {
      throw resolverError('sample_missing', '音频样本路径不在允许的预设或临时目录内。')
    }
    return { kind: 'file', path: realFile }
  }

  return {
    resolve({ preset_id, sample_url, sample_path, sample_data_url } = {}, capabilities = {}) {
      if (sample_data_url) {
        const value = String(sample_data_url).trim()
        if (!/^data:audio\/(wav|webm|mp4|mpeg|ogg);base64,[A-Za-z0-9+/=]+$/i.test(value)) {
          throw resolverError('sample_invalid', 'sample_data_url 必须是 base64 音频数据。')
        }
        if (value.length > 7 * 1024 * 1024) {
          throw resolverError('sample_too_large', '录音样本不能超过 5 MB。')
        }
        return { kind: 'url', url: value }
      }
      if (sample_url) {
        let url
        try {
          url = new URL(String(sample_url))
        } catch {
          throw resolverError('sample_missing', 'sample_url 必须是有效的 http(s) 地址。')
        }
        if (!['http:', 'https:'].includes(url.protocol)) {
          throw resolverError('sample_missing', 'sample_url 必须是有效的 http(s) 地址。')
        }
        return { kind: 'url', url: url.toString() }
      }

      const sample = preset_id
        ? resolveLocal(catalog.resolveSamplePath(preset_id) || '')
        : resolveLocal(sample_path)
      if (capabilities.needsPublicUrl && sample.kind === 'file') {
        return { kind: 'url', url: dataUri(sample.path), sourcePath: sample.path }
      }
      return sample
    },
  }
}
