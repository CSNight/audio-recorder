import type { PcmBufferSnapshot } from "../../buffer/types"

export function interleaveSnapshot(snapshot: PcmBufferSnapshot): Int16Array {
  const frameLength = snapshot.planar[0]?.length ?? 0
  const output = new Int16Array(frameLength * snapshot.channels)

  for (let frameIndex = 0; frameIndex < frameLength; frameIndex += 1) {
    for (
      let channelIndex = 0;
      channelIndex < snapshot.channels;
      channelIndex += 1
    ) {
      output[frameIndex * snapshot.channels + channelIndex] =
        snapshot.planar[channelIndex]?.[frameIndex] ?? 0
    }
  }

  return output
}
