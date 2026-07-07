import { computed } from "vue"
import { RecorderState } from "@csnight/audio-recorder"
import {
  EXPORT_FORMAT_ACTIONS,
  PLAYGROUND_PERSISTENCE_CHUNK_BYTES,
  PLAYGROUND_STORAGE_MODE,
} from "../playground-constants.js"
import {
  formatBytes,
  getExportAction,
  getExportResultByteLength,
  getInputStrategyLabel,
  getPersistenceBackendLabel,
  getRecorderBadgeClass,
  getRecorderStateLabel,
  getSourceModeLabel,
  getStorageModeLabel,
  toKvRows,
} from "../playground-utils.js"

export function usePlaygroundViewState({
  state,
  pluginConfig,
  localize,
  getNmnPreviewKey,
  getLatestNmnPreviewKey,
}) {
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
      value: getRecorderStateLabel(localize, state.recorderState),
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
        localize,
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

  const stateBadgeText = computed(
    () =>
      state.pendingActionLabel ||
      getRecorderStateLabel(localize, state.recorderState)
  )

  const stateBadgeClass = computed(() =>
    getRecorderBadgeClass(state.recorderState)
  )

  const headerContextChips = computed(() => [
    getSourceModeLabel(localize, state.sourceMode),
    getStorageModeLabel(localize, state.storageMode),
    state.storageMode === PLAYGROUND_STORAGE_MODE.memory
      ? localize("纯内存", "Memory")
      : getPersistenceBackendLabel(state.persistenceBackend),
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
    Array.from(
      { length: Math.max(12, pluginConfig.fftBarCount) },
      (_, index) => {
        return state.fftBars[index] ?? 0
      }
    )
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
    () => hasNmnPreview.value && getLatestNmnPreviewKey() !== getNmnPreviewKey()
  )

  const canOpen = computed(
    () =>
      state.pendingActionLabel === "" &&
      [RecorderState.Idle, RecorderState.Closed].includes(state.recorderState)
  )

  const canStart = computed(
    () =>
      state.pendingActionLabel === "" &&
      [RecorderState.Ready, RecorderState.Stopped].includes(state.recorderState)
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

  const combinedExportStats = computed(() => [
    ...exportStats.value,
    ...sonicExportStats.value,
  ])

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

  return {
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
  }
}
