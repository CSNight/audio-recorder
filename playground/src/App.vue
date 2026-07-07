<script setup>
import { onBeforeUnmount, reactive, ref } from "vue"
import PlaygroundAnalysisPanel from "./components/PlaygroundAnalysisPanel.vue"
import PlaygroundDiagnosticsRail from "./components/PlaygroundDiagnosticsRail.vue"
import PlaygroundExportPanel from "./components/PlaygroundExportPanel.vue"
import PlaygroundHeaderBar from "./components/PlaygroundHeaderBar.vue"
import PlaygroundNmnPanel from "./components/PlaygroundNmnPanel.vue"
import PlaygroundRecorderConsole from "./components/PlaygroundRecorderConsole.vue"
import PlaygroundSetupRail from "./components/PlaygroundSetupRail.vue"
import PlaygroundStreamingPlayerPanel from "./components/PlaygroundStreamingPlayerPanel.vue"
import {
  createRecorder,
  listMicrophoneDevices,
  RecorderState,
  RecorderWarningCode,
} from "@csnight/audio-recorder"
import { createLevelMeterPlugin } from "@csnight/audio-recorder/plugins/level-meter"
import { createAsrExportPlugin } from "@csnight/audio-recorder/plugins/asr-export"
import { createSonicExportPlugin } from "@csnight/audio-recorder/plugins/sonic-export"
import {
  DEFAULT_NMN_OPTIONS,
  nmn2pcm,
} from "@csnight/audio-recorder/plugins/nmn2pcm"
import { wavExportEncoder } from "@csnight/audio-recorder/codecs/base"
import {
  DSP_PLUGIN_OPTIONS,
  PLAYGROUND_STREAM_PLUGIN_MODE,
  usePlaygroundPluginManager,
} from "./composables/usePlaygroundPluginManager.js"
import { usePlaygroundViewState } from "./composables/usePlaygroundViewState.js"
import {
  EXPORT_FORMAT_ACTIONS,
  LOCALE_OPTIONS,
  PERSISTENCE_PLUGIN_FACTORIES,
  PLAYGROUND_LOCALE,
  PLAYGROUND_PERSISTENCE_BACKEND,
  PLAYGROUND_PERSISTENCE_CHUNK_BYTES,
  PLAYGROUND_SOURCE_MODE,
  PLAYGROUND_STORAGE_MODE,
  STANDARD_EXPORT_SAMPLE_RATES,
} from "./playground-constants.js"
import {
  formatBytes,
  getExportAction,
  getExportFormatLabel,
  getExportResultByteLength,
  getLogTypeLabel,
  getSourceModeLabel,
  getStorageModeLabel,
} from "./playground-utils.js"
import {
  pcmStreamEncoder,
  wavStreamEncoder,
} from "@csnight/audio-recorder/codecs/base"

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

const {
  analysisPluginBadge,
  buildExportOptions,
  canChangeStorageMode,
  canClose,
  canExportAudio,
  canOpen,
  canPause,
  canResume,
  canStart,
  canStop,
  combinedExportStats,
  diagnosticGroups,
  exportActions,
  exportHint,
  fftBarPreview,
  hasExportResult,
  hasNmnPreview,
  headerContextChips,
  isExportFormatSupported,
  isNmnPreviewStale,
  nmnExportHint,
  nmnPreviewRows,
  nmnResultRows,
  runtimeJson,
  stateBadgeClass,
  stateBadgeText,
  storageHint,
  storageJson,
  summaryJson,
  topMetrics,
} = usePlaygroundViewState({
  state,
  pluginConfig,
  localize,
  getNmnPreviewKey,
  getLatestNmnPreviewKey: () => latestNmnPreviewKey,
})

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
  const pcmAsrEncoder = getExportAction("pcm")?.encoder
  if (!pcmAsrEncoder) {
    throw new Error(
      localize(
        "未找到 PCM 编码器，无法初始化 ASR 导出插件。",
        "PCM encoder is missing, so the ASR export plugin cannot be initialized."
      )
    )
  }

  await targetRecorder.use(createLevelMeterPlugin())
  await initializeRecorderPlugins(targetRecorder)
  await targetRecorder.use(
    createAsrExportPlugin({
      format: "pcm",
      encoders: [pcmAsrEncoder],
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
      // 从 Stopped 重新开始时清理上一段录音的显示状态，避免旧数据残留在 UI 上。
      // summary、exportedBytes、导出结果等均在新录音的对应事件中重新赋值。
      if (state.recorderState === RecorderState.Stopped) {
        state.summary = null
        state.frameCount = 0
        state.lastFrameDurationMs = 0
        state.levelPercent = 0
        state.exportedBytes = null
        state.lastExportResult = null
        state.lastSonicExportResult = null
        resetAnalysisRuntime()
        resetRealtimeStreamRuntime()
        state.storageDiagnostics = null
      }
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
          ? EXPORT_FORMAT_ACTIONS.find((v) => v.type === "wav").encoder?.export(
              transformedSnapshot,
              buildExportOptions("wav")
            )
          : EXPORT_FORMAT_ACTIONS.find((v) => v.type === "pcm").encoder?.export(
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
    encoders: EXPORT_FORMAT_ACTIONS.map((v) => v.encoder),
  })
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
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
    <PlaygroundHeaderBar
      :badge-class="stateBadgeClass"
      :badge-text="stateBadgeText"
      :context-chips="headerContextChips"
      :is-pending-action="state.pendingActionLabel !== ''"
      :locale="locale"
      :locale-options="LOCALE_OPTIONS"
      :localize="localize"
      :metrics="topMetrics"
      @update:locale="setLocale"
    />

    <div class="workspace">
      <PlaygroundSetupRail
        :analysis-hint="analysisHint"
        :can-apply-plugin-config="canApplyPluginConfig"
        :can-change-storage-mode="canChangeStorageMode"
        :dsp-hint="dspHint"
        :dsp-plugin-options="DSP_PLUGIN_OPTIONS"
        :input-strategy="state.inputStrategy"
        :localize="localize"
        :memory-threshold-bytes="state.memoryThresholdBytes"
        :microphone-devices="state.microphoneDevices"
        :persistence-backend="state.persistenceBackend"
        :persistence-backend-options="PLAYGROUND_PERSISTENCE_BACKEND"
        :plugin-config="pluginConfig"
        :plugin-config-dirty="pluginConfigDirty"
        :requested-channel-count="state.requestedChannelCount"
        :selected-device-id="state.selectedDeviceId"
        :source-mode="state.sourceMode"
        :source-mode-options="PLAYGROUND_SOURCE_MODE"
        :storage-hint="storageHint"
        :storage-mode="state.storageMode"
        :storage-mode-options="PLAYGROUND_STORAGE_MODE"
        :stream-plugin-modes="PLAYGROUND_STREAM_PLUGIN_MODE"
        @apply-plugin-config="applyPluginConfig"
        @refresh-microphone-devices="refreshMicrophoneDevices"
        @source-mode-change="handleSourceModeChange"
        @storage-mode-change="handleStorageModeChange"
        @update:input-strategy="state.inputStrategy = $event"
        @update:memory-threshold-bytes="state.memoryThresholdBytes = $event"
        @update:persistence-backend="state.persistenceBackend = $event"
        @update:plugin-config="Object.assign(pluginConfig, $event)"
        @update:requested-channel-count="state.requestedChannelCount = $event"
        @update:selected-device-id="state.selectedDeviceId = $event"
        @update:source-mode="state.sourceMode = $event"
        @update:storage-mode="state.storageMode = $event"
      />

      <div class="rail rail-center">
        <div class="rail-head">
          <span class="rail-title">session.ctrl</span>
          <span class="rail-meta">{{
            localize("控制 / 导出 / 播放器", "actions / export / player")
          }}</span>
        </div>

        <PlaygroundRecorderConsole
          :asr-chunk-bytes="state.asrChunkBytes"
          :badge-class="stateBadgeClass"
          :badge-text="stateBadgeText"
          :can-close="canClose"
          :can-open="canOpen"
          :can-pause="canPause"
          :can-resume="canResume"
          :can-start="canStart"
          :can-stop="canStop"
          :dtmf-last-key="state.dtmfLastKey"
          :exported-bytes="state.exportedBytes"
          :fft-peak-percent="state.fftPeakPercent"
          :frame-count="state.frameCount"
          :has-export-result="hasExportResult"
          :is-pending-action="state.pendingActionLabel !== ''"
          :level-percent="state.levelPercent"
          :localize="localize"
          :realtime-chunk-bytes="state.realtimeChunkBytes"
          @close="closeRecorder"
          @open="openRecorder"
          @pause="pauseRecorder"
          @resume="resumeRecorder"
          @start="startRecorder"
          @stop="stopRecorder"
        />

        <PlaygroundAnalysisPanel
          :badge-text="analysisPluginBadge"
          :dtmf-detections="state.dtmfDetections"
          :dtmf-last-key="state.dtmfLastKey"
          :fft-bars="fftBarPreview"
          :fft-peak-percent="state.fftPeakPercent"
          :localize="localize"
        />

        <PlaygroundExportPanel
          :can-export-audio="canExportAudio"
          :export-actions="exportActions"
          :export-hint="exportHint"
          :export-sample-rate-input="state.exportSampleRateInput"
          :exported-bytes="state.exportedBytes"
          :has-export-result="hasExportResult"
          :localize="localize"
          :result-rows="combinedExportStats"
          :standard-export-sample-rates="STANDARD_EXPORT_SAMPLE_RATES"
          :stream-plugin-mode-label="
            getRealtimePluginModeLabel(pluginConfig.streamPluginMode)
          "
          @export-audio="exportAudio"
          @export-sonic-snapshot="exportSonicSnapshot"
          @update:export-sample-rate-input="
            state.exportSampleRateInput = $event
          "
        />

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
        :get-log-type-label="(type) => getLogTypeLabel(localize, type)"
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
