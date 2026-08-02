import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCapabilityRegistry } from '../src/capabilities/registry.mjs'
import { resolveCapabilityRegistry } from '../src/capabilities/resolve.mjs'
import { setActiveCapabilityRegistry } from '../src/capabilities/active.mjs'
import {
  getBuiltinTools,
  getRealtimeTools,
  buildFrontendInstructions,
} from '../src/voice/frontend-tools.mjs'
import { ToolCallHandler } from '../src/voice/tools/tool-call-handler.mjs'
import { createWebSearchTool } from '../src/capabilities/tools/web-search.mjs'
import { createWeatherTool } from '../src/capabilities/tools/weather.mjs'
import { loadSkillsFromDir } from '../src/capabilities/skills/load-skills.mjs'
import {
  isDangerousMcpTool,
  projectMcpTools,
} from '../src/capabilities/mcp/project-tools.mjs'
import { buildMcpProjectedTools } from '../src/capabilities/mcp/client-registry.mjs'

test('registry assembles realtime tools and dispatches handlers', async () => {
  const registry = createCapabilityRegistry()
  registry.registerTool({
    name: 'ping',
    definition: {
      type: 'function',
      function: {
        name: 'ping',
        description: 'ping',
        parameters: { type: 'object', properties: {} },
      },
    },
    handler: async () => ({ status: 'ok', pong: true }),
  })
  assert.equal(registry.listRealtimeTools().length, 1)
  assert.deepEqual(await registry.dispatch('ping', {}), {
    status: 'ok',
    pong: true,
  })
})

test('getRealtimeTools merges builtin and active registry tools', () => {
  const registry = createCapabilityRegistry()
  registry.registerTool(createWebSearchTool({
    fetchImpl: async () => ({
      ok: true,
      text: async () => '',
      json: async () => ({}),
    }),
  }))
  setActiveCapabilityRegistry(registry)
  try {
    const names = getRealtimeTools().map(tool => tool.function.name)
    assert.ok(getBuiltinTools().every(tool => (
      names.includes(tool.function.name)
    )))
    assert.ok(names.includes('web_search'))
  } finally {
    setActiveCapabilityRegistry(null)
  }
})

test('ToolCallHandler routes capability registry tools', async () => {
  const registry = createCapabilityRegistry()
  registry.registerTool({
    name: 'echo_cap',
    definition: {
      type: 'function',
      function: {
        name: 'echo_cap',
        description: 'echo',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
        },
      },
    },
    handler: async args => ({ status: 'ok', text: args.text }),
  })
  const outputs = []
  const handler = new ToolCallHandler({
    taskManager: { create() {}, list() { return [] }, get() { return null } },
    ownerId: 'o1',
    sessionId: 's1',
    transcripts: {},
    getFrontend: () => ({
      sendFunctionOutput: async (callId, output) => {
        outputs.push({ callId, output })
      },
    }),
    getTurnId: () => 't1',
    getTurnGeneration: () => 1,
    coordinator: {},
    capabilityRegistry: registry,
  })
  await handler.handle({
    call_id: 'c1',
    name: 'echo_cap',
    arguments: JSON.stringify({ text: 'hi' }),
  }, { turnId: 't1', turnGeneration: 1 })
  assert.equal(outputs[0].output.status, 'ok')
  assert.equal(outputs[0].output.text, 'hi')
})

test('web_search returns mocked hits', async () => {
  const tool = createWebSearchTool({
    fetchImpl: async url => {
      if (String(url).includes('html.duckduckgo.com')) {
        return {
          ok: true,
          text: async () => (
            '<a class="result__a" href="https://example.com/a">Alpha Title</a>'
            + '<a class="result__snippet">Alpha snippet about news</a>'
          ),
        }
      }
      return { ok: true, json: async () => ({}) }
    },
  })
  const result = await tool.handler({ query: 'latest news', limit: 3 })
  assert.equal(result.status, 'ok')
  assert.equal(result.count, 1)
  assert.equal(result.hits[0].title, 'Alpha Title')
})

test('weather summarizes Open-Meteo mock payload', async () => {
  const tool = createWeatherTool({
    fetchImpl: async url => {
      const href = String(url)
      if (href.includes('geocoding-api')) {
        return {
          ok: true,
          json: async () => ({
            results: [{
              name: '北京',
              country: '中国',
              admin1: '北京市',
              latitude: 39.9,
              longitude: 116.4,
              timezone: 'Asia/Shanghai',
            }],
          }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          current: {
            temperature_2m: 26.2,
            weather_code: 0,
            wind_speed_10m: 8.1,
          },
          daily: {
            time: ['2026-08-01'],
            weather_code: [0],
            temperature_2m_max: [30],
            temperature_2m_min: [22],
          },
        }),
      }
    },
  })
  const result = await tool.handler({ location: '北京' })
  assert.equal(result.status, 'ok')
  assert.match(result.summary, /晴/)
  assert.match(result.summary, /26/)
})

test('skills loader injects bounded prompt section', () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-skills-'))
  const skillDir = join(root, 'concise-voice')
  mkdirSync(skillDir)
  writeFileSync(join(skillDir, 'SKILL.md'), [
    '---',
    'name: concise-voice',
    'description: keep it short',
    'enabled: true',
    '---',
    '回答尽量短。',
  ].join('\n'))
  const skills = loadSkillsFromDir(root)
  assert.equal(skills.length, 1)
  const registry = createCapabilityRegistry().setSkills(skills)
  const prompt = registry.skillsPrompt({ maxChars: 500 })
  assert.match(prompt, /<skills>/)
  assert.match(prompt, /concise-voice/)
  setActiveCapabilityRegistry(registry)
  try {
    const instructions = buildFrontendInstructions({})
    assert.match(instructions, /concise-voice/)
  } finally {
    setActiveCapabilityRegistry(null)
  }
})

test('mcp projection filters dangerous tools and truncates results', async () => {
  assert.equal(isDangerousMcpTool('run_shell'), true)
  assert.equal(isDangerousMcpTool('get_weather'), false)
  const projected = projectMcpTools({
    serverName: 'demo',
    tools: [
      { name: 'run_shell', description: 'shell' },
      {
        name: 'lookup',
        description: 'safe lookup',
        inputSchema: {
          type: 'object',
          properties: { q: { type: 'string' } },
        },
      },
    ],
    callTool: async () => 'x'.repeat(5000),
  })
  assert.equal(projected.length, 1)
  assert.equal(projected[0].name, 'mcp__demo__lookup')
  const result = await projected[0].handler({ q: 'a' })
  assert.equal(result.status, 'ok')
  assert.ok(result.result.length <= 1200)
})

test('mcp client registry builds projected tools via fake transport', async () => {
  const { tools, health } = await buildMcpProjectedTools({
    servers: [{ name: 'fake', enabled: true }],
    connectServer: async () => ({
      listTools: async () => ([
        { name: 'safe_ping', description: 'ping' },
        { name: 'delete_file', description: 'dangerous' },
      ]),
      callTool: async () => 'pong',
    }),
  })
  assert.equal(tools.length, 1)
  assert.equal(health.toolCount, 1)
  assert.equal(health.servers[0].status, 'ok')
})

test('resolveCapabilityRegistry registers web_search and weather', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qwaudio-caps-'))
  const skillsDir = join(root, 'skills')
  mkdirSync(skillsDir)
  const registry = await resolveCapabilityRegistry({
    capabilitiesDir: root,
    skillsDir,
    mcpDir: join(root, 'mcp'),
    mcpServersJson: '',
  }, { enableMcp: false })
  assert.ok(registry.has('web_search'))
  assert.ok(registry.has('weather'))
  assert.ok(registry.health().toolCount >= 2)
})
