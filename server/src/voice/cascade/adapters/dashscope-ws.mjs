import WebSocket from 'ws'
import { randomUUID } from 'crypto'

// Minimal client for the DashScope duplex WebSocket task protocol
// (wss://dashscope.aliyuncs.com/api-ws/v1/inference). One instance runs one
// task: run-task -> stream input -> finish-task -> task-finished.
export class DashScopeTask {
  constructor({
    url,
    apiKey,
    taskGroup,
    task,
    function: taskFunction,
    model,
    parameters = {},
    input = {},
    onResult,
    onBinary,
    onError,
    onFinished,
  }) {
    this.url = url
    this.apiKey = apiKey
    this.taskGroup = taskGroup
    this.task = task
    this.taskFunction = taskFunction
    this.model = model
    this.parameters = parameters
    this.input = input
    this.onResult = onResult
    this.onBinary = onBinary
    this.onError = onError
    this.onFinished = onFinished
    this.taskId = randomUUID()
    this.ws = null
    this.startedResolvers = []
    this.started = false
    this.finished = false
  }

  connect({ timeoutMs = 10000 } = {}) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      })
      this.ws = ws
      let settled = false
      const timer = setTimeout(() => {
        finish(new Error('DashScope 任务启动超时'))
        ws.terminate()
      }, timeoutMs)
      const finish = error => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      }
      ws.on('open', () => {
        ws.send(JSON.stringify({
          header: {
            action: 'run-task',
            task_id: this.taskId,
            streaming: 'duplex',
          },
          payload: {
            task_group: this.taskGroup,
            task: this.task,
            function: this.taskFunction,
            model: this.model,
            parameters: this.parameters,
            input: this.input,
          },
        }))
      })
      ws.on('message', (raw, isBinary) => {
        if (isBinary) {
          this.onBinary?.(raw)
          return
        }
        let event
        try {
          event = JSON.parse(raw.toString())
        } catch {
          return
        }
        const kind = event.header?.event
        if (kind === 'task-started') {
          this.started = true
          finish()
        } else if (kind === 'result-generated') {
          this.onResult?.(event.payload || {})
        } else if (kind === 'task-finished') {
          this.finished = true
          this.onFinished?.(event.payload || {})
          ws.close()
        } else if (kind === 'task-failed') {
          const error = new Error(
            event.header?.error_message || 'DashScope 任务失败',
          )
          error.code = event.header?.error_code
          finish(error)
          this.onError?.(error)
          ws.close()
        }
      })
      ws.on('error', error => {
        finish(error)
        this.onError?.(error)
      })
      ws.on('close', () => {
        finish(new Error('DashScope 连接已关闭'))
        if (!this.finished) {
          this.onError?.(new Error('DashScope 任务未完成即断开'))
        }
      })
    })
  }

  sendAudio(buffer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(buffer)
  }

  continueTask(input) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({
      header: {
        action: 'continue-task',
        task_id: this.taskId,
        streaming: 'duplex',
      },
      payload: { input },
    }))
  }

  finishTask() {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({
      header: {
        action: 'finish-task',
        task_id: this.taskId,
        streaming: 'duplex',
      },
      payload: { input: {} },
    }))
  }

  close() {
    this.finished = true
    this.ws?.close()
    this.ws = null
  }
}
