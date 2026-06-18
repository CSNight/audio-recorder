export interface RecorderCapabilityReport {
  hasAudioContext: boolean
  hasGetUserMedia: boolean
  hasAudioWorklet: boolean
  hasMediaRecorderWebMPcm: boolean
  hasScriptProcessor: boolean
  expectedInputStrategy: "audio-worklet" | "script-processor" | "unsupported"
}

/**
 * 纯同步、无副作用的能力检测。只检测构造函数/静态方法是否存在，
 * 不实例化任何对象，不请求任何权限。
 */
export function checkRecorderCapability(): RecorderCapabilityReport {
  const scope = globalThis as typeof globalThis & {
    AudioContext?: unknown
    webkitAudioContext?: unknown
    AudioWorkletNode?: unknown
    MediaRecorder?: {
      isTypeSupported?: (type: string) => boolean
    }
  }

  const hasAudioContext =
    typeof scope.AudioContext !== "undefined" ||
    typeof scope.webkitAudioContext !== "undefined"

  const hasGetUserMedia =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"

  const hasAudioWorklet = typeof scope.AudioWorkletNode !== "undefined"

  const hasMediaRecorderWebMPcm =
    typeof scope.MediaRecorder !== "undefined" &&
    typeof scope.MediaRecorder.isTypeSupported === "function" &&
    scope.MediaRecorder.isTypeSupported("audio/webm; codecs=pcm")

  const hasScriptProcessor =
    hasAudioContext &&
    typeof (
      globalThis as typeof globalThis & {
        AudioContext?: { prototype?: { createScriptProcessor?: unknown } }
      }
    ).AudioContext?.prototype?.createScriptProcessor === "function"

  let expectedInputStrategy: RecorderCapabilityReport["expectedInputStrategy"]
  if (!hasAudioContext || !hasGetUserMedia) {
    expectedInputStrategy = "unsupported"
  } else if (hasAudioWorklet) {
    expectedInputStrategy = "audio-worklet"
  } else {
    expectedInputStrategy = "script-processor"
  }

  return {
    hasAudioContext,
    hasGetUserMedia,
    hasAudioWorklet,
    hasMediaRecorderWebMPcm,
    hasScriptProcessor,
    expectedInputStrategy,
  }
}
