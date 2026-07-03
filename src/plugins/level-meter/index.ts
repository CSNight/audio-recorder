import type { RecorderPlugin } from "../types"
import type { AudioFrame } from "../../types"
import type { RecorderLevel, RecorderLevelChannel } from "./types"

export type {
  RecorderLevel,
  RecorderLevelChannel,
  RecorderLevelEvent,
} from "./types"

/**
 * createLevelMeterPlugin：实时电平监测插件。
 *
 * 每帧 PCM 同步计算 peak/rms（整体 + 逐声道），通过 "plugin:level" 事件发出，
 * 供 UI 绘制音量条等场景使用。计算开销很小，无需 Worker。
 */
export function createLevelMeterPlugin(): RecorderPlugin {
  let emitLevel: ((level: RecorderLevel) => void) | undefined
  let isActive = false

  return {
    name: "level-meter",
    setup(context) {
      context.eventBus.register("plugin:level")
      emitLevel = (level) => {
        context.eventBus.emit("plugin:level", {
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
  let peak = 0
  let sampleCount = 0
  let totalSquare = 0

  // 单遍扫描：逐声道统计的同时聚合出整帧的 peak/rms，避免再整体遍历一次全部样本。
  const channels: RecorderLevelChannel[] = frame.planar.map((channel) => {
    let channelPeak = 0
    let channelSquare = 0

    for (let index = 0; index < channel.length; index += 1) {
      const sample = normalizePcmSample(channel[index] ?? 0)
      const magnitude = Math.abs(sample)
      if (magnitude > channelPeak) {
        channelPeak = magnitude
      }
      channelSquare += sample * sample
    }

    if (channelPeak > peak) {
      peak = channelPeak
    }
    totalSquare += channelSquare
    sampleCount += channel.length

    return {
      peak: channelPeak,
      rms: channel.length === 0 ? 0 : Math.sqrt(channelSquare / channel.length),
    }
  })

  return {
    peak,
    rms: sampleCount === 0 ? 0 : Math.sqrt(totalSquare / sampleCount),
    channels,
  }
}

function normalizePcmSample(sample: number): number {
  return Math.max(-1, Math.min(1, sample / 32768))
}
