import { createRecorder } from "../src"
import type {
  AudioFrame,
  RecorderOpenOptions,
  RecorderRuntimeInfo,
  RecorderSessionSummary,
  RecorderWarning,
} from "../src"
import { RecorderInputSource, RecorderState, RecorderWarningCode } from "../src"

const PlaygroundSourceModeValue = {
  Microphone: RecorderInputSource.Microphone,
  ExternalTone: "external-tone",
} as const

type SourceMode =
  (typeof PlaygroundSourceModeValue)[keyof typeof PlaygroundSourceModeValue]
type LogType = "info" | "warning" | "error"

type PlaygroundState = {
  sourceMode: SourceMode
  recorderState: RecorderState
  runtimeInfo: RecorderRuntimeInfo | null
  summary: RecorderSessionSummary | null
  frameCount: number
  lastFrameDurationMs: number
  levelPercent: number
  warnings: RecorderWarning[]
  logs: Array<{
    type: LogType
    time: string
    message: string
  }>
}

const state: PlaygroundState = {
  sourceMode: PlaygroundSourceModeValue.Microphone,
  recorderState: RecorderState.Idle,
  runtimeInfo: null,
  summary: null,
  frameCount: 0,
  lastFrameDurationMs: 0,
  levelPercent: 0,
  warnings: [],
  logs: [],
}

const recorder = createRecorder()
let currentSource: ManagedSource | null = null

const app = document.querySelector<HTMLDivElement>("#app")

if (!app) {
  throw new Error("Playground root element was not found.")
}

app.innerHTML = `
  <main class="page">
    <section class="hero">
      <p class="eyebrow">示例工作台</p>
      <h1>录音器手工调试页</h1>
      <p class="lede">
        这是当前 TypeScript 库的中文示例页，用于手工验证录音主链路。
        它会参考 upstream Recorder 的能力边界，但交互方式围绕当前模块化 API
        重新设计，不直接照搬原始 demo。
      </p>
      <div class="hero-meta">
        <span class="meta-pill">麦克风与外部流输入</span>
        <span class="meta-pill">状态与告警观察</span>
        <span class="meta-pill">未来库示例页基线</span>
      </div>
      <p class="supporting">
        <a class="top-link" href="/">返回根页诊断面板</a>
      </p>
    </section>

    <section class="grid">
      <div class="stack">
        <section class="panel">
          <h2>控制区</h2>
          <div class="control-row">
            <label>
              <div class="stat-label">输入来源</div>
              <select id="source-mode">
                <option value="microphone">麦克风</option>
                <option value="external-tone">外部音调流</option>
              </select>
            </label>
            <label>
              <div class="stat-label">期望声道</div>
              <select id="channel-count">
                <option value="1">单声道</option>
                <option value="2">双声道</option>
              </select>
            </label>
          </div>
          <div class="control-grid">
            <button id="open-button">打开</button>
            <button id="start-button">开始</button>
            <button id="pause-button">暂停</button>
            <button id="resume-button">恢复</button>
            <button id="stop-button">停止</button>
            <button id="close-button">关闭</button>
          </div>
        </section>

        <section class="panel">
          <h2>实时状态</h2>
          <div class="stats-grid">
            <article class="stat">
              <p class="stat-label">录音器状态</p>
              <p class="stat-value" id="state-value">${RecorderState.Idle}</p>
            </article>
            <article class="stat">
              <p class="stat-label">已接收帧数</p>
              <p class="stat-value" id="frame-count-value">0</p>
            </article>
            <article class="stat">
              <p class="stat-label">实际采样率</p>
              <p class="stat-value" id="sample-rate-value">-</p>
            </article>
            <article class="stat">
              <p class="stat-label">实际声道</p>
              <p class="stat-value" id="channels-value">-</p>
            </article>
          </div>
          <div style="margin-top: 16px">
            <p class="stat-label">实时电平估算</p>
            <div class="meter-shell">
              <div class="meter-fill" id="meter-fill"></div>
            </div>
          </div>
        </section>

        <section class="panel">
          <h2>运行时快照</h2>
          <pre class="json" id="runtime-json">{}</pre>
        </section>
      </div>

      <div class="stack">
        <section class="panel">
          <h2>会话摘要</h2>
          <pre class="json" id="summary-json">{}</pre>
        </section>

        <section class="panel">
          <h2>事件日志</h2>
          <ul class="log-list" id="log-list"></ul>
        </section>

        <section class="panel">
          <h2>说明</h2>
          <ul class="hint-list">
            <li>当前 Phase 1 只提供 PCM 帧与生命周期事件，还没有编码导出能力。</li>
            <li>如果不想反复触发麦克风权限弹窗，可先用“外部音调流”做确定性手工测试。</li>
            <li>upstream Recorder 已放在 <code>vendor/Recorder-master</code>，后续能力实现会持续和它做行为对照。</li>
          </ul>
        </section>
      </div>
    </section>
  </main>
`

const sourceModeSelect = queryElement<HTMLSelectElement>("#source-mode")
const channelCountSelect = queryElement<HTMLSelectElement>("#channel-count")
const openButton = queryElement<HTMLButtonElement>("#open-button")
const startButton = queryElement<HTMLButtonElement>("#start-button")
const pauseButton = queryElement<HTMLButtonElement>("#pause-button")
const resumeButton = queryElement<HTMLButtonElement>("#resume-button")
const stopButton = queryElement<HTMLButtonElement>("#stop-button")
const closeButton = queryElement<HTMLButtonElement>("#close-button")
const stateValue = queryElement<HTMLParagraphElement>("#state-value")
const frameCountValue = queryElement<HTMLParagraphElement>("#frame-count-value")
const sampleRateValue = queryElement<HTMLParagraphElement>("#sample-rate-value")
const channelsValue = queryElement<HTMLParagraphElement>("#channels-value")
const meterFill = queryElement<HTMLDivElement>("#meter-fill")
const runtimeJson = queryElement<HTMLPreElement>("#runtime-json")
const summaryJson = queryElement<HTMLPreElement>("#summary-json")
const logList = queryElement<HTMLUListElement>("#log-list")

sourceModeSelect.addEventListener("change", () => {
  state.sourceMode = asSourceMode(sourceModeSelect.value)
  appendLog(
    "info",
    `输入来源已切换为：${getSourceModeLabel(state.sourceMode)}。`
  )
  render()
})

openButton.addEventListener("click", async () => {
  try {
    await closeManagedSource()
    currentSource = await createManagedSource(state.sourceMode)

    const recorderOpenOptions: RecorderOpenOptions =
      currentSource.stream !== null
        ? {
            sourceStream: currentSource.stream,
            capture: {
              channelCount: readChannelCount(),
              sampleRate: currentSource.sampleRate,
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          }
        : {
            capture: {
              channelCount: readChannelCount(),
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          }

    const runtimeInfo = await recorder.open(recorderOpenOptions)
    state.runtimeInfo = runtimeInfo
    state.summary = null
    state.frameCount = 0
    state.lastFrameDurationMs = 0
    state.levelPercent = 0
    state.warnings = []
    appendLog(
      "info",
      `录音器已打开，输入来源：${getSourceModeLabel(state.sourceMode)}，请求声道数：${runtimeInfo.requestedChannelCount}。`
    )
    render()
  } catch (error) {
    appendLog("error", formatError(error))
    render()
  }
})

startButton.addEventListener("click", async () => {
  try {
    const runtimeInfo = await recorder.start()
    state.runtimeInfo = runtimeInfo
    appendLog("info", "录音已开始。")
    render()
  } catch (error) {
    appendLog("error", formatError(error))
    render()
  }
})

pauseButton.addEventListener("click", () => {
  try {
    recorder.pause()
    appendLog("info", "录音已暂停。")
    render()
  } catch (error) {
    appendLog("error", formatError(error))
    render()
  }
})

resumeButton.addEventListener("click", async () => {
  try {
    const runtimeInfo = await recorder.resume()
    state.runtimeInfo = runtimeInfo
    appendLog("info", "录音已恢复。")
    render()
  } catch (error) {
    appendLog("error", formatError(error))
    render()
  }
})

stopButton.addEventListener("click", async () => {
  try {
    const summary = await recorder.stop()
    state.summary = summary
    appendLog(
      "info",
      `录音已停止，共接收 ${summary.frames} 帧，累计时长 ${summary.durationMs.toFixed(1)}ms。`
    )
    render()
  } catch (error) {
    appendLog("error", formatError(error))
    render()
  }
})

closeButton.addEventListener("click", async () => {
  try {
    await recorder.close()
    await closeManagedSource()
    appendLog("info", "录音器已关闭，输入资源已释放。")
    render()
  } catch (error) {
    appendLog("error", formatError(error))
    render()
  }
})

recorder.on("statechange", ({ state: nextState }) => {
  state.recorderState = nextState
  render()
})

recorder.on("warning", ({ warning }) => {
  state.warnings = [...state.warnings, warning]
  appendLog(
    warning.code === RecorderWarningCode.ScriptProcessorFallback
      ? "info"
      : "warning",
    `${warning.code}: ${warning.message}`
  )
  render()
})

recorder.on("error", ({ error }) => {
  appendLog("error", error.message)
  render()
})

recorder.on("frame", ({ frame, runtimeInfo, summary }) => {
  handleFrame(frame, runtimeInfo, summary)
  render()
})

appendLog("info", "调试页已就绪，请先打开输入来源，再手工驱动录音生命周期。")
render()

function handleFrame(
  frame: AudioFrame,
  runtimeInfo: RecorderRuntimeInfo,
  summary: RecorderSessionSummary
): void {
  state.frameCount += 1
  state.lastFrameDurationMs = frame.durationMs
  state.runtimeInfo = runtimeInfo
  state.summary = summary
  state.levelPercent = measureLevel(frame)
}

function readChannelCount(): 1 | 2 {
  return channelCountSelect.value === "2" ? 2 : 1
}

function queryElement<TElement extends Element>(selector: string): TElement {
  const element = document.querySelector<TElement>(selector)
  if (!element) {
    throw new Error(`Required element was not found: ${selector}`)
  }

  return element
}

function appendLog(type: LogType, message: string): void {
  state.logs = [
    {
      type,
      time: new Date().toLocaleTimeString("zh-CN", {
        hour12: false,
      }),
      message,
    },
    ...state.logs,
  ].slice(0, 40)
}

function render(): void {
  stateValue.textContent = state.recorderState
  frameCountValue.textContent = String(state.frameCount)
  sampleRateValue.textContent =
    state.runtimeInfo?.actualSampleRate?.toString() ??
    state.runtimeInfo?.requestedSampleRate?.toString() ??
    "-"
  channelsValue.textContent =
    state.runtimeInfo?.actualChannelCount?.toString() ??
    state.runtimeInfo?.requestedChannelCount?.toString() ??
    "-"
  meterFill.style.width = `${state.levelPercent}%`

  runtimeJson.textContent = JSON.stringify(
    {
      runtimeInfo: state.runtimeInfo,
      warnings: state.warnings,
      lastFrameDurationMs: state.lastFrameDurationMs,
    },
    null,
    2
  )

  summaryJson.textContent = JSON.stringify(
    {
      summary: state.summary,
      state: state.recorderState,
      sourceMode: state.sourceMode,
    },
    null,
    2
  )

  logList.innerHTML = state.logs
    .map(
      (item) => `
        <li class="log-item">
          <span class="log-time">${escapeHtml(item.time)}</span>
          <span class="log-type ${item.type}">${escapeHtml(item.type)}</span>
          <p class="log-message">${escapeHtml(item.message)}</p>
        </li>
      `
    )
    .join("")

  sourceModeSelect.value = state.sourceMode

  const recorderState = state.recorderState
  openButton.disabled = !(
    recorderState === RecorderState.Idle ||
    recorderState === RecorderState.Closed
  )
  startButton.disabled = recorderState !== RecorderState.Ready
  pauseButton.disabled = recorderState !== RecorderState.Recording
  resumeButton.disabled = recorderState !== RecorderState.Paused
  stopButton.disabled = !(
    recorderState === RecorderState.Recording ||
    recorderState === RecorderState.Paused
  )
  closeButton.disabled = !(
    recorderState === RecorderState.Ready ||
    recorderState === RecorderState.Recording ||
    recorderState === RecorderState.Paused ||
    recorderState === RecorderState.Stopped
  )
}

function measureLevel(frame: AudioFrame): number {
  const channel = frame.planar[0]
  if (!channel || channel.length === 0) {
    return 0
  }

  let absoluteSum = 0
  for (let index = 0; index < channel.length; index += 1) {
    absoluteSum += Math.abs(channel[index] ?? 0)
  }

  const average = absoluteSum / channel.length
  return Math.max(0, Math.min(100, Math.round((average / 32767) * 180)))
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function asSourceMode(value: string): SourceMode {
  return value === PlaygroundSourceModeValue.ExternalTone
    ? PlaygroundSourceModeValue.ExternalTone
    : PlaygroundSourceModeValue.Microphone
}

function getSourceModeLabel(mode: SourceMode): string {
  return mode === PlaygroundSourceModeValue.ExternalTone
    ? "外部音调流"
    : "麦克风"
}

async function closeManagedSource(): Promise<void> {
  if (!currentSource) {
    return
  }

  await currentSource.dispose()
  currentSource = null
}

type ManagedSource = {
  stream: MediaStream | null
  sampleRate?: number
  dispose: () => Promise<void>
}

async function createManagedSource(mode: SourceMode): Promise<ManagedSource> {
  if (mode === PlaygroundSourceModeValue.Microphone) {
    return {
      stream: null,
      dispose: async () => {},
    }
  }

  const AudioContextCtor = globalThis.AudioContext
  if (!AudioContextCtor) {
    throw new Error("AudioContext is unavailable in this browser.")
  }

  const audioContext = new AudioContextCtor()
  const oscillator = audioContext.createOscillator()
  const gainNode = audioContext.createGain()
  const destination = audioContext.createMediaStreamDestination()

  gainNode.gain.value = 0.08
  oscillator.type = "triangle"
  oscillator.frequency.value = 196
  oscillator.connect(gainNode)
  gainNode.connect(destination)
  oscillator.start()
  await audioContext.resume()

  appendLog("info", "已创建外部音调流。")

  return {
    stream: destination.stream,
    sampleRate: audioContext.sampleRate,
    dispose: async () => {
      oscillator.stop()
      if (audioContext.state !== "closed") {
        await audioContext.close()
      }
      appendLog("info", "外部音调流已释放。")
    },
  }
}
