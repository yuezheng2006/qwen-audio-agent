import { readdir } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MODULE_EXTENSIONS = new Set(['.js', '.mjs'])

function cleanDirectory(value) {
  return String(value || '').trim()
}

function modulePlugin(module, source) {
  const candidate = module?.default || module?.plugin
  if (candidate && typeof candidate === 'object') return candidate
  if (module?.manifest && typeof module.activate === 'function') {
    return {
      manifest: module.manifest,
      activate: module.activate,
      ...(typeof module.deactivate === 'function'
        ? { deactivate: module.deactivate }
        : {}),
    }
  }
  throw new Error(`插件模块 ${source} 必须默认导出插件对象，或导出 manifest + activate`)
}

/**
 * Load first-party or user-installed plugin modules from explicit directories.
 * Only direct .js/.mjs children are loaded; nested packages need an explicit
 * directory entry. This keeps discovery predictable and avoids executing
 * arbitrary files hidden in a plugin tree.
 */
export async function loadPluginsFromDirectories(
  directories = [],
  {
    importImpl = specifier => import(specifier),
    readdirImpl = readdir,
  } = {},
) {
  const loaded = []
  const failures = []
  const seen = new Set()
  const dirs = [...new Set(
    (Array.isArray(directories) ? directories : [directories])
      .map(cleanDirectory)
      .filter(Boolean)
      .map(directory => resolve(directory)),
  )]

  for (const directory of dirs) {
    let entries
    try {
      entries = await readdirImpl(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      failures.push({ source: directory, error: String(error?.message || error) })
      continue
    }
    const files = entries
      .filter(entry => entry.isFile() && MODULE_EXTENSIONS.has(extname(entry.name)))
      .map(entry => entry.name)
      .sort()

    for (const filename of files) {
      const source = resolve(directory, filename)
      if (seen.has(source)) continue
      seen.add(source)
      try {
        const module = await importImpl(pathToFileURL(source).href)
        loaded.push({ source, plugin: modulePlugin(module, source) })
      } catch (error) {
        failures.push({ source, error: String(error?.message || error) })
      }
    }
  }
  return { loaded, failures }
}

export async function registerPluginsFromDirectories(
  host,
  directories,
  options = {},
) {
  const result = await loadPluginsFromDirectories(directories, options)
  for (const { plugin, source } of result.loaded) {
    try {
      host.register(plugin)
    } catch (error) {
      result.failures.push({ source, error: String(error?.message || error) })
    }
  }
  host.setLoadFailures?.(result.failures)
  return result
}
