import { useEffect, useState } from 'react'

async function readHealth() {
  const response = await fetch('api/health', { cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`)
  return payload
}

function availabilityLabel(value) {
  return value ? 'AVAILABLE' : 'UNAVAILABLE'
}

export default function ModelCataloguePanel() {
  const [health, setHealth] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    setError('')
    try {
      setHealth(await readHealth())
    } catch (reason) {
      setError(reason?.message || '模型目录暂时不可用。')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const models = Array.isArray(health?.realtimeModelCatalog)
    ? health.realtimeModelCatalog
    : []
  const providers = Array.isArray(health?.realtimeProviders)
    ? health.realtimeProviders
    : []
  const capabilities = Array.isArray(health?.capabilities)
    ? health.capabilities
    : []

  return (
    <div className="voice-studio-body model-catalogue">
      <div className="catalogue-heading">
        <div>
          <span className="voice-gallery-kicker">MODEL CATALOGUE</span>
          <h2>模型目录</h2>
          <p>查看 Agent、Realtime 前台、语音引擎与插件能力。</p>
        </div>
        <button type="button" className="catalogue-refresh" disabled={refreshing} onClick={refresh}>
          {refreshing ? '刷新中…' : '刷新'}
        </button>
      </div>

      {error && <p className="settings-error">{error}</p>}

      <section className="catalogue-panel">
        <header className="catalogue-panel-header">
          <strong>Engine Compatibility Matrix</strong>
          <span className={health?.ok ? 'catalogue-status ready' : 'catalogue-status'}>
            {health?.ok ? '● READY' : '○ OFFLINE'}
          </span>
        </header>
        <div className="catalogue-matrix-head">
          <span>ENGINE</span><span>STATUS</span><span>MODEL</span><span>ROLE</span>
        </div>
        <div className="catalogue-engine-list">
          {providers.map(provider => (
            <article className="catalogue-engine-row" key={provider.key}>
              <div>
                <strong>{provider.label}</strong>
                <small>{provider.key}</small>
              </div>
              <span className={`catalogue-badge ${provider.configured ? 'available' : ''}`}>
                {availabilityLabel(provider.configured)}
              </span>
              <code>{provider.model || '—'}</code>
              <span className="catalogue-role">REALTIME</span>
            </article>
          ))}
          {!providers.length && <p className="catalogue-empty">暂无已注册的 Realtime 引擎。</p>}
        </div>
      </section>

      <section className="catalogue-panel">
        <header className="catalogue-panel-header">
          <strong>Realtime Model Catalogue</strong>
          <span>{models.length} models</span>
        </header>
        <div className="catalogue-model-grid">
          {models.map(model => (
            <article className="catalogue-model-card" key={model.id}>
              <div className="catalogue-model-icon">◈</div>
              <strong>{model.label || model.id}</strong>
              <code>{model.id}</code>
              <small>{model.family || 'audio realtime'}</small>
            </article>
          ))}
          {!models.length && <p className="catalogue-empty">当前前台未返回模型目录，仍可使用已配置的 Cascade 链路。</p>}
        </div>
      </section>

      <section className="catalogue-panel catalogue-capabilities">
        <header className="catalogue-panel-header">
          <strong>Gateway Capabilities</strong>
          <span>{capabilities.length} capabilities</span>
        </header>
        <div className="catalogue-capability-list">
          {capabilities.map(capability => <code key={capability}>{capability}</code>)}
        </div>
      </section>
    </div>
  )
}
