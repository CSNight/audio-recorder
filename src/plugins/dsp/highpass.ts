import type { RecorderPlugin } from "../types"
import type { DspFilterOptions } from "./types"
import {
  createFrameFromPlanar,
  denormalizePcmSample,
  normalizePcmSample,
} from "./shared"

const DEFAULT_CUTOFF_HZ = 120
const MAX_FLUSH_FRAMES = 4
const FLUSH_THRESHOLD = 1 / 32768

export function createHighpassPlugin(
  options: DspFilterOptions = {}
): RecorderPlugin {
  const cutoffHz = options.cutoffHz ?? DEFAULT_CUTOFF_HZ
  const prevInputs: number[] = []
  const prevOutputs: number[] = []
  let lastChannels = 0
  let lastSampleRate = 0
  let lastFrameLength = 0
  let nextFlushTimestamp = 0

  const resetState = () => {
    prevInputs.length = 0
    prevOutputs.length = 0
    lastChannels = 0
    lastSampleRate = 0
    lastFrameLength = 0
    nextFlushTimestamp = 0
  }

  return {
    name: "dsp:highpass",

    setup() {
      return
    },

    onStart() {
      resetState()
    },

    onBeforeFrame(frame) {
      const alpha = resolveHighpassAlpha(frame.sampleRate, cutoffHz)
      const planar = frame.planar.map((channel, channelIndex) => {
        const output = new Int16Array(channel.length)
        let prevInput = prevInputs[channelIndex] ?? 0
        let prevOutput = prevOutputs[channelIndex] ?? 0

        for (
          let sampleIndex = 0;
          sampleIndex < channel.length;
          sampleIndex += 1
        ) {
          const sample = normalizePcmSample(channel[sampleIndex] ?? 0)
          const filtered = alpha * (prevOutput + sample - prevInput)
          output[sampleIndex] = denormalizePcmSample(filtered)
          prevInput = sample
          prevOutput = filtered
        }

        prevInputs[channelIndex] = prevInput
        prevOutputs[channelIndex] = prevOutput
        return output
      })

      lastChannels = frame.channels
      lastSampleRate = frame.sampleRate
      lastFrameLength = frame.planar[0]?.length ?? 0
      nextFlushTimestamp = frame.timestamp + frame.durationMs
      return createFrameFromPlanar(planar, frame.sampleRate, frame.timestamp)
    },

    onFlush() {
      if (lastChannels === 0 || lastSampleRate <= 0 || lastFrameLength === 0) {
        return
      }

      // onFlush 只负责把 IIR 剩余状态用静音输入继续推进若干帧，
      // 多轮 drain 由 PluginHost 负责，不在单个插件内部递归。
      const alpha = resolveHighpassAlpha(lastSampleRate, cutoffHz)
      const frames = [] as ReturnType<typeof createFrameFromPlanar>[]
      let timestamp = nextFlushTimestamp

      for (let frameIndex = 0; frameIndex < MAX_FLUSH_FRAMES; frameIndex += 1) {
        const output = Array.from(
          { length: lastChannels },
          () => new Int16Array(lastFrameLength)
        )
        let maxMagnitude = 0

        for (
          let channelIndex = 0;
          channelIndex < lastChannels;
          channelIndex += 1
        ) {
          let prevInput = prevInputs[channelIndex] ?? 0
          let prevOutput = prevOutputs[channelIndex] ?? 0
          const channel = output[channelIndex]!

          for (
            let sampleIndex = 0;
            sampleIndex < lastFrameLength;
            sampleIndex += 1
          ) {
            const filtered = alpha * prevOutput - alpha * prevInput
            channel[sampleIndex] = denormalizePcmSample(filtered)
            prevInput = 0
            prevOutput = filtered
            maxMagnitude = Math.max(maxMagnitude, Math.abs(filtered))
          }

          prevInputs[channelIndex] = prevInput
          prevOutputs[channelIndex] = prevOutput
        }

        if (maxMagnitude <= FLUSH_THRESHOLD && frames.length === 0) {
          break
        }

        frames.push(createFrameFromPlanar(output, lastSampleRate, timestamp))
        timestamp += frames[frames.length - 1]!.durationMs

        if (maxMagnitude <= FLUSH_THRESHOLD) {
          break
        }
      }

      nextFlushTimestamp = timestamp

      return frames
    },

    dispose() {
      resetState()
    },
  }
}

function resolveHighpassAlpha(sampleRate: number, cutoffHz: number): number {
  const safeCutoff = Math.max(1, cutoffHz)
  const rc = 1 / (2 * Math.PI * safeCutoff)
  const dt = 1 / sampleRate
  return rc / (rc + dt)
}
