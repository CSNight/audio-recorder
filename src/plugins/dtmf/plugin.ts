import type { RecorderPlugin } from "../types"
import { DtmfDetector } from "./decode"
import type { DtmfDecodeOptions } from "./types"

export function createDtmfDecoderPlugin(
  options: DtmfDecodeOptions = {}
): RecorderPlugin {
  const detector = new DtmfDetector(options)
  let isActive = false
  let emitDetect: ((payload: ReturnType<typeof toPayload>) => void) | undefined

  return {
    name: "dtmf-decoder",

    setup(context) {
      context.eventBus.register("plugin:dtmf:detect")
      emitDetect = (payload) => {
        context.eventBus.emit("plugin:dtmf:detect", payload)
      }
    },

    onStart() {
      detector.reset()
      isActive = true
    },

    onFrame(frame) {
      if (!isActive) {
        return
      }

      const mono = downmixToMono(frame.planar)
      const detectedEvents = detector.push(
        mono,
        frame.sampleRate,
        frame.timestamp
      )
      for (const detected of detectedEvents) {
        emitDetect?.(toPayload(detected))
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
      detector.reset()
    },

    dispose() {
      isActive = false
      detector.reset()
      emitDetect = undefined
    },
  }
}

function downmixToMono(planar: Int16Array[]): Int16Array {
  const frameLength = planar[0]?.length ?? 0
  if (planar.length <= 1) {
    return planar[0] ? new Int16Array(planar[0]) : new Int16Array(0)
  }

  const mono = new Int16Array(frameLength)
  for (let index = 0; index < frameLength; index += 1) {
    let sum = 0
    for (
      let channelIndex = 0;
      channelIndex < planar.length;
      channelIndex += 1
    ) {
      sum += planar[channelIndex]?.[index] ?? 0
    }
    mono[index] = Math.round(sum / planar.length)
  }
  return mono
}

function toPayload(event: {
  key: string
  startedAtMs: number
  endedAtMs: number
  durationMs: number
  rowHz: number
  colHz: number
}) {
  return event
}
