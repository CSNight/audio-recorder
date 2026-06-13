import {
  computed,
  createApp,
  reactive,
} from "https://unpkg.com/vue@3/dist/vue.esm-browser.js"
import {
  createRecorder,
  RecorderInputSource,
  RecorderState,
  RecorderWarningCode,
} from "/dist/index.js"

const PLAYGROUND_SOURCE_MODE = {
  microphone: RecorderInputSource.Microphone,
  externalTone: "external-tone",
}

const recorder = createRecorder()
let currentSource = null

createApp({
  setup() {
    const state = reactive({
      sourceMode: PLAYGROUND_SOURCE_MODE.externalTone,
      requestedChannelCount: 2,
      recorderState: RecorderState.Idle,
      runtimeInfo: null,
      summary: null,
      frameCount: 0,
      lastFrameDurationMs: 0,
      levelPercent: 0,
      logs: [],
    })

    const runtimeJson = computed(() =>
      JSON.stringify(
        {
          runtimeInfo: state.runtimeInfo,
          lastFrameDurationMs: state.lastFrameDurationMs,
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
        },
        null,
        2
      )
    )
    const canOpen = computed(
      () =>
        state.recorderState === RecorderState.Idle ||
        state.recorderState === RecorderState.Closed
    )
    const canStart = computed(() => state.recorderState === RecorderState.Ready)
    const canPause = computed(
      () => state.recorderState === RecorderState.Recording
    )
    const canResume = computed(
      () => state.recorderState === RecorderState.Paused
    )
    const canStop = computed(
      () =>
        state.recorderState === RecorderState.Recording ||
        state.recorderState === RecorderState.Paused
    )
    const canClose = computed(() =>
      [
        RecorderState.Ready,
        RecorderState.Recording,
        RecorderState.Paused,
        RecorderState.Stopped,
      ].includes(state.recorderState)
    )

    recorder.on("statechange", ({ state: nextState }) => {
      state.recorderState = nextState
    })
    recorder.on("issue", ({ issue }) => {
      if (issue.kind === "warning") {
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
    recorder.on("frame", ({ frame, runtimeInfo, summary }) => {
      state.frameCount += 1
      state.lastFrameDurationMs = frame.durationMs
      state.runtimeInfo = runtimeInfo
      state.summary = summary
      state.levelPercent = measureLevel(frame)
    })

    appendLog(
      "info",
      "Vue playground 已就绪。该页面直接依赖 /dist/index.js，而不是 src 源码。"
    )

    async function runLoggedAction(action, successMessage) {
      try {
        await action()
        if (successMessage) {
          appendLog("info", successMessage)
        }
      } catch (error) {
        appendLog("error", formatError(error))
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
      ].slice(0, 40)
    }

    function getSourceModeLabel(mode) {
      return mode === PLAYGROUND_SOURCE_MODE.externalTone
        ? "外部音调流"
        : "麦克风"
    }

    async function openRecorder() {
      await runLoggedAction(async () => {
        await closeManagedSource()
        currentSource = await createManagedSource(state.sourceMode, appendLog)

        const openOptions =
          currentSource.stream !== null
            ? {
                sourceStream: currentSource.stream,
                capture: {
                  channelCount: state.requestedChannelCount,
                  echoCancellation: false,
                  noiseSuppression: false,
                  autoGainControl: false,
                  ...(currentSource.sampleRate !== undefined && {
                    sampleRate: currentSource.sampleRate,
                  }),
                },
              }
            : {
                capture: {
                  channelCount: state.requestedChannelCount,
                  echoCancellation: false,
                  noiseSuppression: false,
                  autoGainControl: false,
                },
              }

        state.runtimeInfo = await recorder.open(openOptions)
        state.summary = null
        state.frameCount = 0
        state.lastFrameDurationMs = 0
        state.levelPercent = 0
        appendLog(
          "info",
          `录音器已打开，输入来源：${getSourceModeLabel(state.sourceMode)}，请求声道数：${state.runtimeInfo.requestedChannelCount}。`
        )
      })
    }

    async function startRecorder() {
      await runLoggedAction(async () => {
        state.runtimeInfo = await recorder.start()
      }, "录音已开始。")
    }

    async function pauseRecorder() {
      await runLoggedAction(() => {
        recorder.pause()
      }, "录音已暂停。")
    }

    async function resumeRecorder() {
      await runLoggedAction(async () => {
        state.runtimeInfo = await recorder.resume()
      }, "录音已恢复。")
    }

    async function stopRecorder() {
      await runLoggedAction(async () => {
        state.summary = await recorder.stop()
        appendLog(
          "info",
          `录音已停止，共接收 ${state.summary.frames} 帧，累计时长 ${state.summary.durationMs.toFixed(1)}ms。`
        )
      })
    }

    async function closeRecorder() {
      await runLoggedAction(async () => {
        await recorder.close()
        await closeManagedSource()
      }, "录音器已关闭，输入资源已释放。")
    }

    window.addEventListener("beforeunload", () => {
      void closeManagedSource()
    })

    return {
      PLAYGROUND_SOURCE_MODE,
      RecorderState,
      canClose,
      canOpen,
      canPause,
      canResume,
      canStart,
      canStop,
      closeRecorder,
      openRecorder,
      pauseRecorder,
      resumeRecorder,
      runtimeJson,
      startRecorder,
      state,
      stopRecorder,
      summaryJson,
    }
  },
}).mount("#app")

function measureLevel(frame) {
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

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}

async function closeManagedSource() {
  if (!currentSource) {
    return
  }

  await currentSource.dispose()
  currentSource = null
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
