import { computed, reactive, ref } from "vue"
import { RecorderState } from "@csnight/audio-recorder"
import { createStreamingExportPlugin } from "@csnight/audio-recorder/plugins/streaming-export"
import { createSonicExportPlugin } from "@csnight/audio-recorder/plugins/sonic-export"
import { createDtmfDecoderPlugin } from "@csnight/audio-recorder/plugins/dtmf"
import {
  createHighpassPlugin,
  createLowpassPlugin,
  createNoiseGatePlugin,
} from "@csnight/audio-recorder/plugins/dsp"
import { createFrequencyHistogramPlugin } from "@csnight/audio-recorder/plugins/frequency-histogram"
import {
  pcmStreamEncoder,
  wavStreamEncoder,
} from "@csnight/audio-recorder/codecs/base"

export const PLAYGROUND_STREAM_PLUGIN_MODE = {
  streaming: "streaming-export",
  sonic: "sonic-export",
}

const PLAYGROUND_DSP_PLUGIN = {
  highpass: "highpass",
  lowpass: "lowpass",
  noiseGate: "noise-gate",
}

const PLAYGROUND_ANALYSIS_PLUGIN = {
  fft: "frequency-histogram",
  dtmf: "dtmf-decoder",
}

export const DSP_PLUGIN_OPTIONS = [
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

export function createDefaultPluginConfig() {
  return {
    streamPluginMode: PLAYGROUND_STREAM_PLUGIN_MODE.streaming,
    streamPluginFormat: "pcm",
    enableFftPlugin: true,
    enableDtmfPlugin: false,
    enableHighpass: false,
    enableLowpass: false,
    enableNoiseGate: false,
    fftSize: 2048,
    fftBarCount: 48,
    fftFrameInterval: 1,
    dtmfFrameWindowMs: 20,
    dtmfMinToneMs: 20,
    dtmfMinGapMs: 20,
    dtmfEnergyThreshold: 0.01,
    sonicSpeed: 1,
    sonicPitch: 1,
    sonicRate: 1,
    sonicVolume: 1,
    sonicBlockMs: 200,
  }
}

function serializePluginConfig(pluginConfig) {
  return JSON.stringify({
    streamPluginMode: pluginConfig.streamPluginMode,
    streamPluginFormat: pluginConfig.streamPluginFormat,
    enableFftPlugin: pluginConfig.enableFftPlugin,
    enableDtmfPlugin: pluginConfig.enableDtmfPlugin,
    enableHighpass: pluginConfig.enableHighpass,
    enableLowpass: pluginConfig.enableLowpass,
    enableNoiseGate: pluginConfig.enableNoiseGate,
    fftSize: pluginConfig.fftSize,
    fftBarCount: pluginConfig.fftBarCount,
    fftFrameInterval: pluginConfig.fftFrameInterval,
    dtmfFrameWindowMs: pluginConfig.dtmfFrameWindowMs,
    dtmfMinToneMs: pluginConfig.dtmfMinToneMs,
    dtmfMinGapMs: pluginConfig.dtmfMinGapMs,
    dtmfEnergyThreshold: pluginConfig.dtmfEnergyThreshold,
    sonicSpeed: pluginConfig.sonicSpeed,
    sonicPitch: pluginConfig.sonicPitch,
    sonicRate: pluginConfig.sonicRate,
    sonicVolume: pluginConfig.sonicVolume,
    sonicBlockMs: pluginConfig.sonicBlockMs,
  })
}

async function unusePlugin(targetRecorder, pluginName) {
  try {
    await targetRecorder.unuse(pluginName)
  } catch (error) {
    if (!String(error).includes("is not registered")) {
      throw error
    }
  }
}

export function usePlaygroundPluginManager({
  localize,
  appendLog,
  runLoggedAction,
  getRecorder,
  getRecorderState,
  getPendingActionLabel,
  resetAnalysisRuntime,
  resetRealtimeStreamRuntime,
}) {
  const pluginConfig = reactive(createDefaultPluginConfig())
  const appliedPluginConfigSnapshot = ref(serializePluginConfig(pluginConfig))

  const enabledAnalysisPlugins = computed(() => {
    const enabled = []
    if (pluginConfig.enableFftPlugin) enabled.push("FFT")
    if (pluginConfig.enableDtmfPlugin) enabled.push("DTMF")
    return enabled
  })

  const selectedDspPluginLabels = computed(() =>
    DSP_PLUGIN_OPTIONS.filter((option) => pluginConfig[option.key]).map(
      (option) => localize(option.label.zh, option.label.en)
    )
  )

  const analysisHint = computed(() => {
    if (enabledAnalysisPlugins.value.length === 0) {
      return localize(
        "当前未挂载分析插件。启用后可在录音过程中得到频谱和按键识别结果，不会改写主录音链路。",
        "No analysis plugins are mounted. Enable them to inspect FFT and DTMF data during recording without altering the main recorder path."
      )
    }

    return localize(
      `当前已选择：${enabledAnalysisPlugins.value.join(" / ")}。修改会先暂存，点击“统一应用插件”后才会重挂分析插件。`,
      `Selected: ${enabledAnalysisPlugins.value.join(" / ")}. Changes are staged until you click Apply All Plugins.`
    )
  })

  const dspHint = computed(() => {
    if (selectedDspPluginLabels.value.length === 0) {
      return localize(
        "当前未启用 DSP。启用后会把处理结果写入主录音链路，并影响实时流、快照与最终导出。",
        "DSP is currently disabled. Once enabled, processed frames affect the main recorder path, live stream, snapshots, and exports."
      )
    }

    return localize(
      `当前已选：${selectedDspPluginLabels.value.join(" / ")}。修改会先暂存，点击“统一应用插件”后才会重挂 DSP 管线。`,
      `Selected: ${selectedDspPluginLabels.value.join(" / ")}. Changes are staged until you click Apply All Plugins.`
    )
  })

  const pluginConfigDirty = computed(
    () =>
      serializePluginConfig(pluginConfig) !== appliedPluginConfigSnapshot.value
  )

  const canApplyPluginConfig = computed(
    () =>
      getPendingActionLabel() === "" &&
      getRecorderState() === RecorderState.Idle
  )

  function getRealtimePluginModeLabel(mode = pluginConfig.streamPluginMode) {
    return mode === PLAYGROUND_STREAM_PLUGIN_MODE.sonic
      ? "Sonic Export"
      : "Streaming Export"
  }

  function markPluginConfigApplied() {
    appliedPluginConfigSnapshot.value = serializePluginConfig(pluginConfig)
  }

  async function applySelectedDspPlugins(targetRecorder) {
    for (const option of DSP_PLUGIN_OPTIONS) {
      if (!pluginConfig[option.key]) {
        continue
      }

      await targetRecorder.use(option.createPlugin())
    }
  }

  async function applySelectedAnalysisPlugins(targetRecorder) {
    if (pluginConfig.enableFftPlugin) {
      await targetRecorder.use(
        createFrequencyHistogramPlugin({
          fftSize: pluginConfig.fftSize,
          barCount: pluginConfig.fftBarCount,
          frameInterval: pluginConfig.fftFrameInterval,
        })
      )
    }

    if (pluginConfig.enableDtmfPlugin) {
      await targetRecorder.use(
        createDtmfDecoderPlugin({
          frameWindowMs: pluginConfig.dtmfFrameWindowMs,
          minToneMs: pluginConfig.dtmfMinToneMs,
          minGapMs: pluginConfig.dtmfMinGapMs,
          energyThreshold: pluginConfig.dtmfEnergyThreshold,
        })
      )
    }
  }

  function createSelectedRealtimeStreamPlugin() {
    if (pluginConfig.streamPluginMode === PLAYGROUND_STREAM_PLUGIN_MODE.sonic) {
      return createSonicExportPlugin({
        format: pluginConfig.streamPluginFormat,
        encoders: [pcmStreamEncoder, wavStreamEncoder],
        encoderOptions:
          pluginConfig.streamPluginFormat === "wav"
            ? { framesPerChunk: 4 }
            : undefined,
        allowMainThreadFallback: true,
        speed: pluginConfig.sonicSpeed,
        pitch: pluginConfig.sonicPitch,
        rate: pluginConfig.sonicRate,
        volume: pluginConfig.sonicVolume,
        blockMs: pluginConfig.sonicBlockMs,
      })
    }

    return createStreamingExportPlugin({
      format: pluginConfig.streamPluginFormat,
      encoders: [wavStreamEncoder, pcmStreamEncoder],
      encoderOptions:
        pluginConfig.streamPluginFormat === "wav"
          ? { framesPerChunk: 4 }
          : undefined,
      allowMainThreadFallback: true,
    })
  }

  async function mountSelectedPlugins(targetRecorder) {
    await applySelectedAnalysisPlugins(targetRecorder)
    await applySelectedDspPlugins(targetRecorder)
    await targetRecorder.use(createSelectedRealtimeStreamPlugin())
  }

  async function clearMountedPlugins(targetRecorder) {
    await unusePlugin(targetRecorder, "dsp")

    for (const pluginName of Object.values(PLAYGROUND_ANALYSIS_PLUGIN)) {
      await unusePlugin(targetRecorder, pluginName)
    }

    await unusePlugin(targetRecorder, "streaming-export")
    await unusePlugin(targetRecorder, "sonic-export")
  }

  function buildPluginSummary() {
    const analysisSummary =
      enabledAnalysisPlugins.value.length > 0
        ? enabledAnalysisPlugins.value.join(" / ")
        : localize("无", "None")
    const dspSummary =
      selectedDspPluginLabels.value.length > 0
        ? selectedDspPluginLabels.value.join(" / ")
        : localize("无", "None")
    const streamSummary = `${getRealtimePluginModeLabel()} · ${pluginConfig.streamPluginFormat.toUpperCase()}`

    return {
      zh: `实时流 ${streamSummary}；分析 ${analysisSummary}；DSP ${dspSummary}`,
      en: `stream ${streamSummary}; analysis ${analysisSummary}; DSP ${dspSummary}`,
    }
  }

  async function initializeRecorderPlugins(targetRecorder) {
    await mountSelectedPlugins(targetRecorder)
    markPluginConfigApplied()
  }

  async function applyPluginConfig() {
    if (getPendingActionLabel() !== "") {
      appendLog(
        "warning",
        localize(
          "请等待当前操作完成后，再统一应用插件配置。",
          "Wait for the current action to finish before applying plugin configuration."
        )
      )
      return
    }

    if (getRecorderState() !== RecorderState.Idle) {
      appendLog(
        "warning",
        localize(
          "插件配置只允许在 idle 状态下统一应用。",
          "Plugin configuration can only be applied while the recorder is idle."
        )
      )
      return
    }

    if (!pluginConfigDirty.value) {
      return
    }

    await runLoggedAction(
      async () => {
        const targetRecorder = getRecorder()

        // 统一卸载并重挂三类插件，避免每个分区各自维护不同的应用入口。
        await clearMountedPlugins(targetRecorder)
        await mountSelectedPlugins(targetRecorder)
        resetAnalysisRuntime()
        resetRealtimeStreamRuntime()
        markPluginConfigApplied()

        const pluginSummary = buildPluginSummary()
        appendLog(
          "info",
          localize(
            `已统一应用插件配置：${pluginSummary.zh}。`,
            `Applied plugin configuration: ${pluginSummary.en}.`
          )
        )
      },
      "",
      localize("正在统一应用插件配置...", "Applying plugin configuration...")
    )
  }

  function buildSonicTransformOptions() {
    return {
      speed: pluginConfig.sonicSpeed,
      pitch: pluginConfig.sonicPitch,
      rate: pluginConfig.sonicRate,
      volume: pluginConfig.sonicVolume,
      blockMs: pluginConfig.sonicBlockMs,
    }
  }

  return {
    pluginConfig,
    analysisHint,
    dspHint,
    pluginConfigDirty,
    canApplyPluginConfig,
    initializeRecorderPlugins,
    applyPluginConfig,
    buildSonicTransformOptions,
    getRealtimePluginModeLabel,
  }
}
