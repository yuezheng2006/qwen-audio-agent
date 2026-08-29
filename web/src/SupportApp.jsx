import { useEffect, useMemo, useState } from 'react'
import useRealtimeVoice from './useRealtimeVoice.js'
import { requestedSessionId } from './session.js'
import {
  SUPPORT_DEMO_EXAMPLES,
  mergeSupportLine,
  supportConnectContext,
  supportLineFromEvent,
} from './support-workspace.js'
import { apiUrl } from './app-paths.js'

async function readJson(response) {
  const resolved = await response
  const payload = await resolved.json().catch(() => ({}))
  if (!resolved.ok) {
    throw new Error(payload.error || `请求失败（${resolved.status}）`)
  }
  return payload
}

function lineLabel(role) {
  if (role === 'user') return '你'
  if (role === 'assistant') return '客服'
  return '系统'
}

export default function SupportApp() {
  const token = new URLSearchParams(window.location.search).get('token') || ''
  const requestedId = requestedSessionId(window.location.search)
  const [gate, setGate] = useState({ status: 'checking', error: '', visitorId: '' })
  const [enabled, setEnabled] = useState(false)
  const [lines, setLines] = useState([])
  const [escalateNote, setEscalateNote] = useState('')
  const [escalateHint, setEscalateHint] = useState('')
  const connectExtras = useMemo(() => supportConnectContext(token), [token])
  const sessionId = requestedId || gate.visitorId || 'support'

  useEffect(() => {
    let cancelled = false
    readJson(fetch(apiUrl(`support/session?token=${encodeURIComponent(token)}`)))
      .then(payload => {
        if (!cancelled) setGate({ status: 'ok', error: '', visitorId: payload.visitorId })
      })
      .catch(error => {
        if (!cancelled) setGate({ status: 'denied', error: error.message, visitorId: '' })
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const voice = useRealtimeVoice({
    sessionId,
    enabled: enabled && gate.status === 'ok',
    suspended: gate.status !== 'ok',
    outputAlways: true,
    clientType: 'web',
    clientLabel: 'Support',
    connectExtras,
    onEvent: event => {
      const line = supportLineFromEvent(event)
      if (line) setLines(current => mergeSupportLine(current, line))
    },
  })

  useEffect(() => {
    if (gate.status === 'ok') voice.activateAudio()
  }, [gate.status, voice.activateAudio])

  const ask = (text) => {
    const value = String(text || '').trim()
    if (!value) return
    voice.activateAudio()
    if (!voice.sendText(value)) {
      setLines(current => [...current, { role: 'system', text: '还没接通，请等一秒再点示例。' }])
    }
  }

  const escalate = async () => {
    const objective = escalateNote.trim() || lines.slice(-3).map(item => item.text).join(' / ')
    if (!objective) {
      setEscalateHint('先写订单号或点一条示例，再升级。')
      return
    }
    await readJson(await fetch(apiUrl('support/escalate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, sessionId, objective }),
    }))
    setEscalateNote('')
    setEscalateHint('')
    setLines(current => [...current, { role: 'system', text: '已升级为后台待办，标题带「客服升级」。' }])
  }

  return (
    <div className="app support-app">
      <header className="topbar">
        <div className="brand">
          客服进线
          <small>演示 FAQ · 不是电话客服</small>
        </div>
      </header>
      {gate.status !== 'ok' && (
        <p className="settings-error">{gate.error || '正在校验进线令牌…'}</p>
      )}
      {gate.status === 'ok' && (
        <section className="workspace">
          <p className="support-lead">
            这是网页进线演示。先点下面的示例提问（不用开麦），或点紫色球对着说。
            知识库只覆盖营业时间、朗读入口、演示退款。别的问题应说不知道，并可升级人工。
          </p>
          <div className="hero">
            <button
              className={`orb ${voice.visualState || voice.state}`}
              onClick={() => setEnabled(current => !current)}
              aria-label="客服语音"
            >
              <span />
            </button>
            <p>{enabled ? '点击结束开麦' : '可选：点击开麦说话'}</p>
            <small>
              {voice.error
                || (voice.connectionState === 'connected' ? '已接通，可点示例' : '正在接通…')}
            </small>
          </div>
          <div className="support-examples" aria-label="示例问题">
            {SUPPORT_DEMO_EXAMPLES.map(item => (
              <button
                key={item.id}
                type="button"
                className="support-chip"
                title={item.hint}
                onClick={() => ask(item.label)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <ul className="memory-list">
            {!lines.length && (
              <li>
                <div>
                  <b>提示</b>
                  <span>点「营业时间到几点？」试一条。答完再试退款或朗读。</span>
                </div>
              </li>
            )}
            {lines.slice(-12).map((item, index) => (
              <li key={`${item.role}-${index}`}>
                <div>
                  <b>{lineLabel(item.role)}</b>
                  <span>{item.text}</span>
                </div>
              </li>
            ))}
          </ul>
          <label className="voice-field">
            <span>升级人工（库里没有的订单/改系统）</span>
            <input
              value={escalateNote}
              onChange={event => setEscalateNote(event.target.value)}
              placeholder="例如：订单 DEMO-48 要退款"
            />
          </label>
          {escalateHint && <p className="hint">{escalateHint}</p>}
          <button className="ghost" type="button" onClick={escalate}>
            升级人工
          </button>
        </section>
      )}
    </div>
  )
}
