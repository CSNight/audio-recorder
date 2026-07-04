import type { RecorderPlugin } from "../types"
import type { NoiseGatePluginOptions } from "./types"
import {
  createFrameFromPlanar,
  denormalizePcmSample,
  normalizePcmSample,
} from "./shared"

const DEFAULT_THRESHOLD_DB = -45
const DEFAULT_ATTACK_MS = 10
const DEFAULT_RELEASE_MS = 80

export function createNoiseGatePlugin(
  options: NoiseGatePluginOptions = {}
): RecorderPlugin {
  const thresholdLinear = Math.pow(
    10,
    (options.thresholdDb ?? DEFAULT_THRESHOLD_DB) / 20
  )
  const attackMs = options.attackMs ?? DEFAULT_ATTACK_MS
  const releaseMs = options.releaseMs ?? DEFAULT_RELEASE_MS
  let currentGain = 1

  return {
    name: "dsp:noise-gate",

    setup() {
      return
    },

    onStart() {
      currentGain = 1
    },

    onBeforeFrame(frame) {
      const frameLength = frame.planar[0]?.length ?? 0
      if (frameLength === 0) {
        return frame
      }

      const rms = measureFrameRms(frame.planar)
      const targetGain = rms >= thresholdLinear ? 1 : 0
      const smoothingMs = targetGain > currentGain ? attackMs : releaseMs
      // 用帧长度对应的样本数做 RC 平滑，推进到帧末尾的增益值，
      // 再对整帧统一应用该增益。帧长通常 8-20ms，块效应可忽略。
      const smoothingSamples = Math.max(
        1,
        Math.round((frame.sampleRate * smoothingMs) / 1000)
      )
      const frameFactor = Math.exp(-frameLength / smoothingSamples)
      currentGain = targetGain + (currentGain - targetGain) * frameFactor

      // 钳位至整数边界，防止浮点数累积误差导致增益永远无法收敛到 0/1
      if (targetGain === 0 && currentGain < 1 / 32768) {
        currentGain = 0
      }
      if (targetGain === 1 && currentGain > 1 - 1 / 32768) {
        currentGain = 1
      }

      const planar = frame.planar.map((channel) => {
        const output = new Int16Array(channel.length)

        for (
          let sampleIndex = 0;
          sampleIndex < channel.length;
          sampleIndex += 1
        ) {
          const sample = normalizePcmSample(channel[sampleIndex] ?? 0)
          output[sampleIndex] = denormalizePcmSample(sample * currentGain)
        }

        return output
      })

      return createFrameFromPlanar(planar, frame.sampleRate, frame.timestamp)
    },

    dispose() {
      currentGain = 1
    },
  }
}

function measureFrameRms(planar: Int16Array[]): number {
  let totalSquare = 0
  let sampleCount = 0

  for (const channel of planar) {
    for (let sampleIndex = 0; sampleIndex < channel.length; sampleIndex += 1) {
      const sample = normalizePcmSample(channel[sampleIndex] ?? 0)
      totalSquare += sample * sample
      sampleCount += 1
    }
  }

  return sampleCount === 0 ? 0 : Math.sqrt(totalSquare / sampleCount)
}
