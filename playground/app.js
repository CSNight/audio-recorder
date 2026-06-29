import {
  computed,
  createApp,
  reactive,
} from "https://unpkg.com/vue@3/dist/vue.esm-browser.js"
import {
  createRecorder,
  listMicrophoneDevices,
  RecorderInputSource,
  RecorderState,
  RecorderWarningCode,
} from "/dist/index.js"
import { createLevelMeterPlugin } from "/dist/plugins/level-meter/index.js"
import { createIndexedDbPersistencePlugin } from "/dist/storage/indexeddb/index.js"
import { createOpfsPersistencePlugin } from "/dist/storage/opfs/index.js"
import { createStreamingExportPlugin } from "/dist/plugins/streaming-export/index.js"
import { createAsrExportPlugin } from "/dist/plugins/asr-export/index.js"
import { createStreamingPlayerPlugin } from "/dist/plugins/streaming-player/index.js"
import {
  pcmStreamEncoder,
  pcmExportEncoder,
  wavDecoderDefinition,
  wavStreamEncoder,
  wavExportEncoder,
} from "/dist/codecs/base/index.js"
import { mp3ExportEncoder } from "/dist/codecs/mp3/index.js"
import { g711ExportEncoder } from "/dist/codecs/g711/index.js"
import { oggExportEncoder, webmExportEncoder } from "/dist/codecs/opus/index.js"
import { flacExportEncoder } from "/dist/codecs/flac/index.js"
import { aacExportEncoder } from "/dist/codecs/aac/index.js"
import { amrExportEncoder } from "/dist/codecs/amr/index.js"

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

createApp({
  setup() {
    const state = reactive({
      sourceMode: PLAYGROUND_SOURCE_MODE.externalTone,
      storageMode: PLAYGROUND_STORAGE_MODE.memory,
      persistenceBackend: PLAYGROUND_PERSISTENCE_BACKEND.indexeddb,
      requestedChannelCount: 1,
      amrBandMode: "nb",
      inputStrategy: "auto", // "auto" | media-recorder | audio-worklet | script-processor
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
      lastExportResult: null, // { pcm, wav } — 上次导出结果，用于下载
      microphoneDevices: [], // MediaDeviceInfo[] — 已枚举的麦克风列表
      selectedDeviceId: "", // "" = 默认麦克风
    })

    let recorder = createPlaygroundRecorder(
      state.storageMode,
      state.persistenceBackend,
      state.memoryThresholdBytes
    )
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
        return "仅使用内存缓冲，不触发持久化溢写。"
      }

      if (state.storageMode === PLAYGROUND_STORAGE_MODE.persistent) {
        return `当前会从录音开始即启用 ${getPersistenceBackendLabel(
          state.persistenceBackend
        )}，并按 ${PLAYGROUND_PERSISTENCE_CHUNK_BYTES} byte 分块持久化。`
      }

      return `当前会在累计 PCM 超过 ${state.memoryThresholdBytes} byte 后尝试切到 ${getPersistenceBackendLabel(
        state.persistenceBackend
      )}，并按 ${PLAYGROUND_PERSISTENCE_CHUNK_BYTES} byte 分块持久化。`
    })

    appendLog(
      "info",
      "Vue playground 已就绪。该页面直接依赖 /dist/index.js，而不是 src 源码。"
    )

    void initializeRecorder()

    async function runLoggedAction(action, successMessage, pendingActionLabel) {
      state.pendingActionLabel = pendingActionLabel ?? "处理中..."
      try {
        await action()
        if (successMessage) {
          appendLog("info", successMessage)
        }
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
          time: new Date().toLocaleTimeString("zh-CN", {
            hour12: false,
          }),
          message,
        },
        ...state.logs,
      ].slice(0, 60)
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
      await recorder.use(
        createStreamingPlayerPlugin({
          source: {
            type: "plugin-event",
            event: "plugin:encoded-chunk",
            format: "wav",
            encoders: [wavDecoderDefinition],
          },
        })
      )
      recorderDisposers = bindRecorderEvents(recorder, state, appendLog)
    }

    async function rebuildRecorder() {
      unbindRecorderEvents(recorderDisposers)
      recorder = createPlaygroundRecorder(
        state.storageMode,
        state.persistenceBackend,
        state.memoryThresholdBytes
      )
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
          currentSource = await createManagedSource(state.sourceMode, appendLog)

          resetRealtimeState()
          state.storageDiagnostics = await collectStorageDiagnostics(
            state.storageMode,
            state.persistenceBackend
          )

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
            `录音器已打开，输入来源：${getSourceModeLabel(state.sourceMode)}，请求声道数：${state.runtimeInfo.requestedChannelCount}，存储模式：${getStorageModeLabel(state.storageMode)}。`
          )

          if (state.sourceMode === PLAYGROUND_SOURCE_MODE.microphone) {
            // 首次授权后再次枚举，以便拿到设备 label（授权前 label 为空字符串）。
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
          }
          state.storageDiagnostics = await collectStorageDiagnostics(
            state.storageMode,
            state.persistenceBackend
          )
          state.activePersistenceBackend =
            state.storageDiagnostics?.persistedEntries > 0
              ? state.storageDiagnostics.backend
              : null
          appendLog(
            "info",
            `录音已停止，共接收 ${state.summary.frames} 帧，累计时长 ${state.summary.durationMs.toFixed(1)}ms，PCM ${pcmResult.data.byteLength} byte，WAV ${wavResult.arrayBuffer.byteLength} byte，MP3 ${mp3Result.data.byteLength} byte，AAC ${aacResult.data.byteLength} byte，AMR ${amrResult.data.byteLength} byte，Opus OGG ${opusOggResult.data.byteLength} byte，FLAC ${flacResult.data.byteLength} byte。`
          )
        },
        "",
        "正在停止并导出..."
      )
    }

    function downloadPCM() {
      const result = state.lastExportResult?.pcm
      if (!result) return
      // PCM 原始数据包装为 Blob 下载
      const blob = new Blob([result.data.buffer], {
        type: "application/octet-stream",
      })
      triggerDownload(
        blob,
        `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitRate}bit.pcm`
      )
      appendLog(
        "info",
        `PCM 文件已下载：${result.sampleRate}Hz ${result.channels}ch ${result.bitRate}bit，${result.data.byteLength} byte。`
      )
    }

    function downloadWAV() {
      const result = state.lastExportResult?.wav
      if (!result) return
      triggerDownload(
        result.blob,
        `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitRate}bit.wav`
      )
      appendLog(
        "info",
        `WAV 文件已下载：${result.sampleRate}Hz ${result.channels}ch ${result.bitRate}bit，${result.arrayBuffer.byteLength} byte。`
      )
    }

    function downloadMP3() {
      const result = state.lastExportResult?.mp3
      if (!result) return
      // MP3 编码结果为 Uint8Array，包装为 Blob 下载
      const blob = new Blob([result.data.buffer], { type: "audio/mpeg" })
      triggerDownload(
        blob,
        `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitrateKbps}kbps.mp3`
      )
      appendLog(
        "info",
        `MP3 文件已下载：${result.sampleRate}Hz ${result.channels}ch ${result.bitrateKbps}kbps，${result.data.byteLength} byte。`
      )
    }

    function downloadG711() {
      const result = state.lastExportResult?.g711
      if (!result) return
      const blob = new Blob([result.data.buffer], { type: "audio/basic" })
      triggerDownload(
        blob,
        `recording_${result.sampleRate}hz_${result.variant}.g711`
      )
      appendLog(
        "info",
        `G.711 文件已下载：${result.sampleRate}Hz ${result.variant}，${result.data.byteLength} byte。`
      )
    }

    function downloadAAC() {
      const result = state.lastExportResult?.aac
      if (!result) return
      const blob = new Blob([result.data.buffer], { type: result.mimeType })
      triggerDownload(
        blob,
        `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitrate}bps.aac`
      )
      appendLog(
        "info",
        `AAC 文件已下载：${result.sampleRate}Hz ${result.channels}ch ${result.bitrate}bps，${result.data.byteLength} byte。`
      )
    }

    function downloadAMR() {
      const result = state.lastExportResult?.amr
      if (!result) return
      const blob = new Blob([result.data.buffer], { type: result.mimeType })
      const extension = result.bandMode === "wb" ? "awb" : "amr"
      triggerDownload(
        blob,
        `recording_${result.sampleRate}hz_${result.bandMode}.${extension}`
      )
      appendLog(
        "info",
        `AMR 文件已下载：${result.sampleRate}Hz ${result.bandMode}，${result.data.byteLength} byte。`
      )
    }

    function downloadOpusOgg() {
      const result = state.lastExportResult?.opusOgg
      if (!result) return
      const blob = new Blob([result.data.buffer], {
        type: "audio/ogg; codecs=opus",
      })
      triggerDownload(
        blob,
        `recording_${result.sampleRate}hz_${result.channels}ch.ogg`
      )
      appendLog(
        "info",
        `Opus OGG 已下载：${result.sampleRate}Hz ${result.channels}ch，${result.data.byteLength} byte。`
      )
    }

    function downloadOpusWebm() {
      const result = state.lastExportResult?.opusWebm
      if (!result) return
      const blob = new Blob([result.data.buffer], {
        type: "audio/webm; codecs=opus",
      })
      triggerDownload(
        blob,
        `recording_${result.sampleRate}hz_${result.channels}ch.webm`
      )
      appendLog(
        "info",
        `Opus WebM 已下载：${result.sampleRate}Hz ${result.channels}ch，${result.data.byteLength} byte。`
      )
    }

    function downloadFLAC() {
      const result = state.lastExportResult?.flac
      if (!result) return
      const blob = new Blob([result.data.buffer], { type: "audio/flac" })
      triggerDownload(
        blob,
        `recording_${result.sampleRate}hz_${result.channels}ch_${result.bitsPerSample}bit.flac`
      )
      appendLog(
        "info",
        `FLAC 已下载：${result.sampleRate}Hz ${result.channels}ch ${result.bitsPerSample}bit，${result.data.byteLength} byte。`
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

    async function closeRecorder() {
      await runLoggedAction(
        async () => {
          await recorder.close()
          await closeManagedSource(currentSource)
          currentSource = null
          state.storageDiagnostics = await collectStorageDiagnostics(
            state.storageMode,
            state.persistenceBackend
          )
          state.activePersistenceBackend =
            state.storageDiagnostics?.persistedEntries > 0
              ? state.storageDiagnostics.backend
              : null
        },
        "录音器已关闭，输入资源已释放。",
        "正在关闭录音器..."
      )
    }

    window.addEventListener("beforeunload", () => {
      unbindRecorderEvents(recorderDisposers)
      void recorder.destroy()
      void closeManagedSource(currentSource)
    })

    return {
      PLAYGROUND_SOURCE_MODE,
      PLAYGROUND_PERSISTENCE_BACKEND,
      PLAYGROUND_STORAGE_MODE,
      RecorderState,
      canChangeStorageMode,
      canClose,
      canOpen,
      canStart,
      canPause,
      canResume,
      canStop,
      downloadAAC,
      downloadAMR,
      closeRecorder,
      downloadG711,
      downloadMP3,
      downloadOpusOgg,
      downloadOpusWebm,
      downloadFLAC,
      downloadPCM,
      downloadWAV,
      handleSourceModeChange,
      handleStorageModeChange,
      openRecorder,
      pauseRecorder,
      refreshMicrophoneDevices,
      resumeRecorder,
      runtimeJson,
      startRecorder,
      state,
      stopRecorder,
      storageHint,
      storageJson,
      summaryJson,
    }
  },
}).mount("#app")

function bindRecorderEvents(recorder, state, appendLog) {
  const offStateChange = recorder.on("statechange", ({ state: nextState }) => {
    state.recorderState = nextState
  })
  const offIssue = recorder.on("issue", ({ issue }) => {
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

  const offStream = recorder.on("plugin:encoded-chunk", (e) => {
    state.realtimeChunkCount += 1
    state.realtimeChunkBytes += e.payload.chunk.byteLength
    console.log(e)
  })
  const offAsr = recorder.on("plugin:asr:chunk", ({ payload }) => {
    state.asrChunkCount += 1
    state.asrChunkBytes += payload.chunk.byteLength
  })
  const offFrame = recorder.on(
    "frame:async",
    ({ frame, runtimeInfo, summary }) => {
      state.frameCount += 1
      state.lastFrameDurationMs = frame.durationMs
      state.runtimeInfo = runtimeInfo
      state.summary = summary
    }
  )
  const offLevel = recorder.on("plugin:level", ({ payload }) => {
    state.levelPercent = Math.max(
      0,
      Math.min(100, Math.round(payload.level.rms * 180))
    )
  })

  return [offStateChange, offIssue, offFrame, offLevel, offStream, offAsr]
}

function unbindRecorderEvents(disposers) {
  for (const dispose of disposers) {
    dispose()
  }
}

function createPlaygroundRecorder(
  storageMode,
  persistenceBackend,
  memoryThresholdBytes
) {
  const persistencePluginFactory =
    PERSISTENCE_PLUGIN_FACTORIES[persistenceBackend]
  return createRecorder({
    storage: createPlaygroundStorageOptions(
      storageMode,
      memoryThresholdBytes,
      persistencePluginFactory
    ),
    encoders: [
      pcmExportEncoder,
      wavExportEncoder,
      mp3ExportEncoder,
      g711ExportEncoder,
      aacExportEncoder,
      amrExportEncoder,
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
  switch (backend) {
    case PLAYGROUND_PERSISTENCE_BACKEND.opfs:
      return "OPFS"
    default:
      return "IndexedDB"
  }
}

function createPlaygroundStorageOptions(
  storageMode,
  memoryThresholdBytes,
  persistencePluginFactory
) {
  if (storageMode === PLAYGROUND_STORAGE_MODE.memory) {
    return {
      mode: "memory",
    }
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

async function closeManagedSource(currentSource) {
  if (!currentSource) {
    return
  }

  await currentSource.dispose()
}

async function createManagedSource(mode, appendLog) {
  if (mode === PLAYGROUND_SOURCE_MODE.microphone) {
    return {
      stream: null,
      dispose: async () => {},
    }
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

async function collectStorageDiagnostics(storageMode, persistenceBackend) {
  if (storageMode === PLAYGROUND_STORAGE_MODE.memory) {
    return {
      backend: "memory",
      persistedEntries: 0,
      bytes: 0,
    }
  }

  switch (persistenceBackend) {
    case PLAYGROUND_PERSISTENCE_BACKEND.indexeddb:
      return inspectIndexedDbStorage()
    case PLAYGROUND_PERSISTENCE_BACKEND.opfs:
      return inspectOpfsStorage()
    default:
      return {
        backend: "memory",
        persistedEntries: 0,
        bytes: 0,
      }
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
    const request = indexedDB.open("audio-recorder", 1)
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
      if (entry instanceof ArrayBuffer) {
        bytes += entry.byteLength
      }
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
    baseDirectory = await root.getDirectoryHandle("audio-recorder")
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
    if (handle.kind !== "directory") {
      continue
    }

    for await (const [name, childHandle] of handle.entries()) {
      if (childHandle.kind !== "file" || !name.endsWith(".bin")) {
        continue
      }

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
