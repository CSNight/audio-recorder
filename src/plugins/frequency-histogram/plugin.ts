import type { RecorderPlugin } from "../types"
import { analyzeFrequencyBars, resolveFrequencyHistogramOptions } from "./fft"
import type { FrequencyHistogramOptions } from "./types"

export function createFrequencyHistogramPlugin(
  options: FrequencyHistogramOptions = {}
): RecorderPlugin {
  const resolved = resolveFrequencyHistogramOptions(options)
  let bufferedSamples: number[] = []
  let isActive = false
  let frameCount = 0
  let hasEmittedSpectrum = false
  let emitFft:
    | ((payload: {
        bars: Float32Array
        timestampMs: number
        fftSize: number
        sampleRate: number
      }) => void)
    | undefined

  return {
    name: "frequency-histogram",

    setup(context) {
      context.eventBus.register("plugin:fft")
      emitFft = (payload) => {
        context.eventBus.emit("plugin:fft", payload)
      }
    },

    onStart() {
      bufferedSamples = []
      isActive = true
      frameCount = 0
      hasEmittedSpectrum = false
    },

    onFrame(frame) {
      if (!isActive) {
        return
      }

      frameCount += 1
      if ((frameCount - 1) % resolved.frameInterval !== 0) {
        return
      }

      const channel = frame.planar[0]
      if (!channel || channel.length === 0) {
        return
      }

      for (let index = 0; index < channel.length; index += 1) {
        bufferedSamples.push((channel[index] ?? 0) / 32768)
      }

      while (bufferedSamples.length >= resolved.fftSize) {
        const window = new Float32Array(
          bufferedSamples.slice(0, resolved.fftSize)
        )
        bufferedSamples = bufferedSamples.slice(resolved.fftSize)
        const bars = analyzeFrequencyBars(window, frame.sampleRate, resolved)
        if (isSilentBars(bars)) {
          if (hasEmittedSpectrum) {
            hasEmittedSpectrum = false
            emitFft?.({
              bars,
              timestampMs: frame.timestamp + frame.durationMs,
              fftSize: resolved.fftSize,
              sampleRate: frame.sampleRate,
            })
          }
          continue
        }
        hasEmittedSpectrum = true
        emitFft?.({
          bars,
          timestampMs: frame.timestamp + frame.durationMs,
          fftSize: resolved.fftSize,
          sampleRate: frame.sampleRate,
        })
      }
    },

    onPause() {
      isActive = false
    },

    onResume() {
      isActive = true
    },

    onStop() {
      isActive = false
      bufferedSamples = []
      hasEmittedSpectrum = false
    },

    dispose() {
      isActive = false
      bufferedSamples = []
      hasEmittedSpectrum = false
      emitFft = undefined
    },
  }
}

function isSilentBars(bars: Float32Array): boolean {
  for (let index = 0; index < bars.length; index += 1) {
    if ((bars[index] ?? 0) > 0) {
      return false
    }
  }
  return true
}
