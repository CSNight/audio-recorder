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
import { createSonicExportPlugin } from "@csnight/audio-recorder/plugins/sonic-export"
import { createAsrExportPlugin } from "@csnight/audio-recorder/plugins/asr-export"
import {
  createHighpassPlugin,
  createLowpassPlugin,
  createNoiseGatePlugin,
} from "@csnight/audio-recorder/plugins/dsp"
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

const PLAYGROUND_LOCALE = {
  zh: "zh-CN",
  en: "en-US",
}

const LOCALE_OPTIONS = [
  {
    value: PLAYGROUND_LOCALE.zh,
    shortLabel: "中",
    label: "中文",
  },
  {
    value: PLAYGROUND_LOCALE.en,
    shortLabel: "EN",
    label: "English",
  },
]

const PLAYGROUND_PERSISTENCE_BACKEND = {
  indexeddb: "indexeddb",
  opfs: "opfs",
}

const PLAYGROUND_PERSISTENCE_CHUNK_BYTES = 256 * 1024
const PLAYGROUND_STREAM_PLUGIN_MODE = {
  streaming: "streaming-export",
  sonic: "sonic-export",
}
const PLAYGROUND_DSP_PLUGIN = {
  highpass: "highpass",
  lowpass: "lowpass",
  noiseGate: "noise-gate",
}

const STANDARD_EXPORT_SAMPLE_RATES = [
  7350, 8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000,
  88200, 96000, 176400, 192000,
]

const PERSISTENCE_PLUGIN_FACTORIES = {
  [PLAYGROUND_PERSISTENCE_BACKEND.indexeddb]: createIndexedDbPersistencePlugin,
  [PLAYGROUND_PERSISTENCE_BACKEND.opfs]: createOpfsPersistencePlugin,
}

const DSP_PLUGIN_OPTIONS = [
  {
    key: "enableHighpass",
    pluginName: PLAYGROUND_DSP_PLUGIN.highpass,
    label: {
      zh: "高通滤波",
      en: "High-pass Filter",
    },
    note: {
      zh: "削弱低频轰鸣与直流漂移，默认截止频率由插件内部给出。",
      en: "Reduces low-end rumble and DC drift with the plugin's default cutoff.",
    },
    createPlugin: () => createHighpassPlugin(),
  },
  {
    key: "enableLowpass",
    pluginName: PLAYGROUND_DSP_PLUGIN.lowpass,
    label: {
      zh: "低通滤波",
      en: "Low-pass Filter",
    },
    note: {
      zh: "削弱高频噪声，便于观察主链路导出与实时流的同步变化。",
      en: "Softens high-frequency noise so export and stream changes are easier to compare.",
    },
    createPlugin: () => createLowpassPlugin(),
  },
  {
    key: "enableNoiseGate",
    pluginName: PLAYGROUND_DSP_PLUGIN.noiseGate,
    label: {
      zh: "噪声门",
      en: "Noise Gate",
    },
    note: {
      zh: "低电平帧会被压低或静音，适合验证静音段的主链路处理。",
      en: "Pushes low-level frames down or to silence, useful for validating quiet segments.",
    },
    createPlugin: () => createNoiseGatePlugin(),
  },
]

const EXPORT_FORMAT_ACTIONS = [
  { type: "pcm", label: "PCM", encoder: pcmExportEncoder },
  { type: "wav", label: "WAV", encoder: wavExportEncoder },
  { type: "mp3", label: "MP3", encoder: mp3ExportEncoder },
  { type: "g711", label: "G.711", encoder: g711ExportEncoder },
  { type: "aac", label: "AAC", encoder: aacExportEncoder },
  {
    type: "amr-nb",
    exportFormat: "amr",
    bandMode: "nb",
    label: "AMR NB",
    encoder: amrExportEncoder,
  },
  {
    type: "amr-wb",
    exportFormat: "amr",
    bandMode: "wb",
    label: "AMR WB",
    encoder: amrExportEncoder,
  },
  { type: "ac3", label: "AC3", encoder: ac3ExportEncoder },
  { type: "eac3", label: "E-AC3", encoder: eac3ExportEncoder },
  { type: "ogg", label: "Opus OGG", encoder: oggExportEncoder },
  { type: "webm", label: "Opus WebM", encoder: webmExportEncoder },
  { type: "flac", label: "FLAC", encoder: flacExportEncoder },
]

const state = reactive({
  sourceMode: PLAYGROUND_SOURCE_MODE.externalTone,
  storageMode: PLAYGROUND_STORAGE_MODE.memory,
  persistenceBackend: PLAYGROUND_PERSISTENCE_BACKEND.indexeddb,
  requestedChannelCount: 1,
  exportSampleRateInput: "",
  inputStrategy: "auto",
  streamPluginMode: PLAYGROUND_STREAM_PLUGIN_MODE.streaming,
  streamPluginFormat: "wav",
  enableHighpass: false,
  enableLowpass: false,
  enableNoiseGate: false,
  sonicSpeed: 1,
  sonicPitch: 1,
  sonicRate: 1,
  sonicVolume: 1,
  sonicBlockMs: 200,
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
  lastSonicExportResult: null,
  microphoneDevices: [],
  selectedDeviceId: "",
  diagnosticsRawView: false,
})

const locale = ref(PLAYGROUND_LOCALE.zh)

let recorder = createPlaygroundRecorder()
const recorderRef = ref(recorder)
let recorderDisposers = []
let currentSource = null

// 统一由这一层处理中英文文案，避免模板、日志和提示各自散落。
function localize(zhText, enText) {
  return locale.value === PLAYGROUND_LOCALE.en ? enText : zhText
}

function getLocalizedCopy(copy) {
  return localize(copy.zh, copy.en)
}

function setLocale(nextLocale) {
  locale.value = nextLocale
}

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

const hasExportResult = computed(
  () =>
    state.lastExportResult !== null &&
    Object.keys(state.lastExportResult).length > 0
)

// 空值表示“不指定”，null 表示输入了非法 sampleRate。
const selectedExportSampleRate = computed(() => {
  const rawValue = state.exportSampleRateInput
  if (rawValue === "" || rawValue === null || rawValue === undefined) {
    return undefined
  }

  const sampleRate = Number(rawValue)
  return Number.isInteger(sampleRate) && sampleRate > 0 ? sampleRate : null
})

const canExportAudio = computed(
  () =>
    state.pendingActionLabel === "" &&
    state.recorderState === RecorderState.Stopped &&
    state.summary !== null
)

const exportActions = computed(() =>
  EXPORT_FORMAT_ACTIONS.map((action) => ({
    ...action,
    disabled: !canExportAudio.value || !isExportFormatSupported(action.type),
  }))
)

const exportHint = computed(() => {
  if (selectedExportSampleRate.value === null) {
    return localize(
      "sampleRate 需要填写为正整数，修正后才会恢复编码按钮可点击状态。",
      "sampleRate must be a positive integer before export actions become available again."
    )
  }

  if (selectedExportSampleRate.value === undefined) {
    return localize(
      "当前未显式指定 sampleRate；停止录音后会自动回填实际 sampleRate，并在点击按钮时调用对应编码器。",
      "No explicit sampleRate is set. After stopping, the actual sampleRate is filled in automatically before encoding."
    )
  }

  return localize(
    `当前导出 sampleRate 为 ${selectedExportSampleRate.value} Hz，按钮可点击状态按各编码器的 isSupportSampleRate 结果更新。`,
    `Export sampleRate is ${selectedExportSampleRate.value} Hz. Button availability follows each encoder's isSupportSampleRate result.`
  )
})

const topMetrics = computed(() => [
  {
    label: localize("录音器", "Recorder"),
    value: getRecorderStateLabel(state.recorderState),
    detail:
      state.pendingActionLabel ||
      localize("等待下一步操作。", "Ready for the next action."),
  },
  {
    label: localize("运行时", "Runtime"),
    value:
      state.runtimeInfo?.actualSampleRate ??
      state.runtimeInfo?.requestedSampleRate ??
      "-",
    detail: `${
      state.runtimeInfo?.actualChannelCount ??
      state.runtimeInfo?.requestedChannelCount ??
      "-"
    } ch · ${getInputStrategyLabel(
      state.runtimeInfo?.inputStrategy ?? state.inputStrategy
    )}`,
  },
  {
    label: localize("实时流", "Stream"),
    value: localize(
      `${state.realtimeChunkCount} 块`,
      `${state.realtimeChunkCount} chunk`
    ),
    detail: `${formatBytes(state.realtimeChunkBytes)} · ASR ${state.asrChunkCount}`,
  },
  {
    label: localize("持久化", "Persistence"),
    value:
      state.storageMode === PLAYGROUND_STORAGE_MODE.memory
        ? localize("纯内存", "Memory")
        : getPersistenceBackendLabel(
            state.activePersistenceBackend ?? state.persistenceBackend
          ),
    detail: localize(
      `${formatBytes(state.storageDiagnostics?.bytes ?? 0)} 已存储 · ${
        state.storageDiagnostics?.persistedEntries ?? 0
      } 项`,
      `${formatBytes(state.storageDiagnostics?.bytes ?? 0)} stored · ${
        state.storageDiagnostics?.persistedEntries ?? 0
      } item(s)`
    ),
  },
])

const topSnapshotGroups = computed(() => [
  {
    label: localize("运行时", "Runtime"),
    items: [
      {
        label: localize("来源", "Source"),
        value: getSourceModeLabel(state.sourceMode),
      },
      {
        label: localize("状态", "State"),
        value: getRecorderStateLabel(state.recorderState),
      },
      { label: localize("帧数", "Frames"), value: String(state.frameCount) },
      {
        label: localize("最近帧", "Last Frame"),
        value:
          state.lastFrameDurationMs > 0
            ? `${state.lastFrameDurationMs} ms`
            : "-",
      },
    ],
  },
  {
    label: localize("采集", "Capture"),
    items: [
      {
        label: localize("采样率", "Sample Rate"),
        value:
          state.runtimeInfo?.actualSampleRate ??
          state.runtimeInfo?.requestedSampleRate ??
          "-",
      },
      {
        label: localize("声道", "Channels"),
        value:
          state.runtimeInfo?.actualChannelCount ??
          state.runtimeInfo?.requestedChannelCount ??
          "-",
      },
      {
        label: localize("输入策略", "Input"),
        value: getInputStrategyLabel(
          state.runtimeInfo?.inputStrategy ?? state.inputStrategy
        ),
      },
      { label: localize("电平", "Level"), value: `${state.levelPercent}%` },
    ],
  },
  {
    label: localize("存储", "Storage"),
    items: [
      {
        label: localize("模式", "Mode"),
        value: getStorageModeLabel(state.storageMode),
      },
      {
        label: localize("后端", "Backend"),
        value:
          state.storageMode === PLAYGROUND_STORAGE_MODE.memory
            ? localize("纯内存", "Memory")
            : getPersistenceBackendLabel(
                state.activePersistenceBackend ?? state.persistenceBackend
              ),
      },
      {
        label: localize("落盘数", "Persisted"),
        value: String(state.storageDiagnostics?.persistedEntries ?? 0),
      },
      {
        label: localize("导出体积", "Exported"),
        value: formatBytes(state.exportedBytes ?? 0),
      },
    ],
  },
])

const exportStats = computed(() => {
  if (!state.lastExportResult) return []

  return EXPORT_FORMAT_ACTIONS.flatMap(({ type, label }) => {
    const result = state.lastExportResult?.[type]
    if (!result) return []

    return [
      {
        label,
        value: `${formatBytes(getExportResultByteLength(result))} · ${result.sampleRate} Hz`,
      },
    ]
  })
})

const canOpen = computed(
  () =>
    state.pendingActionLabel === "" &&
    [RecorderState.Idle, RecorderState.Closed].includes(state.recorderState)
)

const canSwitchRealtimePlugin = computed(
  () =>
    state.pendingActionLabel === "" &&
    state.recorderState === RecorderState.Idle
)

const canSwitchDspPlugins = computed(
  () =>
    state.pendingActionLabel === "" &&
    state.recorderState === RecorderState.Idle
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

const sonicExportStats = computed(() => {
  if (!state.lastSonicExportResult) return []

  return ["pcm", "wav"].flatMap((format) => {
    const result = state.lastSonicExportResult?.[format]
    if (!result) return []

    return [
      {
        label: localize(
          `Sonic ${format.toUpperCase()}`,
          `Sonic ${format.toUpperCase()}`
        ),
        value: `${formatBytes(getExportResultByteLength(result))} · ${result.sampleRate} Hz`,
      },
    ]
  })
})

const storageHint = computed(() => {
  if (state.storageMode === PLAYGROUND_STORAGE_MODE.memory) {
    return localize(
      "只使用内存缓冲，适合快速验证编码、事件和实时播放器链路。",
      "Uses memory buffers only. Best for fast validation of encoding, events, and live playback."
    )
  }

  if (state.storageMode === PLAYGROUND_STORAGE_MODE.persistent) {
    return localize(
      `录音开始后立即启用 ${getPersistenceBackendLabel(
        state.persistenceBackend
      )}，按 ${PLAYGROUND_PERSISTENCE_CHUNK_BYTES} byte 分块落盘。`,
      `${getPersistenceBackendLabel(
        state.persistenceBackend
      )} is enabled as soon as recording starts, flushing data in ${PLAYGROUND_PERSISTENCE_CHUNK_BYTES}-byte chunks.`
    )
  }

  return localize(
    `录音数据累计超过 ${state.memoryThresholdBytes} byte 后切换到 ${getPersistenceBackendLabel(
      state.persistenceBackend
    )}。`,
    `Switches to ${getPersistenceBackendLabel(
      state.persistenceBackend
    )} after buffered audio grows beyond ${state.memoryThresholdBytes} bytes.`
  )
})

const selectedDspPluginLabels = computed(() =>
  DSP_PLUGIN_OPTIONS.filter((option) => state[option.key]).map((option) =>
    getLocalizedCopy(option.label)
  )
)

const dspHint = computed(() => {
  if (selectedDspPluginLabels.value.length === 0) {
    return localize(
      "当前未启用 DSP。勾选后会把处理结果写入主录音链路，并影响实时流、快照与最终导出。",
      "DSP is currently disabled. Once enabled, processed frames affect the main recorder path, live stream, snapshots, and exports."
    )
  }

  return localize(
    `当前已选：${selectedDspPluginLabels.value.join(" / ")}。DSP 只允许在 idle 状态下重新挂载。`,
    `Selected: ${selectedDspPluginLabels.value.join(" / ")}. DSP can only be remounted while the recorder is idle.`
  )
})

const diagnosticGroups = computed(() => [
  { label: localize("运行时", "Runtime"), rows: runtimeRows.value },
  { label: localize("摘要", "Summary"), rows: summaryRows.value },
  { label: localize("存储", "Storage"), rows: storageRows.value },
])

appendLog(
  "info",
  localize(
    "独立 Vue playground 已就绪。",
    "Standalone Vue playground is ready."
  )
)
void initializeRecorder()

async function runLoggedAction(action, successMessage, pendingActionLabel) {
  state.pendingActionLabel =
    pendingActionLabel ?? localize("处理中...", "Processing...")
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
      time: new Date().toLocaleTimeString(locale.value, { hour12: false }),
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
  state.exportSampleRateInput = ""
  state.exportedBytes = null
  state.realtimeChunkCount = 0
  state.realtimeChunkBytes = 0
  state.asrChunkCount = 0
  state.asrChunkBytes = 0
  state.activePersistenceBackend = null
  state.storageDiagnostics = null
  state.lastExportResult = null
  state.lastSonicExportResult = null
}

async function initializeRecorder() {
  await recorder.use(createLevelMeterPlugin())
  await applySelectedDspPlugins()
  await recorder.use(createSelectedRealtimeStreamPlugin())
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

async function switchRealtimeStreamPlugin() {
  if (state.recorderState !== RecorderState.Idle) {
    appendLog(
      "warning",
      localize(
        "实时流插件只允许在 idle 状态下切换。",
        "The realtime stream plugin can only be switched while the recorder is idle."
      )
    )
    return
  }

  await runLoggedAction(
    async () => {
      await unuseRealtimeStreamPlugins()
      await recorder.use(createSelectedRealtimeStreamPlugin())
      state.realtimeChunkCount = 0
      state.realtimeChunkBytes = 0
      appendLog(
        "info",
        localize(
          `已切换实时流插件：${getRealtimePluginModeLabel(
            state.streamPluginMode
          )} · ${state.streamPluginFormat.toUpperCase()}。`,
          `Realtime stream plugin switched to ${getRealtimePluginModeLabel(
            state.streamPluginMode
          )} · ${state.streamPluginFormat.toUpperCase()}.`
        )
      )
    },
    "",
    localize("正在切换实时流插件...", "Switching realtime stream plugin...")
  )
}

async function switchDspPlugins() {
  if (state.recorderState !== RecorderState.Idle) {
    appendLog(
      "warning",
      localize(
        "DSP 插件只允许在 idle 状态下切换。",
        "DSP plugins can only be switched while the recorder is idle."
      )
    )
    return
  }

  await runLoggedAction(
    async () => {
      await unuseDspPlugins()
      await applySelectedDspPlugins()
      appendLog(
        "info",
        selectedDspPluginLabels.value.length === 0
          ? localize("已清空 DSP 插件配置。", "DSP configuration cleared.")
          : localize(
              `已应用 DSP 插件：${selectedDspPluginLabels.value.join(" / ")}。`,
              `Applied DSP plugins: ${selectedDspPluginLabels.value.join(" / ")}.`
            )
      )
    },
    "",
    localize("正在应用 DSP 配置...", "Applying DSP configuration...")
  )
}

async function handleStorageModeChange() {
  if (!canChangeStorageMode.value) {
    appendLog(
      "warning",
      localize(
        "请先关闭当前录音器，再切换持久化后端。",
        "Close the current recorder before switching persistence backends."
      )
    )
    return
  }

  resetRealtimeState()
  await rebuildRecorder()
  appendLog(
    "info",
    localize(
      `已切换存储模式：${getStorageModeLabel(state.storageMode)}。`,
      `Storage mode switched to ${getStorageModeLabel(state.storageMode)}.`
    )
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
    appendLog(
      "info",
      localize(
        `已枚举到 ${devices.length} 个麦克风设备。`,
        `Enumerated ${devices.length} microphone device(s).`
      )
    )
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
        localize(
          `录音器已打开，来源：${getSourceModeLabel(state.sourceMode)}。`,
          `Recorder opened with source: ${getSourceModeLabel(state.sourceMode)}.`
        )
      )

      if (state.sourceMode === PLAYGROUND_SOURCE_MODE.microphone) {
        await refreshMicrophoneDevices()
      }
    },
    "",
    localize("正在打开录音器...", "Opening recorder...")
  )
}

async function startRecorder() {
  await runLoggedAction(
    async () => {
      state.runtimeInfo = await recorder.start()
    },
    localize("录音已开始。", "Recording started."),
    localize("正在开始录音...", "Starting recording...")
  )
}

async function pauseRecorder() {
  await runLoggedAction(
    () => {
      recorder.pause()
    },
    localize("录音已暂停。", "Recording paused."),
    localize("正在暂停录音...", "Pausing recording...")
  )
}

async function resumeRecorder() {
  await runLoggedAction(
    async () => {
      state.runtimeInfo = await recorder.resume()
    },
    localize("录音已恢复。", "Recording resumed."),
    localize("正在恢复录音...", "Resuming recording...")
  )
}

async function stopRecorder() {
  await runLoggedAction(
    async () => {
      state.summary = await recorder.stop()
      state.exportSampleRateInput = String(
        state.runtimeInfo?.actualSampleRate ?? state.summary.sampleRate ?? ""
      )
      state.exportedBytes = null
      state.lastExportResult = null
      state.storageDiagnostics = await collectStorageDiagnostics()
      state.activePersistenceBackend =
        state.storageDiagnostics?.persistedEntries > 0
          ? state.storageDiagnostics.backend
          : null
      appendLog(
        "info",
        localize(
          `录音已停止，实际 sampleRate ${state.summary.sampleRate} Hz，实时导出 chunk ${state.realtimeChunkCount} 个。`,
          `Recording stopped at ${state.summary.sampleRate} Hz with ${state.realtimeChunkCount} streamed chunk(s).`
        )
      )
    },
    "",
    localize("正在停止录音...", "Stopping recording...")
  )
}

async function closeRecorder() {
  await runLoggedAction(
    async () => {
      await recorder.close()
      await closeManagedSource(currentSource)
      currentSource = null
      await rebuildRecorder()
      state.storageDiagnostics = await collectStorageDiagnostics()
      state.activePersistenceBackend =
        state.storageDiagnostics?.persistedEntries > 0
          ? state.storageDiagnostics.backend
          : null
    },
    localize(
      "录音器已关闭，输入资源已释放。",
      "Recorder closed and input resources released."
    ),
    localize("正在关闭录音器...", "Closing recorder...")
  )
}

async function exportAudio(format) {
  if (!canExportAudio.value) {
    appendLog(
      "warning",
      localize(
        "请先完成一次录音并保持 stopped 状态，再执行导出。",
        "Finish one recording and keep the recorder in the stopped state before exporting."
      )
    )
    return
  }

  if (!isExportFormatSupported(format)) {
    appendLog(
      "warning",
      localize(
        `${getExportFormatLabel(format)} 当前不支持所选 sampleRate。`,
        `${getExportFormatLabel(format)} does not support the selected sampleRate.`
      )
    )
    return
  }

  const formatLabel = getExportFormatLabel(format)
  const exportAction = getExportAction(format)
  const exportFormat = exportAction?.exportFormat ?? format
  await runLoggedAction(
    async () => {
      const result = await recorder.exportEncoded(
        exportFormat,
        buildExportOptions(format)
      )
      state.lastExportResult = {
        ...(state.lastExportResult ?? {}),
        [format]: result,
      }
      state.exportedBytes = getExportResultByteLength(result)
      triggerExportDownload(format, result)
      appendLog(
        "info",
        localize(
          `${formatLabel} 导出完成，${formatBytes(state.exportedBytes)}，sampleRate ${result.sampleRate} Hz。`,
          `${formatLabel} export completed: ${formatBytes(
            state.exportedBytes
          )}, sampleRate ${result.sampleRate} Hz.`
        )
      )
    },
    "",
    localize(`正在导出 ${formatLabel}...`, `Exporting ${formatLabel}...`)
  )
}

async function exportSonicSnapshot(format) {
  if (!canExportAudio.value) {
    appendLog(
      "warning",
      localize(
        "请先完成一次录音并保持 stopped 状态，再执行 Sonic 导出。",
        "Finish one recording and keep the recorder in the stopped state before running a Sonic export."
      )
    )
    return
  }

  await runLoggedAction(
    async () => {
      const snapshot = await buildCurrentPcmSnapshot()
      const transformPlugin = createSonicExportPlugin({
        format,
        encoders: format === "wav" ? [wavStreamEncoder] : [pcmStreamEncoder],
        ...buildSonicTransformOptions(),
      })
      const transformedInterleaved =
        await transformPlugin.transformSnapshot(snapshot)
      const transformedSnapshot = buildSnapshotFromInterleaved(
        transformedInterleaved,
        snapshot.sampleRate,
        snapshot.channels
      )
      const result =
        format === "wav"
          ? wavExportEncoder.export(
              transformedSnapshot,
              buildExportOptions("wav")
            )
          : pcmExportEncoder.export(
              transformedSnapshot,
              buildExportOptions("pcm")
            )

      state.lastSonicExportResult = {
        ...(state.lastSonicExportResult ?? {}),
        [format]: result,
      }
      state.exportedBytes = getExportResultByteLength(result)
      triggerSonicExportDownload(format, result)
      appendLog(
        "info",
        localize(
          `Sonic ${format.toUpperCase()} 导出完成，${formatBytes(
            state.exportedBytes
          )}，${snapshot.channels} ch。`,
          `Sonic ${format.toUpperCase()} export completed: ${formatBytes(
            state.exportedBytes
          )}, ${snapshot.channels} ch.`
        )
      )
    },
    "",
    localize(
      `正在导出 Sonic ${format.toUpperCase()}...`,
      `Exporting Sonic ${format.toUpperCase()}...`
    )
  )
}

function downloadPCM(result = state.lastExportResult?.pcm) {
  if (!result) return
  const blob = new Blob([result.data.buffer], {
    type: "application/octet-stream",
  })
  triggerDownload(
    blob,
    `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitRate}bit.pcm`
  )
}

function downloadWAV(result = state.lastExportResult?.wav) {
  if (!result) return
  triggerDownload(
    result.blob,
    `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitRate}bit.wav`
  )
}

function downloadSonicPCM(result = state.lastSonicExportResult?.pcm) {
  if (!result) return
  const blob = new Blob([result.data.buffer], {
    type: "application/octet-stream",
  })
  triggerDownload(
    blob,
    `recording_sonic_${result.sampleRate}hz_${result.channels}ch_${result.bitRate}bit.pcm`
  )
}

function downloadSonicWAV(result = state.lastSonicExportResult?.wav) {
  if (!result) return
  triggerDownload(
    result.blob,
    `recording_sonic_${result.sampleRate}hz_${result.channels}ch_${result.bitRate}bit.wav`
  )
}

function downloadMP3(result = state.lastExportResult?.mp3) {
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: "audio/mpeg" }),
    `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitrateKbps}kbps.mp3`
  )
}

function downloadG711(result = state.lastExportResult?.g711) {
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: "audio/basic" }),
    `recording_${result.sampleRate}hz_${result.variant}.g711`
  )
}

function downloadAAC(result = state.lastExportResult?.aac) {
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: result.mimeType }),
    `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitrate}bps.aac`
  )
}

function downloadAMR(result = state.lastExportResult?.amr) {
  if (!result) return
  const extension = result.bandMode === "wb" ? "awb" : "amr"
  triggerDownload(
    new Blob([result.data.buffer], { type: result.mimeType }),
    `recording_${result.sampleRate}hz_${result.bandMode}.${extension}`
  )
}

function downloadAC3(result = state.lastExportResult?.ac3) {
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: result.mimeType }),
    `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitrate}bps.${result.codec}`
  )
}

function downloadEAC3(result = state.lastExportResult?.eac3) {
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: result.mimeType }),
    `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitrate}bps.${result.codec}`
  )
}

function downloadOpusOgg(result = state.lastExportResult?.ogg) {
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: "audio/ogg; codecs=opus" }),
    `recording_${result.sampleRate}hz_${result.channels}ch.ogg`
  )
}

function downloadOpusWebm(result = state.lastExportResult?.webm) {
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: "audio/webm; codecs=opus" }),
    `recording_${result.sampleRate}hz_${result.channels}ch.webm`
  )
}

function downloadFLAC(result = state.lastExportResult?.flac) {
  if (!result) return
  triggerDownload(
    new Blob([result.data.buffer], { type: "audio/flac" }),
    `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitsPerSample}bit.flac`
  )
}

function triggerSonicExportDownload(format, result) {
  if (format === "wav") {
    downloadSonicWAV(result)
    return
  }

  downloadSonicPCM(result)
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

function getInputStrategyLabel(strategy) {
  switch (strategy) {
    case "auto":
      return localize("自动", "Auto")
    case "media-recorder":
      return "MediaRecorder"
    case "audio-worklet":
      return "AudioWorklet"
    case "script-processor":
      return "ScriptProcessor"
    default:
      return String(strategy ?? "-")
  }
}

function getSourceModeLabel(mode) {
  return mode === PLAYGROUND_SOURCE_MODE.externalTone
    ? localize("外部音调流", "External tone stream")
    : localize("麦克风", "Microphone")
}

function getStorageModeLabel(mode) {
  switch (mode) {
    case PLAYGROUND_STORAGE_MODE.persistent:
      return localize("持久化模式", "Persistent")
    case PLAYGROUND_STORAGE_MODE.auto:
      return localize("自动模式", "Auto")
    default:
      return localize("纯内存", "Memory only")
  }
}

function getPersistenceBackendLabel(backend) {
  return backend === PLAYGROUND_PERSISTENCE_BACKEND.opfs ? "OPFS" : "IndexedDB"
}

function getRealtimePluginModeLabel(mode) {
  return mode === PLAYGROUND_STREAM_PLUGIN_MODE.sonic
    ? "Sonic Export"
    : "Streaming Export"
}

function getRecorderStateLabel(value) {
  switch (value) {
    case RecorderState.Idle:
      return localize("空闲", "Idle")
    case RecorderState.Ready:
      return localize("就绪", "Ready")
    case RecorderState.Recording:
      return localize("录音中", "Recording")
    case RecorderState.Paused:
      return localize("已暂停", "Paused")
    case RecorderState.Stopped:
      return localize("已停止", "Stopped")
    case RecorderState.Closed:
      return localize("已关闭", "Closed")
    default:
      return String(value)
  }
}

function getLogTypeLabel(type) {
  switch (type) {
    case "info":
      return localize("信息", "Info")
    case "warning":
      return localize("警告", "Warning")
    case "error":
      return localize("错误", "Error")
    default:
      return type
  }
}

async function applySelectedDspPlugins() {
  for (const option of DSP_PLUGIN_OPTIONS) {
    if (!state[option.key]) {
      continue
    }

    await recorder.use(option.createPlugin())
  }
}

function createSelectedRealtimeStreamPlugin() {
  if (state.streamPluginMode === PLAYGROUND_STREAM_PLUGIN_MODE.sonic) {
    return createSonicExportPlugin({
      format: state.streamPluginFormat,
      encoders: [pcmStreamEncoder, wavStreamEncoder],
      encoderOptions:
        state.streamPluginFormat === "wav" ? { framesPerChunk: 4 } : undefined,
      allowMainThreadFallback: true,
      speed: state.sonicSpeed,
      pitch: state.sonicPitch,
      rate: state.sonicRate,
      volume: state.sonicVolume,
      blockMs: state.sonicBlockMs,
    })
  }

  return createStreamingExportPlugin({
    format: state.streamPluginFormat,
    encoders: [wavStreamEncoder, pcmStreamEncoder],
    encoderOptions:
      state.streamPluginFormat === "wav" ? { framesPerChunk: 4 } : undefined,
    allowMainThreadFallback: true,
  })
}

async function unuseDspPlugins() {
  try {
    await recorder.unuse("dsp")
  } catch (error) {
    if (!String(error).includes("is not registered")) {
      throw error
    }
  }
}

async function unuseRealtimeStreamPlugins() {
  try {
    await recorder.unuse("streaming-export")
  } catch (error) {
    if (!String(error).includes("is not registered")) {
      throw error
    }
  }

  try {
    await recorder.unuse("sonic-export")
  } catch (error) {
    if (!String(error).includes("is not registered")) {
      throw error
    }
  }
}

function getExportAction(format) {
  return EXPORT_FORMAT_ACTIONS.find((action) => action.type === format) ?? null
}

function getExportFormatLabel(format) {
  return getExportAction(format)?.label ?? format
}

function buildExportOptions(format) {
  const sampleRate = selectedExportSampleRate.value
  const exportAction = getExportAction(format)
  const options = {}

  if (sampleRate !== undefined && sampleRate !== null) {
    options.sampleRate = sampleRate
  }

  // AMR 的 NB/WB 以两个按钮暴露，底层仍共享同一个 amr 编码器。
  if (exportAction?.exportFormat === "amr" && exportAction.bandMode) {
    options.bandMode = exportAction.bandMode
  }

  return Object.keys(options).length > 0 ? options : undefined
}

function buildSonicTransformOptions() {
  return {
    speed: state.sonicSpeed,
    pitch: state.sonicPitch,
    rate: state.sonicRate,
    volume: state.sonicVolume,
    blockMs: state.sonicBlockMs,
  }
}

function isExportFormatSupported(format) {
  const sampleRate = selectedExportSampleRate.value
  if (sampleRate === null) return false
  if (sampleRate === undefined) return true

  const encoder = getExportAction(format)?.encoder
  if (typeof encoder?.isSupportSampleRate !== "function") return true

  return encoder.isSupportSampleRate(sampleRate, buildExportOptions(format))
}

function getExportResultByteLength(result) {
  if (result?.data instanceof Uint8Array) return result.data.byteLength
  if (result?.arrayBuffer instanceof ArrayBuffer)
    return result.arrayBuffer.byteLength
  if (result?.blob instanceof Blob) return result.blob.size
  return 0
}

function deinterleavePcmData(source, channels) {
  const frameLength = Math.floor(source.length / channels)
  return Array.from({ length: channels }, (_, channelIndex) => {
    const output = new Int16Array(frameLength)
    for (let frameIndex = 0; frameIndex < frameLength; frameIndex += 1) {
      output[frameIndex] = source[frameIndex * channels + channelIndex] ?? 0
    }
    return output
  })
}

async function buildCurrentPcmSnapshot() {
  const pcm = await recorder.exportEncoded("pcm", { bitRate: 16 })
  if (!(pcm.data instanceof Int16Array)) {
    throw new Error(
      localize(
        "无法从录音器导出的 PCM 构建快照。",
        "Failed to build a PCM snapshot from recorder export."
      )
    )
  }

  const channels =
    state.summary?.channels ?? state.runtimeInfo?.actualChannelCount ?? 1
  const sampleRate =
    state.summary?.sampleRate ?? state.runtimeInfo?.actualSampleRate ?? 16_000

  const planar = deinterleavePcmData(pcm.data, channels)
  return {
    sampleRate,
    channels,
    frameCount: planar[0]?.length ?? 0,
    durationMs: pcm.durationMs,
    planar,
  }
}

function buildSnapshotFromInterleaved(pcmData, sampleRate, channels) {
  const planar = deinterleavePcmData(pcmData, channels)
  const frameCount = planar[0]?.length ?? 0
  return {
    sampleRate,
    channels,
    frameCount,
    durationMs: frameCount === 0 ? 0 : (frameCount / sampleRate) * 1000,
    planar,
  }
}

function triggerExportDownload(format, result) {
  switch (format) {
    case "pcm":
      downloadPCM(result)
      return
    case "wav":
      downloadWAV(result)
      return
    case "mp3":
      downloadMP3(result)
      return
    case "g711":
      downloadG711(result)
      return
    case "aac":
      downloadAAC(result)
      return
    case "amr-nb":
    case "amr-wb":
      downloadAMR(result)
      return
    case "ac3":
      downloadAC3(result)
      return
    case "eac3":
      downloadEAC3(result)
      return
    case "ogg":
      downloadOpusOgg(result)
      return
    case "webm":
      downloadOpusWebm(result)
      return
    case "flac":
      downloadFLAC(result)
      return
    default:
      return
  }
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
    throw new Error(
      localize(
        "当前浏览器不支持 AudioContext。",
        "AudioContext is unavailable in this browser."
      )
    )
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

  appendLog(
    "info",
    localize("已创建外部音调流。", "External tone stream created.")
  )

  return {
    stream: destination.stream,
    sampleRate: audioContext.sampleRate,
    dispose: async () => {
      oscillator.stop()
      if (audioContext.state !== "closed") {
        await audioContext.close()
      }
      appendLog(
        "info",
        localize("外部音调流已释放。", "External tone stream released.")
      )
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
      reason: localize(
        "当前浏览器不可用 indexedDB。",
        "indexedDB is unavailable in this browser."
      ),
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
      reject(
        request.error ??
          new Error(
            localize(
              "检查 IndexedDB 存储失败。",
              "Failed to inspect IndexedDB storage."
            )
          )
      )
  })

  try {
    const entries = await new Promise((resolve, reject) => {
      const transaction = database.transaction("sessions", "readonly")
      const store = transaction.objectStore("sessions")
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result ?? [])
      request.onerror = () =>
        reject(
          request.error ??
            new Error(
              localize(
                "读取 IndexedDB session 数据失败。",
                "Failed to read IndexedDB session data."
              )
            )
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
      reason: localize(
        "当前浏览器不可用 navigator.storage.getDirectory。",
        "navigator.storage.getDirectory is unavailable in this browser."
      ),
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
    <!-- ═══════════════════════════════════════════════════
         HEADER BAR  ── compact single-row, no tiles
    ════════════════════════════════════════════════════ -->
    <header class="site-header topbar">
      <div class="site-header-left">
        <p class="eyebrow">Audio Recorder Lab</p>
        <h1>
          {{ localize("浏览器录音工作台", "Browser Recorder Workspace") }}
        </h1>
        <p class="lede">
          {{
            localize(
              "通过 dist 产物快速校验输入源、持久化、实时编码、播放器与导出链路。",
              "Use the dist build to validate input sources, persistence, realtime encoding, playback, and export flows."
            )
          }}
        </p>
      </div>

      <div class="site-header-right">
        <div
          class="locale-switch"
          :aria-label="localize('界面语言', 'Interface language')"
          role="group"
        >
          <span class="locale-switch-label">{{
            localize("界面语言", "Language")
          }}</span>
          <div class="locale-switch-buttons">
            <button
              v-for="option in LOCALE_OPTIONS"
              :key="option.value"
              :class="[
                'locale-button',
                { 'locale-button-active': locale === option.value },
              ]"
              :data-testid="`locale-${option.value}`"
              type="button"
              @click="setLocale(option.value)"
            >
              <span>{{ option.shortLabel }}</span>
              <small>{{ option.label }}</small>
            </button>
          </div>
        </div>

        <!-- state badge -->
        <span
          :class="[
            'state-badge',
            getRecorderBadgeClass(state.recorderState),
            state.pendingActionLabel ? 'badge-accent' : '',
          ]"
          >{{
            state.pendingActionLabel ||
            getRecorderStateLabel(state.recorderState)
          }}</span
        >

        <!-- inline metrics strip -->
        <dl class="metrics-strip">
          <template v-for="item in topMetrics" :key="item.label">
            <dt>{{ item.label }}</dt>
            <dd>
              <strong>{{ item.value }}</strong>
              <small>{{ item.detail }}</small>
            </dd>
          </template>
        </dl>

        <!-- context chips -->
        <div class="context-chips">
          <span class="mini-chip">{{
            getSourceModeLabel(state.sourceMode)
          }}</span>
          <span class="mini-chip">{{
            getStorageModeLabel(state.storageMode)
          }}</span>
          <span class="mini-chip">
            {{
              state.storageMode === PLAYGROUND_STORAGE_MODE.memory
                ? localize("纯内存", "Memory")
                : getPersistenceBackendLabel(state.persistenceBackend)
            }}
          </span>
        </div>
      </div>
    </header>

    <!-- ═══════════════════════════════════════════════════
         MAIN WORKSPACE  ── three rails
    ════════════════════════════════════════════════════ -->
    <div class="workspace">
      <!-- ─── LEFT RAIL: configuration ─── -->
      <aside class="rail rail-config">
        <div class="rail-head">
          <span class="rail-title">setup.conf</span>
          <span class="rail-meta">{{
            localize("采集 / 管线 / DSP", "capture / pipeline / DSP")
          }}</span>
        </div>

        <!-- §1 Capture Setup -->
        <section class="config-section">
          <div class="config-section-head">
            <span class="section-kicker">{{
              localize("采集设置", "Capture Setup")
            }}</span>
            <span class="badge">{{ localize("步骤 1", "Step 1") }}</span>
          </div>

          <fieldset class="config-fieldset">
            <legend>{{ localize("输入源", "Input Source") }}</legend>
            <label class="field">
              <span>{{ localize("来源", "Source") }}</span>
              <select
                v-model="state.sourceMode"
                @change="handleSourceModeChange"
              >
                <option :value="PLAYGROUND_SOURCE_MODE.microphone">
                  {{ localize("麦克风", "Microphone") }}
                </option>
                <option :value="PLAYGROUND_SOURCE_MODE.externalTone">
                  {{ localize("外部音调流", "External tone stream") }}
                </option>
              </select>
            </label>
            <label
              v-if="state.sourceMode === PLAYGROUND_SOURCE_MODE.microphone"
              class="field"
            >
              <span>{{ localize("设备", "Device") }}</span>
              <div class="inline-field">
                <select v-model="state.selectedDeviceId">
                  <option value="">
                    {{ localize("默认麦克风", "Default microphone") }}
                  </option>
                  <option
                    v-for="device in state.microphoneDevices"
                    :key="device.deviceId"
                    :value="device.deviceId"
                  >
                    {{
                      device.label ||
                      localize(
                        `麦克风 ${device.deviceId.slice(0, 8)}…`,
                        `Microphone ${device.deviceId.slice(0, 8)}…`
                      )
                    }}
                  </option>
                </select>
                <button class="ghost-button" @click="refreshMicrophoneDevices">
                  {{ localize("刷新", "Refresh") }}
                </button>
              </div>
            </label>
          </fieldset>

          <fieldset class="config-fieldset">
            <legend>{{ localize("采集参数", "Capture Settings") }}</legend>
            <label class="field">
              <span>{{ localize("声道", "Channels") }}</span>
              <select v-model.number="state.requestedChannelCount">
                <option :value="1">{{ localize("单声道", "Mono") }}</option>
                <option :value="2">{{ localize("双声道", "Stereo") }}</option>
              </select>
            </label>
            <label class="field">
              <span>{{ localize("策略", "Strategy") }}</span>
              <select v-model="state.inputStrategy">
                <option value="auto">{{ localize("自动", "Auto") }}</option>
                <option value="media-recorder">MediaRecorder</option>
                <option value="audio-worklet">AudioWorklet</option>
                <option value="script-processor">ScriptProcessor</option>
              </select>
            </label>
          </fieldset>
        </section>

        <!-- §2 Pipeline Setup -->
        <section class="config-section">
          <div class="config-section-head">
            <span class="section-kicker">{{
              localize("管线设置", "Pipeline Setup")
            }}</span>
            <span class="badge">{{ localize("步骤 2", "Step 2") }}</span>
          </div>

          <fieldset class="config-fieldset">
            <legend>
              {{ localize("缓存与持久化", "Buffer & Persistence") }}
            </legend>
            <label class="field">
              <span>{{ localize("存储模式", "Storage Mode") }}</span>
              <select
                v-model="state.storageMode"
                :disabled="!canChangeStorageMode"
                @change="handleStorageModeChange"
              >
                <option :value="PLAYGROUND_STORAGE_MODE.memory">
                  {{ localize("纯内存", "Memory only") }}
                </option>
                <option :value="PLAYGROUND_STORAGE_MODE.persistent">
                  {{ localize("持久化", "Persistent") }}
                </option>
                <option :value="PLAYGROUND_STORAGE_MODE.auto">
                  {{ localize("自动切换", "Auto switch") }}
                </option>
              </select>
            </label>
            <label class="field">
              <span>{{ localize("后端", "Backend") }}</span>
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
            <label class="field">
              <span>{{ localize("溢写阈值", "Spill Threshold") }}</span>
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
            <p class="field-note">{{ storageHint }}</p>
          </fieldset>

          <fieldset class="config-fieldset">
            <legend>
              {{ localize("实时流插件", "Realtime Stream Plugin") }}
              <button
                :disabled="!canSwitchRealtimePlugin"
                class="ghost-button legend-action"
                @click="switchRealtimeStreamPlugin"
              >
                {{ localize("应用切换", "Apply Switch") }}
              </button>
            </legend>
            <label class="field">
              <span>{{ localize("流模式", "Stream Mode") }}</span>
              <select v-model="state.streamPluginMode">
                <option :value="PLAYGROUND_STREAM_PLUGIN_MODE.streaming">
                  Streaming Export
                </option>
                <option :value="PLAYGROUND_STREAM_PLUGIN_MODE.sonic">
                  Sonic Export
                </option>
              </select>
            </label>
            <label class="field">
              <span>{{ localize("流格式", "Stream Format") }}</span>
              <select v-model="state.streamPluginFormat">
                <option value="wav">WAV</option>
                <option value="pcm">PCM</option>
              </select>
            </label>
            <template
              v-if="
                state.streamPluginMode === PLAYGROUND_STREAM_PLUGIN_MODE.sonic
              "
            >
              <label class="field">
                <span>speed</span>
                <input
                  v-model.number="state.sonicSpeed"
                  min="0.1"
                  step="0.1"
                  type="number"
                />
              </label>
              <label class="field">
                <span>pitch</span>
                <input
                  v-model.number="state.sonicPitch"
                  min="0.1"
                  step="0.1"
                  type="number"
                />
              </label>
              <label class="field">
                <span>rate</span>
                <input
                  v-model.number="state.sonicRate"
                  min="0.1"
                  step="0.1"
                  type="number"
                />
              </label>
              <label class="field">
                <span>volume</span>
                <input
                  v-model.number="state.sonicVolume"
                  min="0.1"
                  step="0.1"
                  type="number"
                />
              </label>
              <label class="field">
                <span>blockMs</span>
                <input
                  v-model.number="state.sonicBlockMs"
                  min="100"
                  step="10"
                  type="number"
                />
              </label>
            </template>
            <p class="field-note">
              {{
                localize(
                  "当前实时流通过 plugin:stream 对接 Streaming Player。切换仅允许在 idle 状态执行。",
                  "The live stream is wired into Streaming Player via plugin:stream. Switching is only allowed while idle."
                )
              }}
            </p>
          </fieldset>
        </section>

        <!-- §3 DSP -->
        <section class="config-section">
          <div class="config-section-head">
            <span class="section-kicker">{{
              localize("DSP 管线", "DSP Pipeline")
            }}</span>
            <button
              :disabled="!canSwitchDspPlugins"
              class="ghost-button"
              @click="switchDspPlugins"
            >
              {{ localize("应用 DSP", "Apply DSP") }}
            </button>
          </div>

          <div class="dsp-list">
            <label
              v-for="option in DSP_PLUGIN_OPTIONS"
              :key="option.pluginName"
              class="dsp-row"
            >
              <input v-model="state[option.key]" type="checkbox" />
              <span class="dsp-row-body">
                <strong>{{ getLocalizedCopy(option.label) }}</strong>
                <small>{{ getLocalizedCopy(option.note) }}</small>
              </span>
            </label>
          </div>
          <p class="field-note">{{ dspHint }}</p>
        </section>
      </aside>

      <!-- ─── CENTER: action console + output ─── -->
      <div class="rail rail-center">
        <div class="rail-head">
          <span class="rail-title">session.ctrl</span>
          <span class="rail-meta">{{
            localize("控制 / 导出 / 播放器", "actions / export / player")
          }}</span>
        </div>

        <!-- Action console -->
        <section class="center-block">
          <div class="center-block-head">
            <div>
              <p class="section-kicker">
                {{ localize("操作台", "Action Console") }}
              </p>
              <h2>{{ localize("录音流程", "Recording Flow") }}</h2>
            </div>
            <span
              :class="[
                'state-badge',
                getRecorderBadgeClass(state.recorderState),
                state.pendingActionLabel ? 'badge-accent' : '',
              ]"
              >{{
                state.pendingActionLabel ||
                getRecorderStateLabel(state.recorderState)
              }}</span
            >
          </div>

          <!-- live stats row -->
          <div class="live-stats-row">
            <span class="live-stat">
              <b>{{ localize("帧数", "Frames") }}</b
              ><i>{{ state.frameCount }}</i>
            </span>
            <span class="live-stat">
              <b>{{ localize("实时流", "Realtime") }}</b
              ><i>{{ formatBytes(state.realtimeChunkBytes) }}</i>
            </span>
            <span class="live-stat">
              <b>ASR</b><i>{{ formatBytes(state.asrChunkBytes) }}</i>
            </span>
            <span class="live-stat">
              <b>{{ localize("导出", "Export") }}</b>
              <i>{{
                hasExportResult
                  ? formatBytes(state.exportedBytes ?? 0)
                  : localize("等待中", "Pending")
              }}</i>
            </span>
          </div>

          <!-- level meter -->
          <div class="meter-row">
            <span
              >{{ localize("输入电平", "Input Level") }}
              {{ state.levelPercent }}%</span
            >
            <div class="meter-shell">
              <div
                :style="{ width: `${state.levelPercent}%` }"
                class="meter-fill"
              ></div>
            </div>
          </div>

          <!-- recorder actions -->
          <div class="action-bar">
            <button :disabled="!canOpen" @click="openRecorder">
              {{ localize("打开", "Open") }}
            </button>
            <button :disabled="!canStart" @click="startRecorder">
              {{ localize("开始", "Start") }}
            </button>
            <button :disabled="!canPause" @click="pauseRecorder">
              {{ localize("暂停", "Pause") }}
            </button>
            <button :disabled="!canResume" @click="resumeRecorder">
              {{ localize("恢复", "Resume") }}
            </button>
            <button :disabled="!canStop" @click="stopRecorder">
              {{ localize("停止", "Stop") }}
            </button>
            <button :disabled="!canClose" @click="closeRecorder">
              {{ localize("关闭", "Close") }}
            </button>
          </div>
        </section>

        <!-- Output / Export -->
        <section class="center-block">
          <div class="center-block-head">
            <div>
              <p class="section-kicker">
                {{ localize("导出阶段", "Output Stage") }}
              </p>
              <h2>{{ localize("导出与下载", "Export & Download") }}</h2>
            </div>
            <span class="badge">
              {{
                hasExportResult
                  ? formatBytes(state.exportedBytes ?? 0)
                  : localize("等待导出", "Waiting")
              }}
            </span>
          </div>

          <!-- export options inline -->
          <div class="export-options-row">
            <label class="field field-inline">
              <span>sampleRate</span>
              <select v-model="state.exportSampleRateInput">
                <option value="">{{ localize("不指定", "Unset") }}</option>
                <option
                  v-for="sampleRate in STANDARD_EXPORT_SAMPLE_RATES"
                  :key="sampleRate"
                  :value="String(sampleRate)"
                >
                  {{ sampleRate }} Hz
                </option>
              </select>
            </label>
          </div>
          <p class="field-note">{{ exportHint }}</p>

          <!-- export buttons: wrapping flex row -->
          <div class="export-btn-row">
            <button
              v-for="action in exportActions"
              :key="action.type"
              :disabled="action.disabled"
              @click="exportAudio(action.type)"
            >
              {{ action.label }}
            </button>
          </div>

          <!-- sonic export -->
          <div class="subsection-divider">
            <span>{{
              localize(
                "Sonic Snapshot — 变速变调离线导出",
                "Sonic Snapshot — Offline speed and pitch export"
              )
            }}</span>
            <span class="badge">{{
              getRealtimePluginModeLabel(state.streamPluginMode)
            }}</span>
          </div>
          <p class="field-note">
            {{
              localize(
                "始终基于 stopped 后的 PCM snapshot 做 Sonic 处理，再导出为 PCM/WAV，与实时流插件是否为 Sonic 无关。",
                "Sonic export always starts from the stopped PCM snapshot and then exports PCM/WAV, independent of the live stream plugin mode."
              )
            }}
          </p>
          <div class="export-btn-row export-btn-row-sm">
            <button
              :disabled="!canExportAudio"
              @click="exportSonicSnapshot('pcm')"
            >
              Sonic PCM
            </button>
            <button
              :disabled="!canExportAudio"
              @click="exportSonicSnapshot('wav')"
            >
              Sonic WAV
            </button>
          </div>

          <!-- export results -->
          <template v-if="exportStats.length || sonicExportStats.length">
            <div class="result-list">
              <div
                v-for="item in [...exportStats, ...sonicExportStats]"
                :key="item.label"
                class="result-row"
              >
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </div>
            </div>
          </template>
          <p v-else class="field-note muted-block">
            {{
              localize(
                "停止录音后点击任一编码按钮，触发对应格式导出并下载。",
                "Stop the recorder, then click any encoder button to export and download that format."
              )
            }}
          </p>
        </section>

        <!-- Streaming Player -->
        <section class="center-block player-section-shell">
          <div class="center-block-head">
            <div>
              <p class="section-kicker">Streaming Player</p>
              <h2>{{ localize("实时播放链路", "Realtime Playback Chain") }}</h2>
            </div>
            <span class="badge">{{
              getRealtimePluginModeLabel(state.streamPluginMode)
            }}</span>
          </div>
          <p class="field-note">
            {{
              localize(
                "复用录音实时流，验证播放器缓存、重播和状态同步。",
                "Reuses the recorder's live stream to validate buffering, replay, and state sync."
              )
            }}
          </p>
          <StreamingPlayerDemo :locale="locale" :recorder="recorderRef" />
        </section>
      </div>

      <!-- ─── RIGHT RAIL: diagnostics + logs ─── -->
      <aside class="rail rail-info side-column">
        <div class="rail-head">
          <span class="rail-title">diag.log</span>
          <span class="rail-meta">{{
            localize("运行时 / 存储 / 事件", "runtime / storage / events")
          }}</span>
        </div>

        <!-- Diagnostics -->
        <section class="info-section">
          <div class="info-section-head">
            <span class="section-kicker">{{
              localize("诊断", "Diagnostics")
            }}</span>
            <button
              class="ghost-button"
              @click="state.diagnosticsRawView = !state.diagnosticsRawView"
            >
              {{
                state.diagnosticsRawView
                  ? localize("结构化", "Structured")
                  : "JSON"
              }}
            </button>
          </div>

          <template v-if="state.diagnosticsRawView">
            <pre class="json">{{ runtimeJson }}</pre>
            <pre class="json">{{ summaryJson }}</pre>
            <pre class="json">{{ storageJson }}</pre>
          </template>

          <template v-else>
            <div
              v-for="group in diagnosticGroups"
              :key="group.label"
              class="diag-group"
            >
              <p class="diag-group-label">
                {{ group.label }} <small>{{ group.rows.length }}</small>
              </p>
              <dl v-if="group.rows.length" class="kv-grid">
                <template v-for="row in group.rows" :key="row.label">
                  <dt>{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </template>
              </dl>
              <p v-else class="field-note">
                {{ localize("暂无数据。", "No data yet.") }}
              </p>
            </div>
          </template>
        </section>

        <!-- Logs -->
        <section class="info-section info-section-logs">
          <div class="info-section-head">
            <span class="section-kicker">{{ localize("日志", "Logs") }}</span>
            <button class="ghost-button" @click="state.logs = []">
              {{ localize("清空", "Clear") }}
            </button>
          </div>
          <ul class="log-list log-panel-body">
            <li
              v-for="item in state.logs"
              :key="`${item.time}-${item.message}`"
              class="log-item"
            >
              <div class="log-head">
                <span class="log-time">{{ item.time }}</span>
                <span :class="['log-type', item.type]">{{
                  getLogTypeLabel(item.type)
                }}</span>
              </div>
              <p class="log-message">{{ item.message }}</p>
            </li>
            <li v-if="state.logs.length === 0" class="log-item log-item-empty">
              <p class="log-message">
                {{
                  localize(
                    "暂无日志，操作录音器后会在这里展示事件流。",
                    "No logs yet. Recorder events will appear here after you interact with it."
                  )
                }}
              </p>
            </li>
          </ul>
        </section>
      </aside>
    </div>
  </main>
</template>
