<script setup>
import { computed, onBeforeUnmount, reactive, ref } from "vue"
import StreamingPlayerDemo from "./StreamingPlayerDemo.vue"
import {
  createRecorder,
  listMicrophoneDevices,
  RecorderInputSource,
  RecorderState,
  RecorderWarningCode,
} from "@csnight/audio-recorder"
import { createLevelMeterPlugin } from "@csnight/audio-recorder/plugins/level-meter"
import { createIndexedDbPersistencePlugin } from "@csnight/audio-recorder/storage/indexeddb"
import { createOpfsPersistencePlugin } from "@csnight/audio-recorder/storage/opfs"
import { createStreamingExportPlugin } from "@csnight/audio-recorder/plugins/streaming-export"
import { createAsrExportPlugin } from "@csnight/audio-recorder/plugins/asr-export"
import {
  pcmExportEncoder,
  pcmStreamEncoder,
  wavExportEncoder,
  wavStreamEncoder,
} from "@csnight/audio-recorder/codecs/base"
import { mp3ExportEncoder } from "@csnight/audio-recorder/codecs/mp3"
import { g711ExportEncoder } from "@csnight/audio-recorder/codecs/g711"
import {
  oggExportEncoder,
  webmExportEncoder,
} from "@csnight/audio-recorder/codecs/opus"
import { flacExportEncoder } from "@csnight/audio-recorder/codecs/flac"
import { aacExportEncoder } from "@csnight/audio-recorder/codecs/aac"
import { amrExportEncoder } from "@csnight/audio-recorder/codecs/amr"
import {
  ac3ExportEncoder,
  eac3ExportEncoder,
} from "@csnight/audio-recorder/codecs/ac3"

const PLAYGROUND_SOURCE_MODE = {
  microphone: RecorderInputSource.Microphone,
  externalTone: "external-tone",
}

const PLAYGROUND_STORAGE_MODE = {
  memory: "memory",
  persistent: "persistent",
  auto: "auto",
}

const PLAYGROUND_PERSISTENCE_BACKEND = {
  indexeddb: "indexeddb",
  opfs: "opfs",
}

const PLAYGROUND_PERSISTENCE_CHUNK_BYTES = 256 * 1024

const PERSISTENCE_PLUGIN_FACTORIES = {
  [PLAYGROUND_PERSISTENCE_BACKEND.indexeddb]: createIndexedDbPersistencePlugin,
  [PLAYGROUND_PERSISTENCE_BACKEND.opfs]: createOpfsPersistencePlugin,
}

const state = reactive({
  sourceMode: PLAYGROUND_SOURCE_MODE.externalTone,
  storageMode: PLAYGROUND_STORAGE_MODE.memory,
  persistenceBackend: PLAYGROUND_PERSISTENCE_BACKEND.indexeddb,
  requestedChannelCount: 1,
  amrBandMode: "nb",
  ac3SampleRate: 48000,
  inputStrategy: "auto",
  memoryThresholdBytes: 256 * 1024,
  pendingActionLabel: "",
  recorderState: RecorderState.Idle,
  runtimeInfo: null,
  summary: null,
  frameCount: 0,
  lastFrameDurationMs: 0,
  levelPercent: 0,
  logs: [],
  storageDiagnostics: null,
  exportedBytes: null,
  realtimeChunkCount: 0,
  realtimeChunkBytes: 0,
  asrChunkCount: 0,
  asrChunkBytes: 0,
  activePersistenceBackend: null,
  lastExportResult: null,
  microphoneDevices: [],
  selectedDeviceId: "",
  diagnosticsRawView: false,
})

let recorder = createPlaygroundRecorder()
const recorderRef = ref(recorder)
let recorderDisposers = []
let currentSource = null

const runtimeJson = computed(() =>
  JSON.stringify(
    {
      runtimeInfo: state.runtimeInfo,
      lastFrameDurationMs: state.lastFrameDurationMs,
      activePersistenceBackend: state.activePersistenceBackend,
    },
    null,
    2
  )
)

const summaryJson = computed(() =>
  JSON.stringify(
    {
      summary: state.summary,
      state: state.recorderState,
      sourceMode: state.sourceMode,
      storageMode: state.storageMode,
      persistenceBackend: state.persistenceBackend,
      exportedBytes: state.exportedBytes,
    },
    null,
    2
  )
)

const storageJson = computed(() =>
  JSON.stringify(state.storageDiagnostics, null, 2)
)

function toKvRows(value, prefix = "") {
  if (value === null || value === undefined) return []
  if (typeof value !== "object") {
    return [{ label: prefix || "value", value: String(value) }]
  }
  return Object.entries(value).flatMap(([key, val]) => {
    const label = prefix ? `${prefix}.${key}` : key
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      return toKvRows(val, label)
    }
    return [
      {
        label,
        value: Array.isArray(val) ? JSON.stringify(val) : String(val),
      },
    ]
  })
}

const runtimeRows = computed(() =>
  toKvRows({
    runtimeInfo: state.runtimeInfo,
    lastFrameDurationMs: state.lastFrameDurationMs,
    activePersistenceBackend: state.activePersistenceBackend,
  })
)

const summaryRows = computed(() =>
  toKvRows({
    summary: state.summary,
    state: state.recorderState,
    sourceMode: state.sourceMode,
    storageMode: state.storageMode,
    persistenceBackend: state.persistenceBackend,
    exportedBytes: state.exportedBytes,
  })
)

const storageRows = computed(() => toKvRows(state.storageDiagnostics))

const hasExportResult = computed(() => state.lastExportResult !== null)

const topMetrics = computed(() => [
  {
    label: "Recorder",
    value: state.recorderState,
    detail: state.pendingActionLabel || "Ready for the next action.",
  },
  {
    label: "Runtime",
    value:
      state.runtimeInfo?.actualSampleRate ??
      state.runtimeInfo?.requestedSampleRate ??
      "-",
    detail: `${
      state.runtimeInfo?.actualChannelCount ??
      state.runtimeInfo?.requestedChannelCount ??
      "-"
    } ch · ${state.runtimeInfo?.inputStrategy ?? state.inputStrategy}`,
  },
  {
    label: "Stream",
    value: `${state.realtimeChunkCount} chunk`,
    detail: `${formatBytes(state.realtimeChunkBytes)} · ASR ${state.asrChunkCount}`,
  },
  {
    label: "Persistence",
    value:
      state.storageMode === PLAYGROUND_STORAGE_MODE.memory
        ? "Memory"
        : getPersistenceBackendLabel(
            state.activePersistenceBackend ?? state.persistenceBackend
          ),
    detail: `${formatBytes(state.storageDiagnostics?.bytes ?? 0)} stored · ${
      state.storageDiagnostics?.persistedEntries ?? 0
    } item(s)`,
  },
])

const topSnapshotGroups = computed(() => [
  {
    label: "Runtime",
    items: [
      { label: "Source", value: getSourceModeLabel(state.sourceMode) },
      { label: "State", value: state.recorderState },
      { label: "Frames", value: String(state.frameCount) },
      {
        label: "Last Frame",
        value:
          state.lastFrameDurationMs > 0
            ? `${state.lastFrameDurationMs} ms`
            : "-",
      },
    ],
  },
  {
    label: "Capture",
    items: [
      {
        label: "Sample Rate",
        value:
          state.runtimeInfo?.actualSampleRate ??
          state.runtimeInfo?.requestedSampleRate ??
          "-",
      },
      {
        label: "Channels",
        value:
          state.runtimeInfo?.actualChannelCount ??
          state.runtimeInfo?.requestedChannelCount ??
          "-",
      },
      {
        label: "Input",
        value: state.runtimeInfo?.inputStrategy ?? state.inputStrategy,
      },
      { label: "Level", value: `${state.levelPercent}%` },
    ],
  },
  {
    label: "Storage",
    items: [
      { label: "Mode", value: getStorageModeLabel(state.storageMode) },
      {
        label: "Backend",
        value:
          state.storageMode === PLAYGROUND_STORAGE_MODE.memory
            ? "Memory"
            : getPersistenceBackendLabel(
                state.activePersistenceBackend ?? state.persistenceBackend
              ),
      },
      {
        label: "Persisted",
        value: String(state.storageDiagnostics?.persistedEntries ?? 0),
      },
      {
        label: "Exported",
        value: formatBytes(state.exportedBytes ?? 0),
      },
    ],
  },
])

const exportStats = computed(() => {
  if (!state.lastExportResult) return []

  return [
    {
      label: "PCM",
      value: formatBytes(state.lastExportResult.pcm.data.byteLength),
    },
    {
      label: "WAV",
      value: formatBytes(state.lastExportResult.wav.arrayBuffer.byteLength),
    },
    {
      label: "Sample Rate",
      value: `${state.lastExportResult.wav.sampleRate} Hz`,
    },
    {
      label: "Channels / Bit Depth",
      value: `${state.lastExportResult.wav.channels}ch / ${state.lastExportResult.wav.bitRate}bit`,
    },
    {
      label: "FLAC",
      value: formatBytes(state.lastExportResult.flac.data.byteLength),
    },
    {
      label: "AAC",
      value: formatBytes(state.lastExportResult.aac.data.byteLength),
    },
    {
      label: "AC3",
      value: formatBytes(state.lastExportResult.ac3.data.byteLength),
    },
    {
      label: "E-AC3",
      value: formatBytes(state.lastExportResult.eac3.data.byteLength),
    },
  ]
})

const canOpen = computed(
  () =>
    state.pendingActionLabel === "" &&
    [RecorderState.Idle, RecorderState.Closed].includes(state.recorderState)
)

const canStart = computed(
  () =>
    state.pendingActionLabel === "" &&
    state.recorderState === RecorderState.Ready
)

const canPause = computed(
  () =>
    state.pendingActionLabel === "" &&
    state.recorderState === RecorderState.Recording
)

const canResume = computed(
  () =>
    state.pendingActionLabel === "" &&
    state.recorderState === RecorderState.Paused
)

const canStop = computed(
  () =>
    state.pendingActionLabel === "" &&
    [RecorderState.Recording, RecorderState.Paused].includes(
      state.recorderState
    )
)

const canClose = computed(
  () =>
    state.pendingActionLabel === "" &&
    [
      RecorderState.Ready,
      RecorderState.Recording,
      RecorderState.Paused,
      RecorderState.Stopped,
    ].includes(state.recorderState)
)

const canChangeStorageMode = computed(
  () =>
    state.pendingActionLabel === "" &&
    [RecorderState.Idle, RecorderState.Closed].includes(state.recorderState)
)

const storageHint = computed(() => {
  if (state.storageMode === PLAYGROUND_STORAGE_MODE.memory) {
    return "只使用内存缓冲，适合快速验证编码、事件和实时播放器链路。"
  }

  if (state.storageMode === PLAYGROUND_STORAGE_MODE.persistent) {
    return `录音开始后立即启用 ${getPersistenceBackendLabel(
      state.persistenceBackend
    )}，按 ${PLAYGROUND_PERSISTENCE_CHUNK_BYTES} byte 分块落盘。`
  }

  return `录音数据累计超过 ${state.memoryThresholdBytes} byte 后切换到 ${getPersistenceBackendLabel(
    state.persistenceBackend
  )}。`
})

appendLog("info", "独立 Vue playground 已就绪。")
void initializeRecorder()

async function runLoggedAction(action, successMessage, pendingActionLabel) {
  state.pendingActionLabel = pendingActionLabel ?? "处理中..."
  try {
    await action()
    if (successMessage) appendLog("info", successMessage)
  } catch (error) {
    appendLog("error", formatError(error))
  } finally {
    state.pendingActionLabel = ""
  }
}

function appendLog(type, message) {
  state.logs = [
    {
      type,
      time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      message,
    },
    ...state.logs,
  ].slice(0, 80)
}

function resetRealtimeState() {
  state.runtimeInfo = null
  state.summary = null
  state.frameCount = 0
  state.lastFrameDurationMs = 0
  state.levelPercent = 0
  state.exportedBytes = null
  state.realtimeChunkCount = 0
  state.realtimeChunkBytes = 0
  state.asrChunkCount = 0
  state.asrChunkBytes = 0
  state.activePersistenceBackend = null
  state.storageDiagnostics = null
  state.lastExportResult = null
}

async function initializeRecorder() {
  await recorder.use(createLevelMeterPlugin())
  await recorder.use(
    createStreamingExportPlugin({
      format: "wav",
      encoders: [wavStreamEncoder, pcmStreamEncoder],
      encoderOptions: { framesPerChunk: 4 },
      allowMainThreadFallback: true,
    })
  )
  await recorder.use(
    createAsrExportPlugin({
      format: "pcm",
      encoders: [pcmExportEncoder],
      sampleRate: 16000,
      chunkDurationMs: 40,
    })
  )

  recorderDisposers = bindRecorderEvents(recorder)
}

async function rebuildRecorder() {
  unbindRecorderEvents(recorderDisposers)
  recorder = createPlaygroundRecorder()
  recorderRef.value = recorder
  await initializeRecorder()
  state.recorderState = recorder.getState()
}

async function handleStorageModeChange() {
  if (!canChangeStorageMode.value) {
    appendLog("warning", "请先关闭当前录音器，再切换持久化后端。")
    return
  }

  resetRealtimeState()
  await rebuildRecorder()
  appendLog(
    "info",
    `已切换存储模式：${getStorageModeLabel(state.storageMode)}。`
  )
}

async function handleSourceModeChange() {
  if (state.sourceMode === PLAYGROUND_SOURCE_MODE.microphone) {
    await refreshMicrophoneDevices()
  }
}

async function refreshMicrophoneDevices() {
  try {
    const devices = await listMicrophoneDevices()
    state.microphoneDevices = devices
    if (
      state.selectedDeviceId !== "" &&
      !devices.some((device) => device.deviceId === state.selectedDeviceId)
    ) {
      state.selectedDeviceId = ""
    }
    appendLog("info", `已枚举到 ${devices.length} 个麦克风设备。`)
  } catch (error) {
    appendLog("error", formatError(error))
  }
}

async function openRecorder() {
  await runLoggedAction(
    async () => {
      await rebuildRecorder()
      await closeManagedSource(currentSource)
      currentSource = await createManagedSource(state.sourceMode)
      resetRealtimeState()
      state.storageDiagnostics = await collectStorageDiagnostics()

      const openOptions =
        currentSource.stream !== null
          ? {
              sourceStream: currentSource.stream,
              channelCount: state.requestedChannelCount,
              inputStrategy: state.inputStrategy,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              ...(currentSource.sampleRate !== undefined && {
                sampleRate: currentSource.sampleRate,
              }),
            }
          : {
              channelCount: state.requestedChannelCount,
              inputStrategy: state.inputStrategy,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              ...(state.selectedDeviceId !== "" && {
                deviceId: state.selectedDeviceId,
              }),
            }

      state.runtimeInfo = await recorder.open(openOptions)
      appendLog(
        "info",
        `录音器已打开，来源：${getSourceModeLabel(state.sourceMode)}。`
      )

      if (state.sourceMode === PLAYGROUND_SOURCE_MODE.microphone) {
        await refreshMicrophoneDevices()
      }
    },
    "",
    "正在打开录音器..."
  )
}

async function startRecorder() {
  await runLoggedAction(
    async () => {
      state.runtimeInfo = await recorder.start()
    },
    "录音已开始。",
    "正在开始录音..."
  )
}

async function pauseRecorder() {
  await runLoggedAction(
    () => {
      recorder.pause()
    },
    "录音已暂停。",
    "正在暂停录音..."
  )
}

async function resumeRecorder() {
  await runLoggedAction(
    async () => {
      state.runtimeInfo = await recorder.resume()
    },
    "录音已恢复。",
    "正在恢复录音..."
  )
}

async function stopRecorder() {
  await runLoggedAction(
    async () => {
      state.summary = await recorder.stop()
      const [
        pcmResult,
        wavResult,
        mp3Result,
        g711Result,
        opusOggResult,
        opusWebmResult,
        flacResult,
        aacResult,
        amrResult,
        ac3Result,
        eac3Result,
      ] = await Promise.all([
        recorder.exportEncoded("pcm"),
        recorder.exportEncoded("wav"),
        recorder.exportEncoded("mp3"),
        recorder.exportEncoded("g711"),
        recorder.exportEncoded("ogg"),
        recorder.exportEncoded("webm"),
        recorder.exportEncoded("flac"),
        recorder.exportEncoded("aac"),
        recorder.exportEncoded("amr", { bandMode: state.amrBandMode }),
        recorder.exportEncoded("ac3", { sampleRate: state.ac3SampleRate }),
        recorder.exportEncoded("eac3", { sampleRate: state.ac3SampleRate }),
      ])
      state.exportedBytes = pcmResult.data.byteLength
      state.lastExportResult = {
        pcm: pcmResult,
        wav: wavResult,
        mp3: mp3Result,
        g711: g711Result,
        opusOgg: opusOggResult,
        opusWebm: opusWebmResult,
        flac: flacResult,
        aac: aacResult,
        amr: amrResult,
        ac3: ac3Result,
        eac3: eac3Result,
      }
      state.storageDiagnostics = await collectStorageDiagnostics()
      state.activePersistenceBackend =
        state.storageDiagnostics?.persistedEntries > 0
          ? state.storageDiagnostics.backend
          : null
      appendLog(
        "info",
        `录音已停止，PCM ${pcmResult.data.byteLength} byte，WAV ${wavResult.arrayBuffer.byteLength} byte，实时导出 chunk ${state.realtimeChunkCount} 个。`
      )
    },
    "",
    "正在停止并导出..."
  )
}

async function closeRecorder() {
  await runLoggedAction(
    async () => {
      await recorder.close()
      await closeManagedSource(currentSource)
      currentSource = null
      state.storageDiagnostics = await collectStorageDiagnostics()
      state.activePersistenceBackend =
        state.storageDiagnostics?.persistedEntries > 0
          ? state.storageDiagnostics.backend
          : null
    },
    "录音器已关闭，输入资源已释放。",
    "正在关闭录音器..."
  )
}

function downloadPCM() {
  const result = state.lastExportResult?.pcm
  if (!result) return
  const blob = new Blob([result.data.buffer], {
    type: "application/octet-stream",
  })
  triggerDownload(
    blob,
    `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitRate}bit.pcm`
  )
}

function downloadWAV() {
  const result = state.lastExportResult?.wav
  if (!result) return
  triggerDownload(
    result.blob,
    `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitRate}bit.wav`
  )
}

function downloadMP3() {
  const result = state.lastExportResult?.mp3
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: "audio/mpeg" }),
    `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitrateKbps}kbps.mp3`
  )
}

function downloadG711() {
  const result = state.lastExportResult?.g711
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: "audio/basic" }),
    `recording_${result.sampleRate}hz_${result.variant}.g711`
  )
}

function downloadAAC() {
  const result = state.lastExportResult?.aac
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: result.mimeType }),
    `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitrate}bps.aac`
  )
}

function downloadAMR() {
  const result = state.lastExportResult?.amr
  if (!result) return
  const extension = result.bandMode === "wb" ? "awb" : "amr"
  triggerDownload(
    new Blob([result.data.buffer], { type: result.mimeType }),
    `recording_${result.sampleRate}hz_${result.bandMode}.${extension}`
  )
}

function downloadAC3() {
  const result = state.lastExportResult?.ac3
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: result.mimeType }),
    `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitrate}bps.${result.codec}`
  )
}

function downloadEAC3() {
  const result = state.lastExportResult?.eac3
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: result.mimeType }),
    `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitrate}bps.${result.codec}`
  )
}

function downloadOpusOgg() {
  const result = state.lastExportResult?.opusOgg
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: "audio/ogg; codecs=opus" }),
    `recording_${result.sampleRate}hz_${result.channels}ch.ogg`
  )
}

function downloadOpusWebm() {
  const result = state.lastExportResult?.opusWebm
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: "audio/webm; codecs=opus" }),
    `recording_${result.sampleRate}hz_${result.channels}ch.webm`
  )
}

function downloadFLAC() {
  const result = state.lastExportResult?.flac
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: "audio/flac" }),
    `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitsPerSample}bit.flac`
  )
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function bindRecorderEvents(targetRecorder) {
  const offStateChange = targetRecorder.on(
    "statechange",
    ({ state: nextState }) => {
      state.recorderState = nextState
    }
  )

  const offIssue = targetRecorder.on("issue", ({ issue }) => {
    if (issue.kind === "warning") {
      if (
        issue.warning.code === RecorderWarningCode.PersistencePluginUnavailable
      ) {
        state.activePersistenceBackend = null
      }
      appendLog(
        issue.warning.code === RecorderWarningCode.ScriptProcessorFallback
          ? "info"
          : "warning",
        `${issue.warning.code}: ${issue.warning.message}`
      )
      return
    }
    appendLog("error", issue.error.message)
  })

  const offStream = targetRecorder.on("plugin:stream", (event) => {
    console.log(event)
    state.realtimeChunkCount += 1
    state.realtimeChunkBytes += event.payload.chunk.byteLength
  })

  const offAsr = targetRecorder.on("plugin:asr:chunk", ({ payload }) => {
    state.asrChunkCount += 1
    state.asrChunkBytes += payload.chunk.byteLength
  })

  const offFrame = targetRecorder.on(
    "frame:async",
    ({ frame, runtimeInfo, summary }) => {
      state.frameCount += 1
      state.lastFrameDurationMs = frame.durationMs
      state.runtimeInfo = runtimeInfo
      state.summary = summary
    }
  )

  const offLevel = targetRecorder.on("plugin:level", ({ payload }) => {
    state.levelPercent = Math.max(
      0,
      Math.min(100, Math.round(payload.level.rms * 180))
    )
  })

  return [offStateChange, offIssue, offFrame, offLevel, offStream, offAsr]
}

function unbindRecorderEvents(disposers) {
  for (const dispose of disposers) dispose()
}

function createPlaygroundRecorder() {
  const persistencePluginFactory =
    PERSISTENCE_PLUGIN_FACTORIES[state.persistenceBackend]

  return createRecorder({
    storage: createPlaygroundStorageOptions(
      state.storageMode,
      state.memoryThresholdBytes,
      persistencePluginFactory
    ),
    encoders: [
      pcmExportEncoder,
      wavExportEncoder,
      mp3ExportEncoder,
      g711ExportEncoder,
      aacExportEncoder,
      amrExportEncoder,
      ac3ExportEncoder,
      eac3ExportEncoder,
      oggExportEncoder,
      webmExportEncoder,
      flacExportEncoder,
    ],
  })
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}

function getSourceModeLabel(mode) {
  return mode === PLAYGROUND_SOURCE_MODE.externalTone ? "外部音调流" : "麦克风"
}

function getStorageModeLabel(mode) {
  switch (mode) {
    case PLAYGROUND_STORAGE_MODE.persistent:
      return "持久化模式"
    case PLAYGROUND_STORAGE_MODE.auto:
      return "自动模式"
    default:
      return "纯内存"
  }
}

function getPersistenceBackendLabel(backend) {
  return backend === PLAYGROUND_PERSISTENCE_BACKEND.opfs ? "OPFS" : "IndexedDB"
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "-"
  if (bytes < 1024) return `${bytes} B`

  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function toStateClassName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
}

function getRecorderBadgeClass(value) {
  return `badge-state-${toStateClassName(value)}`
}

function createPlaygroundStorageOptions(
  storageMode,
  memoryThresholdBytes,
  persistencePluginFactory
) {
  if (storageMode === PLAYGROUND_STORAGE_MODE.memory) {
    return { mode: "memory" }
  }

  return {
    mode: storageMode,
    ...(storageMode === PLAYGROUND_STORAGE_MODE.auto && {
      memoryThresholdBytes,
    }),
    persistenceChunkBytes: PLAYGROUND_PERSISTENCE_CHUNK_BYTES,
    ...(persistencePluginFactory && {
      persistencePlugin: persistencePluginFactory(),
    }),
  }
}

async function closeManagedSource(source) {
  if (source) await source.dispose()
}

async function createManagedSource(mode) {
  if (mode === PLAYGROUND_SOURCE_MODE.microphone) {
    return { stream: null, dispose: async () => {} }
  }

  const AudioContextConstructor = globalThis.AudioContext
  if (!AudioContextConstructor) {
    throw new Error("AudioContext is unavailable in this browser.")
  }

  const audioContext = new AudioContextConstructor()
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

async function collectStorageDiagnostics() {
  if (state.storageMode === PLAYGROUND_STORAGE_MODE.memory) {
    return { backend: "memory", persistedEntries: 0, bytes: 0 }
  }

  switch (state.persistenceBackend) {
    case PLAYGROUND_PERSISTENCE_BACKEND.indexeddb:
      return inspectIndexedDbStorage()
    case PLAYGROUND_PERSISTENCE_BACKEND.opfs:
      return inspectOpfsStorage()
    default:
      return { backend: "memory", persistedEntries: 0, bytes: 0 }
  }
}

async function inspectIndexedDbStorage() {
  if (typeof indexedDB === "undefined") {
    return {
      backend: "indexeddb",
      supported: false,
      reason: "indexedDB is unavailable in this browser.",
    }
  }

  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("csnight-audio-recorder", 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("sessions")) {
        request.result.createObjectStore("sessions")
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to inspect IndexedDB storage."))
  })

  try {
    const entries = await new Promise((resolve, reject) => {
      const transaction = database.transaction("sessions", "readonly")
      const store = transaction.objectStore("sessions")
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result ?? [])
      request.onerror = () =>
        reject(
          request.error ?? new Error("Failed to read IndexedDB session data.")
        )
    })

    let bytes = 0
    for (const entry of entries) {
      if (entry instanceof ArrayBuffer) bytes += entry.byteLength
    }

    return {
      backend: "indexeddb",
      supported: true,
      persistedEntries: entries.length,
      bytes,
    }
  } finally {
    database.close()
  }
}

async function inspectOpfsStorage() {
  if (
    typeof navigator === "undefined" ||
    !("storage" in navigator) ||
    typeof navigator.storage?.getDirectory !== "function"
  ) {
    return {
      backend: "opfs",
      supported: false,
      reason: "navigator.storage.getDirectory is unavailable in this browser.",
    }
  }

  const root = await navigator.storage.getDirectory()
  let baseDirectory
  try {
    baseDirectory = await root.getDirectoryHandle("csnight-audio-recorder")
  } catch {
    return {
      backend: "opfs",
      supported: true,
      persistedEntries: 0,
      bytes: 0,
    }
  }

  let persistedEntries = 0
  let bytes = 0
  for await (const [, handle] of baseDirectory.entries()) {
    if (handle.kind !== "directory") continue
    for await (const [name, childHandle] of handle.entries()) {
      if (childHandle.kind !== "file" || !name.endsWith(".bin")) continue
      persistedEntries += 1
      try {
        const file = await childHandle.getFile()
        bytes += file.size
      } catch {
        continue
      }
    }
  }

  return {
    backend: "opfs",
    supported: true,
    persistedEntries,
    bytes,
  }
}

onBeforeUnmount(() => {
  unbindRecorderEvents(recorderDisposers)
  void recorder.destroy()
  void closeManagedSource(currentSource)
})
</script>

<template>
  <main class="page-shell">
    <section class="topbar">
      <div class="topbar-copy">
        <p class="eyebrow">Audio Recorder Lab</p>
        <div class="topbar-title-row">
          <h1>浏览器录音工作台</h1>
          <div class="status-badges">
            <span
              :class="[
                'badge',
                getRecorderBadgeClass(state.recorderState),
                state.pendingActionLabel ? 'badge-accent' : '',
              ]"
            >
              {{ state.pendingActionLabel || state.recorderState }}
            </span>
          </div>
        </div>
        <p class="lede">
          通过
          <code>dist</code>
          产物快速校验输入源、持久化、实时编码、播放器与导出链路。
        </p>
        <div class="hero-chip-row">
          <span class="mini-chip"
            >Source · {{ getSourceModeLabel(state.sourceMode) }}</span
          >
          <span class="mini-chip"
            >Storage · {{ getStorageModeLabel(state.storageMode) }}</span
          >
          <span class="mini-chip">
            Backend ·
            {{
              state.storageMode === PLAYGROUND_STORAGE_MODE.memory
                ? "Memory"
                : getPersistenceBackendLabel(state.persistenceBackend)
            }}
          </span>
        </div>
      </div>
      <div class="topbar-status" aria-label="状态与运行时快照">
        <div class="topbar-primary-strip">
          <article
            v-for="item in topMetrics"
            :key="item.label"
            class="top-status-tile"
          >
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </article>
        </div>
        <div class="topbar-secondary-strip">
          <section
            v-for="group in topSnapshotGroups"
            :key="group.label"
            class="top-inline-group"
          >
            <p class="top-inline-group-label">{{ group.label }}</p>
            <div class="top-inline-items">
              <span
                v-for="item in group.items"
                :key="`${group.label}-${item.label}`"
                class="top-inline-item"
              >
                <b>{{ item.label }}</b>
                <i>{{ item.value }}</i>
              </span>
            </div>
          </section>
        </div>
      </div>
    </section>

    <section class="workspace-grid">
      <div class="primary-column">
        <section class="panel panel-highlight control-stage">
          <div class="panel-head panel-head-spread">
            <div>
              <p class="panel-kicker">Control Stage</p>
              <h2>配置与操作</h2>
            </div>
            <p class="panel-note panel-note-compact">
              先完成输入源和存储策略，再执行 open / start / stop 流程。
            </p>
          </div>

          <div class="control-stage-grid">
            <div class="control-stack">
              <section class="control-block">
                <div class="subpanel-head">
                  <div>
                    <p class="panel-kicker">Input</p>
                    <h3>输入源</h3>
                  </div>
                </div>
                <div class="form-grid">
                  <label class="field">
                    <span>输入来源</span>
                    <select
                      v-model="state.sourceMode"
                      @change="handleSourceModeChange"
                    >
                      <option :value="PLAYGROUND_SOURCE_MODE.microphone">
                        麦克风
                      </option>
                      <option :value="PLAYGROUND_SOURCE_MODE.externalTone">
                        外部音调流
                      </option>
                    </select>
                  </label>

                  <label
                    v-if="
                      state.sourceMode === PLAYGROUND_SOURCE_MODE.microphone
                    "
                    class="field"
                  >
                    <span>麦克风设备</span>
                    <div class="inline-field">
                      <select v-model="state.selectedDeviceId">
                        <option value="">默认麦克风</option>
                        <option
                          v-for="device in state.microphoneDevices"
                          :key="device.deviceId"
                          :value="device.deviceId"
                        >
                          {{
                            device.label ||
                            `麦克风 ${device.deviceId.slice(0, 8)}…`
                          }}
                        </option>
                      </select>
                      <button
                        class="ghost-button"
                        @click="refreshMicrophoneDevices"
                      >
                        刷新
                      </button>
                    </div>
                  </label>
                </div>
              </section>

              <section class="control-block">
                <div class="subpanel-head">
                  <div>
                    <p class="panel-kicker">Capture</p>
                    <h3>采集参数</h3>
                  </div>
                </div>
                <div class="form-grid">
                  <label class="field">
                    <span>期望声道</span>
                    <select v-model.number="state.requestedChannelCount">
                      <option :value="1">单声道</option>
                      <option :value="2">双声道</option>
                    </select>
                  </label>

                  <label class="field">
                    <span>采集策略</span>
                    <select v-model="state.inputStrategy">
                      <option value="auto">自动</option>
                      <option value="media-recorder">MediaRecorder</option>
                      <option value="audio-worklet">AudioWorklet</option>
                      <option value="script-processor">ScriptProcessor</option>
                    </select>
                  </label>
                </div>
              </section>

              <section class="control-block">
                <div class="subpanel-head">
                  <div>
                    <p class="panel-kicker">Storage</p>
                    <h3>缓存与持久化</h3>
                  </div>
                </div>
                <div class="form-grid">
                  <label class="field">
                    <span>存储模式</span>
                    <select
                      v-model="state.storageMode"
                      :disabled="!canChangeStorageMode"
                      @change="handleStorageModeChange"
                    >
                      <option :value="PLAYGROUND_STORAGE_MODE.memory">
                        纯内存
                      </option>
                      <option :value="PLAYGROUND_STORAGE_MODE.persistent">
                        持久化
                      </option>
                      <option :value="PLAYGROUND_STORAGE_MODE.auto">
                        自动切换
                      </option>
                    </select>
                  </label>

                  <label class="field">
                    <span>持久化后端</span>
                    <select
                      v-model="state.persistenceBackend"
                      :disabled="
                        !canChangeStorageMode ||
                        state.storageMode === PLAYGROUND_STORAGE_MODE.memory
                      "
                      @change="handleStorageModeChange"
                    >
                      <option :value="PLAYGROUND_PERSISTENCE_BACKEND.indexeddb">
                        IndexedDB
                      </option>
                      <option :value="PLAYGROUND_PERSISTENCE_BACKEND.opfs">
                        OPFS
                      </option>
                    </select>
                  </label>

                  <label class="field field-span">
                    <span>自动溢写阈值</span>
                    <input
                      v-model.number="state.memoryThresholdBytes"
                      :disabled="
                        !canChangeStorageMode ||
                        state.storageMode !== PLAYGROUND_STORAGE_MODE.auto
                      "
                      min="1"
                      step="1"
                      type="number"
                    />
                  </label>
                </div>
                <p class="panel-note">{{ storageHint }}</p>
              </section>
            </div>

            <div class="operations-stack">
              <section class="operation-console">
                <div class="subpanel-head">
                  <div>
                    <p class="panel-kicker">Action Console</p>
                    <h3>录音流程</h3>
                  </div>
                  <span
                    :class="[
                      'badge',
                      getRecorderBadgeClass(state.recorderState),
                      state.pendingActionLabel ? 'badge-accent' : '',
                    ]"
                  >
                    {{ state.pendingActionLabel || state.recorderState }}
                  </span>
                </div>

                <div class="operation-summary-grid">
                  <article class="stat-card">
                    <span>Frames</span>
                    <strong>{{ state.frameCount }}</strong>
                  </article>
                  <article class="stat-card">
                    <span>Realtime</span>
                    <strong>{{ formatBytes(state.realtimeChunkBytes) }}</strong>
                  </article>
                  <article class="stat-card">
                    <span>ASR</span>
                    <strong>{{ formatBytes(state.asrChunkBytes) }}</strong>
                  </article>
                  <article class="stat-card">
                    <span>Export</span>
                    <strong>{{
                      hasExportResult
                        ? formatBytes(state.exportedBytes ?? 0)
                        : "Pending"
                    }}</strong>
                  </article>
                </div>

                <div class="meter-card">
                  <div class="player-meter-head">
                    <span>输入电平</span>
                    <span>{{ state.levelPercent }}%</span>
                  </div>
                  <div class="meter-shell">
                    <div
                      :style="{ width: `${state.levelPercent}%` }"
                      class="meter-fill"
                    ></div>
                  </div>
                </div>
                <div class="action-grid">
                  <button :disabled="!canOpen" @click="openRecorder">
                    打开
                  </button>
                  <button :disabled="!canStart" @click="startRecorder">
                    开始
                  </button>
                  <button :disabled="!canPause" @click="pauseRecorder">
                    暂停
                  </button>
                  <button :disabled="!canResume" @click="resumeRecorder">
                    恢复
                  </button>
                  <button :disabled="!canStop" @click="stopRecorder">
                    停止
                  </button>
                  <button :disabled="!canClose" @click="closeRecorder">
                    关闭
                  </button>
                </div>
              </section>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head panel-head-spread">
            <div>
              <p class="panel-kicker">Export</p>
              <h2>导出与下载</h2>
            </div>
            <label class="field field-inline-compact">
              <span>AMR 模式</span>
              <select v-model="state.amrBandMode">
                <option value="nb">NB</option>
                <option value="wb">WB</option>
              </select>
            </label>
            <label class="field field-inline-compact">
              <span>AC3 采样率</span>
              <select v-model.number="state.ac3SampleRate">
                <option :value="32000">32000</option>
                <option :value="44100">44100</option>
                <option :value="48000">48000</option>
              </select>
            </label>
          </div>

          <p class="panel-note">
            停止录音后自动生成完整导出快照，下载区仅展示最终产物。
          </p>

          <div class="download-grid">
            <button :disabled="!state.lastExportResult" @click="downloadPCM">
              PCM
            </button>
            <button :disabled="!state.lastExportResult" @click="downloadWAV">
              WAV
            </button>
            <button :disabled="!state.lastExportResult" @click="downloadMP3">
              MP3
            </button>
            <button :disabled="!state.lastExportResult" @click="downloadG711">
              G.711
            </button>
            <button :disabled="!state.lastExportResult" @click="downloadAAC">
              AAC
            </button>
            <button :disabled="!state.lastExportResult" @click="downloadAMR">
              AMR
            </button>
            <button :disabled="!state.lastExportResult" @click="downloadAC3">
              AC3
            </button>
            <button :disabled="!state.lastExportResult" @click="downloadEAC3">
              E-AC3
            </button>
            <button
              :disabled="!state.lastExportResult"
              @click="downloadOpusOgg"
            >
              Opus OGG
            </button>
            <button
              :disabled="!state.lastExportResult"
              @click="downloadOpusWebm"
            >
              Opus WebM
            </button>
            <button :disabled="!state.lastExportResult" @click="downloadFLAC">
              FLAC
            </button>
          </div>

          <div
            v-if="exportStats.length"
            class="stats-grid compact export-stats"
          >
            <article
              v-for="item in exportStats"
              :key="item.label"
              class="stat-card"
            >
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </article>
          </div>
          <div v-else class="empty-state">
            <strong>导出结果待生成</strong>
            <p>执行一次 stop() 后，这里会出现各编码格式的快照和下载入口。</p>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head panel-head-spread">
            <div>
              <p class="panel-kicker">Streaming Player</p>
              <h2>实时播放链路</h2>
            </div>
            <p class="panel-note panel-note-compact">
              复用录音实时流，验证播放器缓存、重播和状态同步。
            </p>
          </div>
          <div class="player-section-shell">
            <StreamingPlayerDemo :recorder="recorderRef" />
          </div>
        </section>
      </div>

      <aside class="side-column">
        <section class="panel">
          <div class="panel-head panel-head-spread">
            <div>
              <p class="panel-kicker">Diagnostics</p>
              <h2>深度诊断</h2>
            </div>
            <button
              class="ghost-button"
              @click="state.diagnosticsRawView = !state.diagnosticsRawView"
            >
              {{ state.diagnosticsRawView ? "结构化视图" : "原始 JSON" }}
            </button>
          </div>

          <div class="diagnostics-panel-body">
            <template v-if="state.diagnosticsRawView">
              <pre class="json">{{ runtimeJson }}</pre>
              <pre class="json">{{ summaryJson }}</pre>
              <pre class="json">{{ storageJson }}</pre>
            </template>

            <template v-else>
              <div class="diagnostics-stack">
                <section class="diagnostics-group">
                  <div class="diagnostics-group-head">
                    <p class="diagnostics-group-label">Summary</p>
                    <span>{{ summaryRows.length }} items</span>
                  </div>
                  <dl class="kv-grid">
                    <template v-for="row in summaryRows" :key="row.label">
                      <dt>{{ row.label }}</dt>
                      <dd>{{ row.value }}</dd>
                    </template>
                  </dl>
                </section>

                <section class="diagnostics-group">
                  <div class="diagnostics-group-head">
                    <p class="diagnostics-group-label">Storage</p>
                    <span>{{ storageRows.length }} items</span>
                  </div>
                  <dl v-if="storageRows.length" class="kv-grid">
                    <template v-for="row in storageRows" :key="row.label">
                      <dt>{{ row.label }}</dt>
                      <dd>{{ row.value }}</dd>
                    </template>
                  </dl>
                  <p v-else class="panel-note">尚无存储诊断数据。</p>
                </section>
              </div>
            </template>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head panel-head-spread">
            <div>
              <p class="panel-kicker">Logs</p>
              <h2>事件日志</h2>
            </div>
            <button class="ghost-button" @click="state.logs = []">清空</button>
          </div>
          <div class="log-panel-body">
            <ul class="log-list">
              <li
                v-for="item in state.logs"
                :key="`${item.time}-${item.message}`"
                class="log-item"
              >
                <div class="log-head">
                  <span class="log-time">{{ item.time }}</span>
                  <span :class="['log-type', item.type]">{{ item.type }}</span>
                </div>
                <p class="log-message">{{ item.message }}</p>
              </li>
              <li
                v-if="state.logs.length === 0"
                class="log-item log-item-empty"
              >
                <p class="log-message">
                  暂无日志，操作录音器后会在这里展示事件流。
                </p>
              </li>
            </ul>
          </div>
        </section>
      </aside>
    </section>
  </main>
</template>
