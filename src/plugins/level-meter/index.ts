import type { RecorderPlugin } from "@/plugins/types"
import type { AudioFrame, RecorderLevelChannel, RecorderLevel } from "@/types"

export function createLevelMeterPlugin(): RecorderPlugin {
  let emitLevel: ((level: RecorderLevel) => void) | undefined
  let isActive = false

  return {
    name: "level-meter",
    setup(context) {
      context.eventBus.register("level")
      emitLevel = (level) => {
        context.eventBus.emit("level", {
          level,
        })
      }
    },
    onStart() {
      isActive = true
    },
    onFrame(frame) {
      if (!isActive) {
        return
      }

      emitLevel?.(measureFrameLevel(frame))
    },
    onPause() {
      isActive = false
    },
    onResume() {
      isActive = true
    },
    onStop() {
      isActive = false
    },
    dispose() {
      isActive = false
      emitLevel = undefined
    },
  }
}

function measureFrameLevel(frame: AudioFrame): RecorderLevel {
  const channels = frame.planar.map((channel) => measureChannelLevel(channel))
  let peak = 0
  let sampleCount = 0
  let totalSquare = 0

  for (const channel of frame.planar) {
    for (let index = 0; index < channel.length; index += 1) {
      const sample = normalizePcmSample(channel[index] ?? 0)
      peak = Math.max(peak, Math.abs(sample))
      totalSquare += sample * sample
      sampleCount += 1
    }
  }

  return {
    peak,
    rms: sampleCount === 0 ? 0 : Math.sqrt(totalSquare / sampleCount),
    channels,
  }
}

function measureChannelLevel(channel: Int16Array): RecorderLevelChannel {
  let peak = 0
  let totalSquare = 0

  for (let index = 0; index < channel.length; index += 1) {
    const sample = normalizePcmSample(channel[index] ?? 0)
    peak = Math.max(peak, Math.abs(sample))
    totalSquare += sample * sample
  }

  return {
    peak,
    rms: channel.length === 0 ? 0 : Math.sqrt(totalSquare / channel.length),
  }
}

function normalizePcmSample(sample: number): number {
  return Math.max(-1, Math.min(1, sample / 32768))
}
