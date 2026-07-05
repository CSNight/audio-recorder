<script setup>
import { computed, onBeforeUnmount, reactive, ref } from "vue"
import PlaygroundDiagnosticsRail from "./components/PlaygroundDiagnosticsRail.vue"
import PlaygroundNmnPanel from "./components/PlaygroundNmnPanel.vue"
import PlaygroundPluginPanel from "./components/PlaygroundPluginPanel.vue"
import PlaygroundStreamingPlayerPanel from "./components/PlaygroundStreamingPlayerPanel.vue"
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
import { createAsrExportPlugin } from "@csnight/audio-recorder/plugins/asr-export"
import { createSonicExportPlugin } from "@csnight/audio-recorder/plugins/sonic-export"
import {
  DEFAULT_NMN_OPTIONS,
  nmn2pcm,
} from "@csnight/audio-recorder/plugins/nmn2pcm"
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
import {
  DSP_PLUGIN_OPTIONS,
  PLAYGROUND_STREAM_PLUGIN_MODE,
  usePlaygroundPluginManager,
} from "./composables/usePlaygroundPluginManager.js"

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

const STANDARD_EXPORT_SAMPLE_RATES = [
  7350, 8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000,
  88200, 96000, 176400, 192000,
]

const PERSISTENCE_PLUGIN_FACTORIES = {
  [PLAYGROUND_PERSISTENCE_BACKEND.indexeddb]: createIndexedDbPersistencePlugin,
  [PLAYGROUND_PERSISTENCE_BACKEND.opfs]: createOpfsPersistencePlugin,
}

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
  fftBars: [],
  fftPeakPercent: 0,
  dtmfLastKey: "-",
  dtmfDetections: [],
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
  nmnScore: "!mf! [1 3 5]- 1 ~ 1 tr(3) grace(2->3) turn(5) 0 6.",
  nmnOptions: {
    ...DEFAULT_NMN_OPTIONS,
    bpm: 96,
    volume: 0.6,
  },
  nmnExportFormat: "wav",
  lastNmnExport: null,
  nmnPreviewUrl: "",
  nmnPreviewByteLength: 0,
  nmnPreviewDurationMs: 0,
  microphoneDevices: [],
  selectedDeviceId: "",
  diagnosticsRawView: false,
})

const locale = ref(PLAYGROUND_LOCALE.zh)

let recorder = createPlaygroundRecorder()
const recorderRef = ref(recorder)
let recorderDisposers = []
let currentSource = null
let latestNmnPreviewKey = ""
let recorderInitGeneration = 0

// 统一由这一层处理中英文文案，避免模板、日志和提示各自散落。
function localize(zhText, enText) {
  return locale.value === PLAYGROUND_LOCALE.en ? enText : zhText
}

function setLocale(nextLocale) {
  locale.value = nextLocale
}

const {
  pluginConfig,
  analysisHint,
  dspHint,
  pluginConfigDirty,
  canApplyPluginConfig,
  initializeRecorderPlugins,
  applyPluginConfig,
  buildSonicTransformOptions,
  getRealtimePluginModeLabel,
} = usePlaygroundPluginManager({
  localize,
  appendLog,
  runLoggedAction,
  getRecorder: () => recorder,
  getRecorderState: () => state.recorderState,
  getPendingActionLabel: () => state.pendingActionLabel,
  resetAnalysisRuntime,
  resetRealtimeStreamRuntime,
})

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

const fftBarPreview = computed(() =>
  Array.from({ length: Math.max(12, pluginConfig.fftBarCount) }, (_, index) => {
    return state.fftBars[index] ?? 0
  })
)

const nmnExportHint = computed(() =>
  localize(
    "NMN2PCM 不接入录音输入；当前 playground 仅提供本地预览和按所选编码器导出下载。",
    "NMN2PCM does not enter the recorder input path. This playground only provides local preview and export through the selected encoder."
  )
)

const nmnResultRows = computed(() => {
  if (!state.lastNmnExport) return []

  return [
    {
      label: localize("格式", "Format"),
      value: state.lastNmnExport.format.toUpperCase(),
    },
    {
      label: localize("体积", "Size"),
      value: formatBytes(state.lastNmnExport.byteLength),
    },
    {
      label: localize("采样率", "Sample Rate"),
      value: `${state.lastNmnExport.sampleRate} Hz`,
    },
    {
      label: localize("时长", "Duration"),
      value: `${Math.round(state.lastNmnExport.durationMs)} ms`,
    },
  ]
})

const hasNmnPreview = computed(() => state.nmnPreviewUrl !== "")

const nmnPreviewRows = computed(() => {
  if (!hasNmnPreview.value) return []

  return [
    {
      label: localize("预览体积", "Preview Size"),
      value: formatBytes(state.nmnPreviewByteLength),
    },
    {
      label: localize("预览时长", "Preview Duration"),
      value: `${Math.round(state.nmnPreviewDurationMs)} ms`,
    },
  ]
})

const isNmnPreviewStale = computed(
  () => hasNmnPreview.value && latestNmnPreviewKey !== getNmnPreviewKey()
)

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

const analysisPluginBadge = computed(
  () =>
    `${pluginConfig.enableFftPlugin ? 1 : 0} FFT / ${
      pluginConfig.enableDtmfPlugin ? 1 : 0
    } DTMF`
)

const diagnosticGroups = computed(() => [
  { label: localize("运行时", "Runtime"), rows: runtimeRows.value },
  { label: localize("摘要", "Summary"), rows: summaryRows.value },
  { label: localize("存储", "Storage"), rows: storageRows.value },
  {
    label: localize("插件", "Plugins"),
    rows: toKvRows({
      fftEnabled: pluginConfig.enableFftPlugin,
      fftPeakPercent: state.fftPeakPercent,
      dtmfEnabled: pluginConfig.enableDtmfPlugin,
      dtmfLastKey: state.dtmfLastKey,
      nmnExportFormat: state.nmnExportFormat,
      nmnLastExport: state.lastNmnExport,
    }),
  },
])

appendLog(
  "info",
  localize(
    "独立 Vue playground 已就绪。",
    "Standalone Vue playground is ready."
  )
)
void initializeRecorder(recorder, ++recorderInitGeneration)

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
  resetAnalysisRuntime()
  resetRealtimeStreamRuntime()
  state.activePersistenceBackend = null
  state.storageDiagnostics = null
  state.lastExportResult = null
  state.lastSonicExportResult = null
}

function resetAnalysisRuntime() {
  state.fftBars = []
  state.fftPeakPercent = 0
  state.dtmfLastKey = "-"
  state.dtmfDetections = []
}

function resetRealtimeStreamRuntime() {
  state.realtimeChunkCount = 0
  state.realtimeChunkBytes = 0
  state.asrChunkCount = 0
  state.asrChunkBytes = 0
}

async function initializeRecorder(targetRecorder, generation) {
  await targetRecorder.use(createLevelMeterPlugin())
  await initializeRecorderPlugins(targetRecorder)
  await targetRecorder.use(
    createAsrExportPlugin({
      format: "pcm",
      encoders: [pcmExportEncoder],
      sampleRate: 16000,
      chunkDurationMs: 40,
    })
  )

  // rebuildRecorder() 期间可能有旧初始化尚未结束；只允许最新一代 recorder 绑定事件。
  if (generation !== recorderInitGeneration || targetRecorder !== recorder) {
    await targetRecorder.destroy()
    return
  }

  recorderDisposers = bindRecorderEvents(targetRecorder)
}

async function rebuildRecorder() {
  const previousRecorder = recorder
  unbindRecorderEvents(recorderDisposers)
  const nextRecorder = createPlaygroundRecorder()
  const generation = ++recorderInitGeneration
  recorder = nextRecorder
  recorderRef.value = nextRecorder
  await initializeRecorder(nextRecorder, generation)
  state.recorderState = nextRecorder.getState()
  if (previousRecorder !== nextRecorder) {
    await previousRecorder.destroy()
  }
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

  const offFft = targetRecorder.on("plugin:fft", ({ payload }) => {
    state.fftBars = Array.from(payload.bars)
    state.fftPeakPercent = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          Math.max(...Array.from(payload.bars, (value) => value ?? 0)) * 100
        )
      )
    )
  })

  const offDtmf = targetRecorder.on("plugin:dtmf:detect", ({ payload }) => {
    state.dtmfLastKey = payload.key
    state.dtmfDetections = [
      {
        key: payload.key,
        durationMs: payload.durationMs,
        startedAtMs: payload.startedAtMs,
      },
      ...state.dtmfDetections,
    ].slice(0, 20)
    appendLog(
      "info",
      localize(
        `DTMF 已识别：${payload.key} · ${Math.round(payload.durationMs)} ms。`,
        `DTMF detected: ${payload.key} · ${Math.round(payload.durationMs)} ms.`
      )
    )
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

  return [
    offStateChange,
    offIssue,
    offFrame,
    offLevel,
    offStream,
    offAsr,
    offFft,
    offDtmf,
  ]
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

function buildSnapshotFromMonoData(pcmData, sampleRate) {
  const frameCount = pcmData.length
  return {
    sampleRate,
    channels: 1,
    frameCount,
    durationMs: frameCount === 0 ? 0 : (frameCount / sampleRate) * 1000,
    planar: [new Int16Array(pcmData)],
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

function buildNmnExportOptions(format) {
  const exportAction = getExportAction(format)
  const options = {}

  if (exportAction?.exportFormat === "amr" && exportAction.bandMode) {
    options.bandMode = exportAction.bandMode
  }

  return Object.keys(options).length > 0 ? options : undefined
}

function isNmnExportFormatSupported(format) {
  const encoder = getExportAction(format)?.encoder
  if (typeof encoder?.isSupportSampleRate !== "function") return true

  return encoder.isSupportSampleRate(
    state.nmnOptions.sampleRate,
    buildNmnExportOptions(format)
  )
}

function buildNmnRequest() {
  return {
    score: state.nmnScore,
    options: { ...state.nmnOptions },
  }
}

function getNmnPreviewKey() {
  return JSON.stringify(buildNmnRequest())
}

function revokeNmnPreviewUrl() {
  if (state.nmnPreviewUrl !== "") {
    URL.revokeObjectURL(state.nmnPreviewUrl)
    state.nmnPreviewUrl = ""
  }
}

function buildNmnArtifacts() {
  const request = buildNmnRequest()
  const nmnResult = nmn2pcm(request.score, request.options)
  const snapshot = buildSnapshotFromMonoData(
    nmnResult.data,
    nmnResult.sampleRate
  )
  const previewResult = wavExportEncoder.export(snapshot)

  return {
    nmnResult,
    snapshot,
    previewResult,
  }
}

function commitNmnPreview(artifacts, previewKey) {
  revokeNmnPreviewUrl()
  latestNmnPreviewKey = previewKey
  state.nmnPreviewUrl = URL.createObjectURL(artifacts.previewResult.blob)
  state.nmnPreviewByteLength = getExportResultByteLength(
    artifacts.previewResult
  )
  state.nmnPreviewDurationMs = artifacts.nmnResult.durationMs
}

function ensureNmnPreviewArtifacts() {
  const previewKey = getNmnPreviewKey()
  if (previewKey === latestNmnPreviewKey && state.nmnPreviewUrl !== "") {
    return
  }

  const artifacts = buildNmnArtifacts()
  commitNmnPreview(artifacts, previewKey)
}

async function generateNmnPreview() {
  await runLoggedAction(
    async () => {
      ensureNmnPreviewArtifacts()
      appendLog(
        "info",
        localize(
          `NMN 预览已生成，${formatBytes(state.nmnPreviewByteLength)}。`,
          `NMN preview generated: ${formatBytes(state.nmnPreviewByteLength)}.`
        )
      )
    },
    "",
    localize("正在生成 NMN 预览...", "Generating NMN preview...")
  )
}

async function exportNmnAudio() {
  const format = state.nmnExportFormat

  await runLoggedAction(
    async () => {
      const { nmnResult, snapshot } = buildNmnArtifacts()
      const exportAction = getExportAction(format)
      if (!exportAction) {
        throw new Error(
          localize(
            `未找到 ${format} 的编码器入口。`,
            `Encoder action for ${format} was not found.`
          )
        )
      }
      if (exportAction.encoder.preload) {
        await exportAction.encoder?.preload()
      }

      const result = exportAction.encoder.export(
        snapshot,
        buildNmnExportOptions(format)
      )
      state.lastNmnExport = {
        format,
        byteLength: getExportResultByteLength(result),
        sampleRate: nmnResult.sampleRate,
        durationMs: nmnResult.durationMs,
      }
      triggerExportDownload(format, result)
      appendLog(
        "info",
        localize(
          `NMN ${format.toUpperCase()} 已生成，${formatBytes(
            state.lastNmnExport.byteLength
          )}。`,
          `Generated NMN ${format.toUpperCase()} export: ${formatBytes(
            state.lastNmnExport.byteLength
          )}.`
        )
      )
    },
    "",
    localize("正在生成 NMN 音频...", "Generating NMN audio...")
  )
}

function getFftBarHeight(bar) {
  if (!Number.isFinite(bar) || bar <= 0) {
    return "0%"
  }

  return `${Math.max(2, Math.round(bar * 100))}%`
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
  revokeNmnPreviewUrl()
  latestNmnPreviewKey = ""
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
          :aria-label="localize('界面语言', 'Interface language')"
          class="locale-switch"
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

          <PlaygroundPluginPanel
            v-model:plugin-config="pluginConfig"
            :analysis-hint="analysisHint"
            :apply-disabled="!canApplyPluginConfig"
            :dsp-hint="dspHint"
            :dsp-plugin-options="DSP_PLUGIN_OPTIONS"
            :is-dirty="pluginConfigDirty"
            :localize="localize"
            :stream-plugin-modes="PLAYGROUND_STREAM_PLUGIN_MODE"
            @apply-plugin-config="applyPluginConfig"
          />
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
              <b>FFT</b><i>{{ state.fftPeakPercent }}%</i>
            </span>
            <span class="live-stat">
              <b>DTMF</b><i>{{ state.dtmfLastKey }}</i>
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

        <section class="center-block">
          <div class="center-block-head">
            <div>
              <p class="section-kicker">
                {{ localize("分析插件", "Analysis Plugins") }}
              </p>
              <h2>{{ localize("频谱与按键识别", "FFT & DTMF") }}</h2>
            </div>
            <span class="badge">{{ analysisPluginBadge }}</span>
          </div>

          <div class="analysis-grid">
            <article class="analysis-card">
              <div class="analysis-card-head">
                <span>plugin:fft</span>
                <strong>{{ state.fftPeakPercent }}%</strong>
              </div>
              <div aria-label="FFT bars" class="fft-strip">
                <span
                  v-for="(bar, index) in fftBarPreview"
                  :key="index"
                  :style="{ height: getFftBarHeight(bar) }"
                  class="fft-bar"
                ></span>
              </div>
              <p class="field-note">
                {{
                  localize(
                    "显示最近一次频谱分析结果；关闭 FFT 插件后这里会回到空态。",
                    "Shows the latest FFT spectrum slice. It returns to idle when the FFT plugin is disabled."
                  )
                }}
              </p>
            </article>

            <article class="analysis-card">
              <div class="analysis-card-head">
                <span>plugin:dtmf:detect</span>
                <strong>{{ state.dtmfLastKey }}</strong>
              </div>
              <div v-if="state.dtmfDetections.length" class="token-pile">
                <span
                  v-for="item in state.dtmfDetections"
                  :key="`${item.key}-${item.startedAtMs}`"
                  class="token-chip"
                >
                  {{ item.key }} · {{ Math.round(item.durationMs) }}ms
                </span>
              </div>
              <p v-else class="field-note">
                {{
                  localize(
                    "暂无识别结果；启用 DTMF 插件后向录音链路输入按键音即可在这里看到最近序列。",
                    "No detections yet. Enable the DTMF plugin and feed keypad tones into the recorder to see recent events here."
                  )
                }}
              </p>
            </article>
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
              getRealtimePluginModeLabel(pluginConfig.streamPluginMode)
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

        <PlaygroundNmnPanel
          :export-format="state.nmnExportFormat"
          :export-format-actions="EXPORT_FORMAT_ACTIONS"
          :export-hint="nmnExportHint"
          :has-preview="hasNmnPreview"
          :is-export-format-supported="isNmnExportFormatSupported"
          :is-preview-stale="isNmnPreviewStale"
          :localize="localize"
          :options="state.nmnOptions"
          :preview-duration-ms="state.nmnPreviewDurationMs"
          :preview-rows="nmnPreviewRows"
          :preview-url="state.nmnPreviewUrl"
          :result-rows="nmnResultRows"
          :score="state.nmnScore"
          :standard-export-sample-rates="STANDARD_EXPORT_SAMPLE_RATES"
          @update:score="state.nmnScore = $event"
          @update:options="state.nmnOptions = $event"
          @update:export-format="state.nmnExportFormat = $event"
          @generate-preview="generateNmnPreview"
          @export-audio="exportNmnAudio"
        />

        <PlaygroundStreamingPlayerPanel
          :locale="locale"
          :localize="localize"
          :recorder="recorderRef"
        />
      </div>

      <PlaygroundDiagnosticsRail
        :diagnostic-groups="diagnosticGroups"
        :diagnostics-raw-view="state.diagnosticsRawView"
        :get-log-type-label="getLogTypeLabel"
        :localize="localize"
        :logs="state.logs"
        :runtime-json="runtimeJson"
        :storage-json="storageJson"
        :summary-json="summaryJson"
        @toggle-raw-view="state.diagnosticsRawView = !state.diagnosticsRawView"
        @clear-logs="state.logs = []"
      />
    </div>
  </main>
</template>
